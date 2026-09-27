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
  /** 行（縦書きでは列）の送り幅の中央値。段落間の空きの判定に使う。 */
  typicalGap: number;
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  size: number;
}

// 康熙部首・CJK 部首補助・縦書き用の句読点や括弧は、見た目が同じ通常の文字に置き換える（例：⽇→日、︒→。）。
const compatibilityCharacters = /[\u2E80-\u2FDF\uFE10-\uFE1F\uFE30-\uFE4F]/gu;

export function normalizePdfText(text: string): string {
  return text.replace(compatibilityCharacters, (character) => character.normalize("NFKC"));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** 隣り合う文字の位置関係から、縦書き（x がそろい y が下がる）が多数派かを判定する。 */
export function looksVertical(items: readonly PositionedItem[]): boolean {
  let vertical = 0;
  let horizontal = 0;
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (!previous || !current) continue;
    const tolerance = Math.max(1, Math.max(previous.size, current.size) * 0.3);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    // 縦書きなら次の項目は前の項目の字数ぶん下に続く。横書きの改行は字数に関係なく行送りぶん下がるだけ。
    const advance = Array.from(previous.str).length * previous.size;
    const continuesDownward = dy < 0 && Math.abs(Math.abs(dy) - advance) <= Math.max(tolerance, advance * 0.4);
    if (Math.abs(dx) <= tolerance && continuesDownward) vertical += 1;
    else if (Math.abs(dy) <= tolerance && dx > 0) horizontal += 1;
  }
  return vertical > horizontal && vertical >= 3;
}

function horizontalRows(items: readonly PositionedItem[]): TextRow[] {
  const rows: TextRow[] = [];
  for (const item of items) {
    const currentRow = rows.at(-1);
    if (currentRow && Math.abs(item.y - currentRow.y) <= Math.max(1, item.size * 0.4)) {
      currentRow.text += item.str;
      currentRow.x = Math.min(currentRow.x, item.x);
    } else {
      rows.push({ text: item.str, y: item.y, height: item.size, x: item.x });
    }
  }
  return rows;
}

/**
 * 縦書きの列を、横書きの行と同じ形に写す。列の送り（右→左の x）を y に、
 * 列頭からの下がり（字下げ）を x に入れるので、後段の段落判定をそのまま使える。
 */
function verticalColumns(items: readonly PositionedItem[]): TextRow[] {
  const columns: { text: string; x: number; top: number; size: number }[] = [];
  for (const item of items) {
    const column = columns.at(-1);
    if (column && Math.abs(item.x - column.x) <= Math.max(1, item.size * 0.4)) {
      column.text += item.str;
      column.top = Math.max(column.top, item.y);
    } else {
      columns.push({ text: item.str, x: item.x, top: item.y, size: item.size });
    }
  }
  const pageTop = Math.max(...columns.map((column) => column.top));
  return columns.map((column) => ({ text: column.text, y: column.x, height: column.size, x: pageTop - column.top }));
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
    const items: PositionedItem[] = [];
    for (const unknownItem of content.items) {
      if (!isPdfTextItem(unknownItem) || !unknownItem.str) continue;
      const item = unknownItem;
      if (item.dir === "ttb") isVertical = true;
      const size = Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || Math.abs(item.transform[0] ?? 0) || 12;
      items.push({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, size });
    }
    const verticalPage = looksVertical(items);
    if (verticalPage) isVertical = true;
    const rows = verticalPage ? verticalColumns(items) : horizontalRows(items);

    if (rows.length === 0) continue;
    pages.push({
      rows,
      minX: Math.min(...rows.map((row) => row.x)),
      longestLine: Math.max(...rows.map((row) => Array.from(row.text).length)),
      typicalGap: median(rows.slice(1).map((row, index) => Math.abs(row.y - (rows[index]?.y ?? row.y)))),
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
      // 行送りが広い組版（縦書きの小説など）でも誤判定しないよう、ページの行送りの中央値と比べる。
      const gapThreshold = page.rows.length >= 3 && page.typicalGap > 0
        ? Math.max(page.typicalGap * 1.5, Math.max(row.height, previousRow.height) * 1.2)
        : Math.max(row.height, previousRow.height) * 1.6;
      const largeVerticalGap = samePage && gap > gapThreshold;
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

  const text = normalizePdfText(lines.join("")).trim();
  await loadingTask.destroy();
  if (!text) throw new PdfImportError("テキストを抽出できません。スキャン画像PDFのOCRには対応していません。");
  return {
    title: filenameTitle(filename),
    author: "",
    text,
    rubies: [],
    format: "pdf",
    warning: isVertical ? "縦書きPDFを右の列から順に読み取りました。段組みや注釈があると順序が崩れることがあります。" : undefined,
  };
}
