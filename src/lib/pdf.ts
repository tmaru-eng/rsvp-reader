import "./polyfills";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParsedBook } from "./types";

interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
  dir: string;
}

interface PdfParseOptions {
  disableFontFace?: boolean;
}

interface TextRow {
  text: string;
  y: number;
  height: number;
  x: number;
}

interface TextPage {
  rows: TextRow[];
  minX: number;
  longestLine: number;
}

export class PdfImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfImportError";
  }
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  return typeof value === "object" && value !== null && "str" in value && "transform" in value;
}

function filenameTitle(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  return filename.slice(lastSlash + 1).replace(/\.pdf$/iu, "") || "PDF";
}

export async function parsePdf(
  input: ArrayBuffer | Uint8Array,
  cMapUrl: string,
  options: PdfParseOptions = {},
  filename = "PDF",
): Promise<ParsedBook> {
  const normalizedCMapUrl = cMapUrl.endsWith("/") ? cMapUrl : `${cMapUrl}/`;
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const loadingTask = getDocument({
    data,
    cMapUrl: normalizedCMapUrl,
    cMapPacked: true,
    disableFontFace: options.disableFontFace,
  });
  const pdf = await loadingTask.promise;
  const pages: TextPage[] = [];
  let isVertical = false;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows: TextRow[] = [];
    for (const unknownItem of content.items) {
      if (!isPdfTextItem(unknownItem) || !unknownItem.str) continue;
      const item = unknownItem;
      if (item.dir === "ttb") isVertical = true;
      const y = item.transform[5] ?? 0;
      const x = item.transform[4] ?? 0;
      const height = Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || 12;
      const currentRow = rows.at(-1);
      if (currentRow && Math.abs(y - currentRow.y) <= Math.max(1, height * 0.4)) {
        currentRow.text += item.str;
        currentRow.x = Math.min(currentRow.x, x);
      } else {
        rows.push({ text: item.str, y, height, x });
      }
    }

    if (rows.length === 0) continue;
    pages.push({
      rows,
      minX: Math.min(...rows.map((row) => row.x)),
      longestLine: Math.max(...rows.map((row) => Array.from(row.text).length)),
    });
  }

  const lines: string[] = [];
  let previousRow: TextRow | undefined;
  let previousPageIndex = -1;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!page) continue;
    for (const row of page.rows) {
      if (!previousRow) {
        lines.push(row.text);
        previousRow = row;
        previousPageIndex = pageIndex;
        continue;
      }

      const previousPage = pages[previousPageIndex];
      const samePage = pageIndex === previousPageIndex;
      const gap = Math.abs(row.y - previousRow.y);
      const largeVerticalGap = samePage && gap > Math.max(row.height, previousRow.height) * 1.6;
      const indented = row.text.startsWith("　") || row.x >= page.minX + row.height * 0.8;
      // 折り返しの行はほぼ行末まで埋まる。明らかに短い行（見出し・段落の最終行）の後ろは段落の区切り。
      const previousIsShortSentence = !/[-‐‑]$/u.test(previousRow.text)
        && Array.from(previousRow.text).length < (previousPage?.longestLine ?? 0) * 0.75;
      // 見出しと本文のように文字の高さが変わる行は別の段落とみなす。
      const fontSizeChanged = Math.abs(row.height - previousRow.height) > Math.max(row.height, previousRow.height) * 0.15;
      const paragraphBreak = largeVerticalGap || indented || previousIsShortSentence || fontSizeChanged;
      const hyphenatedWord = !paragraphBreak && /[-‐‑]$/u.test(previousRow.text) && /^[A-Za-z0-9]/u.test(row.text);
      const adjacentHalfWidthAlphaNumeric = /[A-Za-z0-9]$/u.test(previousRow.text) && /^[A-Za-z0-9]/u.test(row.text);

      if (paragraphBreak) {
        lines.push(`\n${row.text}`);
      } else if (hyphenatedWord) {
        lines[lines.length - 1] = `${lines.at(-1)?.slice(0, -1) ?? ""}${row.text}`;
      } else if (adjacentHalfWidthAlphaNumeric) {
        lines.push(` ${row.text}`);
      } else {
        lines.push(row.text);
      }
      previousRow = row;
      previousPageIndex = pageIndex;
    }
  }

  const text = lines.join("").trim();
  await loadingTask.destroy();
  if (!text) throw new PdfImportError("テキストを抽出できません。スキャン画像PDFのOCRには対応していません。");
  return {
    title: filenameTitle(filename),
    author: "",
    text,
    format: "pdf",
    warning: isVertical ? "縦書きPDFのため、抽出順が崩れている可能性があります。" : undefined,
  };
}
