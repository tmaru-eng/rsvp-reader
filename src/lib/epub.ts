import JSZip from "jszip";
import type { ParsedBook } from "./types";

export class EpubImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubImportError";
  }
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

function readableBlocks(document: Document): string[] {
  const body = firstByLocalName(document, "body") ?? document.documentElement;
  const blockNames = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
  const containerNames = new Set(["blockquote", "li", "div", "section"]);
  const blocks = elements(body).filter((element) => {
    const name = localName(element);
    if (blockNames.has(name)) return true;
    if (!containerNames.has(name)) return false;
    return !elements(element).some((child) => blockNames.has(localName(child)) || containerNames.has(localName(child)));
  });
  const text = blocks.map((element) => element.textContent ?? "").map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean);
  if (text.length) return text;
  const fallback = (body.textContent ?? "").replace(/\s+/gu, " ").trim();
  return fallback ? [fallback] : [];
}

function removeElements(document: Document, names: ReadonlySet<string>): void {
  for (const element of elements(document).filter((candidate) => names.has(localName(candidate)))) {
    element.parentNode?.removeChild(element);
  }
}

export async function parseEpub(input: ArrayBuffer | Uint8Array): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(input);
  if (zip.file("META-INF/encryption.xml")) {
    throw new EpubImportError("DRM付きのEPUBは読めません。");
  }

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
  const manifestElement = firstByLocalName(opf, "manifest");
  if (manifestElement) {
    for (const item of elements(manifestElement).filter((element) => localName(element) === "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) manifest.set(id, href);
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

  const paragraphs: string[] = [];
  for (const chapterPath of chapterPaths) {
    const chapterFile = zip.file(chapterPath);
    if (!chapterFile) continue;
    const chapter = parseXml(await chapterFile.async("text"));
    removeElements(chapter, new Set(["rt", "rp", "script", "style", "nav"]));
    paragraphs.push(...readableBlocks(chapter));
  }
  const text = paragraphs.join("\n").trim();
  if (!text) throw new EpubImportError("EPUBから本文を取り出せませんでした。");
  return { title, author, text, format: "epub" };
}
