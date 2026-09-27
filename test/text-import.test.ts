import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEpubFilename, parseEpub } from "../src/lib/epub";
import { parsePdf } from "../src/lib/pdf";
import { parseTextDocument } from "../src/lib/text";

const aozoraFixture = new URL("./fixtures/kumo-no-ito-sjis.txt", import.meta.url);
const pdfFixture = new URL("./fixtures/japanese-text.pdf", import.meta.url);
const epubFixture = new URL("./fixtures/ruby-book.epub", import.meta.url);

const IDPF_FONT_OBFUSCATION = "http://www.idpf.org/2008/embedding";
const ADOBE_FONT_OBFUSCATION = "http://ns.adobe.com/pdf/enc#RC";

function encryptedItem(algorithm: string, uri: string): string {
  return `<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData>`;
}

async function makeEpub(encryptionXml = "", chapterContent = "<p>本文の段落です。</p>"): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OPS/book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:creator>著者</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="font-otf" href="fonts/font.otf" media-type="font/otf"/><item id="font-ttf" href="fonts/font.ttf" media-type="font/ttf"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file("OPS/chapter.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>${chapterContent}</body></html>`);
  zip.file("OPS/fonts/font.otf", new Uint8Array([1]));
  zip.file("OPS/fonts/font.ttf", new Uint8Array([2]));
  if (encryptionXml) zip.file("META-INF/encryption.xml", encryptionXml);
  return zip.generateAsync({ type: "uint8array" });
}

afterEach(() => vi.unstubAllGlobals());

describe("text documents", () => {
  it("detects Shift_JIS and removes Aozora notes, introduction, and bottom matter while retaining ruby ranges", async () => {
    const bytes = new Uint8Array(await readFile(aozoraFixture));
    const book = parseTextDocument(bytes, "kumono_ito.txt");

    expect(book.title).toBe("蜘蛛の糸");
    expect(book.author).toBe("芥川龍之介");
    expect(book.text).toContain("ある日の事でございます。");
    expect(book.text).toContain("御釈迦様は極楽の蓮池のふちを");
    expect(book.text).not.toContain("おしゃかさま");
    expect(book.rubies.some(({ text }) => text === "おしゃかさま")).toBe(true);
    expect(book.text).not.toContain("テキスト中に現れる記号");
    expect(book.text).not.toContain("［＃");
    expect(book.text).not.toContain("底本：");
  });

  it("keeps plain UTF-8 paragraphs and uses the file name as its title", () => {
    const book = parseTextDocument(new TextEncoder().encode("第一段落\n第二段落"), "メモ.txt");

    expect(book).toMatchObject({ title: "メモ", author: "", text: "第一段落\n第二段落" });
  });

  it("extracts explicit and implicit Aozora ruby, including 々, while removing notes", () => {
    const book = parseTextDocument("｜東京《とうきょう》［＃「東京」に傍点］へ行き、山々《やまやま》を見る。", "ルビ.txt");

    expect(book.text).toBe("東京へ行き、山々を見る。");
    expect(book.rubies).toEqual([
      { start: 0, end: 2, text: "とうきょう" },
      { start: 6, end: 8, text: "やまやま" },
    ]);
  });

  it("counts ruby positions in Unicode code points", () => {
    const book = parseTextDocument("😀｜東京《とうきょう》", "絵文字.txt");

    expect(book.text).toBe("😀東京");
    expect(book.rubies).toEqual([{ start: 1, end: 3, text: "とうきょう" }]);
  });
});

describe("EPUB documents", () => {
  it("reads spine order and metadata while keeping ruby readings out of plain text", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const bytes = new Uint8Array(await readFile(epubFixture));
    const book = await parseEpub(bytes);

    expect(book.title).toBe("蜘蛛の糸");
    expect(book.author).toBe("芥川龍之介");
    expect(book.text).toContain("蜘蛛の糸が、地獄へ");
    expect(book.text).not.toContain("くも");
    expect(book.text).not.toContain("おしゃかさま");
    expect(book.text).not.toContain("（");
  });

  it("keeps EPUB ruby base text and records its reading without rp hints", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const bytes = await makeEpub("", "<p><ruby>蜘蛛<rp>（</rp><rt>くも</rt><rp>）</rp></ruby>の糸</p>");
    const book = await parseEpub(bytes);

    expect(book.text).toBe("蜘蛛の糸");
    expect(book.rubies).toEqual([{ start: 0, end: 2, text: "くも" }]);
  });

  it("reads EPUBs when encryption only obfuscates embedded fonts", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const encryption = `<encryption>${encryptedItem(IDPF_FONT_OBFUSCATION, "OPS/fonts/font.otf")}${encryptedItem(ADOBE_FONT_OBFUSCATION, "OPS/fonts/font.ttf")}</encryption>`;
    const book = await parseEpub(await makeEpub(encryption));

    expect(book.text).toBe("本文の段落です。");
  });

  it("rejects EPUBs when a spine XHTML document is encrypted", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const encryption = `<encryption>${encryptedItem(IDPF_FONT_OBFUSCATION, "OPS/chapter.xhtml")}</encryption>`;

    await expect(parseEpub(await makeEpub(encryption))).rejects.toThrow("DRM で保護されているため読めません");
  });

  it("extracts text from kepub files with Kobo span wrappers", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const bytes = await makeEpub("", '<p><span class="koboSpan">蜘蛛の</span><span class="koboSpan">糸</span>が、地獄へ垂れています。</p>');
    const book = await parseEpub(bytes);

    expect(isEpubFilename("book.kepub")).toBe(true);
    expect(isEpubFilename("book.kepub.epub")).toBe(true);
    expect(book.text).toBe("蜘蛛の糸が、地獄へ垂れています。");
  });
});

describe("PDF documents", () => {
  it("extracts embedded Japanese text with the packaged CMaps", async () => {
    const bytes = new Uint8Array(await readFile(pdfFixture));
    const cMapUrl = `${resolve(process.cwd(), "public/cmaps")}${sep}`;
    const book = await parsePdf(bytes, cMapUrl, { disableFontFace: true });

    expect(book.text).toContain("日本語PDF抽出テスト");
    expect(book.text).toContain("蜘蛛の糸は、極楽の蓮池から地獄へ垂れています。");
    expect(book.text).toContain("芥川龍之介の作品です。");
    expect(book.text).toBe("日本語PDF抽出テスト\n蜘蛛の糸は、極楽の蓮池から地獄へ垂れています。芥川龍之介の作品です。");
    expect(book.text).not.toContain(" ");
  });

  it("reads vertical Japanese PDFs column by column and normalizes radical and vertical-form characters", async () => {
    const bytes = new Uint8Array(await readFile(resolve(process.cwd(), "test/fixtures/vertical-japanese.pdf")));
    const cMapUrl = `${resolve(process.cwd(), "public/cmaps")}${sep}`;
    const book = await parsePdf(bytes, cMapUrl, { disableFontFace: true });

    expect(book.text.startsWith("ある日の事でございます。御釈迦様は極楽の蓮池のふちを、")).toBe(true);
    expect(book.text).toContain("\nやがて御釈迦様は");
    expect(book.text.split("\n")).toHaveLength(2);
    expect(book.text).not.toMatch(/[\u2E80-\u2FDF\uFE10-\uFE1F\uFE30-\uFE4F]/u);
    expect(book.warning).toBeDefined();
  });
});
