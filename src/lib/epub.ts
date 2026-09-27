import JSZip from "jszip";
import type { ParsedBook, Ruby } from "./types";
import { normalizeMarkedRubyText, RUBY_END_MARKER, RUBY_START_MARKER } from "./ruby";

export class EpubImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubImportError";
  }
}

const FONT_OBFUSCATION_ALGORITHMS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);
const FONT_FILE_EXTENSION = /\.(?:otf|otc|ttf|ttc|woff2?|sfnt)$/iu;
const FONT_MEDIA_TYPE = /(?:font|woff|opentype|sfnt)/iu;

export function isEpubFilename(filename: string): boolean {
  return /\.(?:epub|kepub)$/iu.test(filename);
}

function elements(root: Document | Element): Element[] {
  return Array.from(root.getElementsByTagName("*"));
}

function localName(element: Element): string {
  return (element.localName || element.tagName.split(":").at(-1) || "").toLowerCase();
}

function firstByLocalName(root: Document | Element, name: string): Element | undefined {
  return elements(root).find((element) => localName(element) === name);
}

function parseXml(source: string): Document {
  const parsed = new DOMParser().parseFromString(source, "application/xml");
  if (firstByLocalName(parsed, "parsererror")) throw new EpubImportError("EPUBのXMLを読み込めません。");
  return parsed;
}

function resolveArchivePath(baseFile: string, href: string): string {
  const decoded = decodeURIComponent(href.split(/[?#]/u, 1)[0] ?? href).replace(/\\/gu, "/");
  const parts = baseFile.slice(0, baseFile.lastIndexOf("/") + 1).split("/").filter(Boolean);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new EpubImportError("EPUB内のパスが不正です。");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

interface ReadableBlock {
  text: string;
  rubies: Ruby[];
}

function nodeTextWithoutRubyHints(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const name = localName(element);
  if (name === "rt" || name === "rp") return "";
  return Array.from(element.childNodes).map(nodeTextWithoutRubyHints).join("");
}

function markedNodeText(node: Node, readings: string[]): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const name = localName(element);
  if (name === "rt" || name === "rp") return "";
  if (name === "ruby") {
    const base = nodeTextWithoutRubyHints(element);
    const reading = elements(element)
      .filter((child) => localName(child) === "rt")
      .map((child) => (child.textContent ?? "").replace(/\s+/gu, " ").trim())
      .join("");
    if (base && reading) {
      readings.push(reading);
      return `${RUBY_START_MARKER}${base}${RUBY_END_MARKER}`;
    }
    return base;
  }
  return Array.from(element.childNodes).map((child) => markedNodeText(child, readings)).join("");
}

function readableBlock(element: Element): ReadableBlock {
  const readings: string[] = [];
  const markedText = markedNodeText(element, readings);
  return normalizeMarkedRubyText(markedText, readings, (value) => value.replace(/\s+/gu, " ").trim());
}

function readableBlocks(document: Document): ReadableBlock[] {
  const body = firstByLocalName(document, "body") ?? document.documentElement;
  const blockNames = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
  const containerNames = new Set(["blockquote", "li", "div", "section"]);
  const blocks = elements(body).filter((element) => {
    const name = localName(element);
    if (blockNames.has(name)) return true;
    if (!containerNames.has(name)) return false;
    return !elements(element).some((child) => blockNames.has(localName(child)) || containerNames.has(localName(child)));
  });
  const parsedBlocks = blocks.map(readableBlock).filter(({ text }) => Boolean(text));
  if (parsedBlocks.length) return parsedBlocks;
  const fallback = readableBlock(body);
  return fallback.text ? [fallback] : [];
}

function removeElements(document: Document, names: ReadonlySet<string>): void {
  for (const element of elements(document).filter((candidate) => names.has(localName(candidate)))) {
    element.parentNode?.removeChild(element);
  }
}

export async function parseEpub(input: ArrayBuffer | Uint8Array): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(input);

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new EpubImportError("EPUBの目次情報が見つかりません。");
  const container = parseXml(await containerFile.async("text"));
  const rootfile = firstByLocalName(container, "rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new EpubImportError("EPUBの本文一覧が見つかりません。");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new EpubImportError("EPUBの本文一覧を開けません。");
  const opf = parseXml(await opfFile.async("text"));
  const title = firstByLocalName(opf, "title")?.textContent?.trim() || "タイトル不明";
  const author = firstByLocalName(opf, "creator")?.textContent?.trim() || "";
  const manifest = new Map<string, string>();
  const fontPaths = new Set<string>();
  const manifestElement = firstByLocalName(opf, "manifest");
  if (manifestElement) {
    for (const item of elements(manifestElement).filter((element) => localName(element) === "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) {
        manifest.set(id, href);
        const mediaType = item.getAttribute("media-type") ?? "";
        if (FONT_MEDIA_TYPE.test(mediaType) || FONT_FILE_EXTENSION.test(href)) {
          fontPaths.add(resolveArchivePath(opfPath, href));
        }
      }
    }
  }

  const spine = firstByLocalName(opf, "spine");
  if (!spine) throw new EpubImportError("EPUBの章一覧が見つかりません。");
  const chapterPaths = elements(spine)
    .filter((element) => localName(element) === "itemref")
    .map((element) => manifest.get(element.getAttribute("idref") ?? ""))
    .filter((href): href is string => Boolean(href))
    .map((href) => resolveArchivePath(opfPath, href));
  if (chapterPaths.length === 0) throw new EpubImportError("EPUBに本文の章がありません。");

  const encryptionFile = zip.file("META-INF/encryption.xml");
  if (encryptionFile) {
    const encryption = parseXml(await encryptionFile.async("text"));
    const spinePaths = new Set(chapterPaths);
    const encryptedData = elements(encryption).filter((element) => localName(element) === "encrypteddata");
    for (const entry of encryptedData) {
      const algorithm = elements(entry)
        .find((element) => localName(element) === "encryptionmethod")
        ?.getAttribute("Algorithm") ?? "";
      const uri = elements(entry)
        .find((element) => localName(element) === "cipherreference")
        ?.getAttribute("URI");
      if (!uri) continue;

      const resourcePath = resolveArchivePath("", uri);
      if (spinePaths.has(resourcePath)) {
        throw new EpubImportError("DRM で保護されているため読めません");
      }
      if (FONT_OBFUSCATION_ALGORITHMS.has(algorithm) && fontPaths.has(resourcePath)) continue;
    }
  }

  const paragraphs: ReadableBlock[] = [];
  for (const chapterPath of chapterPaths) {
    const chapterFile = zip.file(chapterPath);
    if (!chapterFile) continue;
    const chapter = parseXml(await chapterFile.async("text"));
    removeElements(chapter, new Set(["script", "style", "nav"]));
    paragraphs.push(...readableBlocks(chapter));
  }
  let text = "";
  const rubies: Ruby[] = [];
  for (const paragraph of paragraphs) {
    if (text) text += "\n";
    const offset = Array.from(text).length;
    text += paragraph.text;
    rubies.push(...paragraph.rubies.map((ruby) => ({ ...ruby, start: ruby.start + offset, end: ruby.end + offset })));
  }
  if (!text) throw new EpubImportError("EPUBから本文を取り出せませんでした。");
  return { title, author, text, rubies, format: "epub" };
}
