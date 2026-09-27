import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEpub } from "../src/lib/epub";
import { parsePdf } from "../src/lib/pdf";
import { parseTextDocument } from "../src/lib/text";

const aozoraFixture = new URL("./fixtures/kumo-no-ito-sjis.txt", import.meta.url);
const pdfFixture = new URL("./fixtures/japanese-text.pdf", import.meta.url);
const epubFixture = new URL("./fixtures/ruby-book.epub", import.meta.url);

afterEach(() => vi.unstubAllGlobals());

describe("text documents", () => {
  it("detects Shift_JIS and removes Aozora ruby, notes, introduction, and bottom matter", async () => {
    const bytes = new Uint8Array(await readFile(aozoraFixture));
    const book = parseTextDocument(bytes, "kumono_ito.txt");

    expect(book.title).toBe("蜘蛛の糸");
    expect(book.author).toBe("芥川龍之介");
    expect(book.text).toContain("ある日の事でございます。");
    expect(book.text).toContain("御釈迦様は極楽の蓮池のふちを");
    expect(book.text).not.toContain("おしゃかさま");
    expect(book.text).not.toContain("テキスト中に現れる記号");
    expect(book.text).not.toContain("［＃");
    expect(book.text).not.toContain("底本：");
  });

  it("keeps plain UTF-8 paragraphs and uses the file name as its title", () => {
    const book = parseTextDocument(new TextEncoder().encode("第一段落\n第二段落"), "メモ.txt");

    expect(book).toMatchObject({ title: "メモ", author: "", text: "第一段落\n第二段落" });
  });
});

describe("EPUB documents", () => {
  it("reads spine order and metadata while dropping ruby readings and pronunciation hints", async () => {
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

  it("rejects EPUB archives that declare DRM encryption", async () => {
    vi.stubGlobal("DOMParser", DOMParser);
    const zip = new JSZip();
    zip.file("META-INF/container.xml", "<container />");
    zip.file("META-INF/encryption.xml", "<encryption />");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parseEpub(bytes)).rejects.toThrow("DRM付きのEPUBは読めません");
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
});
