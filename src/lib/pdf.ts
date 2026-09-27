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
  const pageTexts: string[] = [];
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
      const height = Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || 12;
      const currentRow = rows.at(-1);
      if (currentRow && Math.abs(y - currentRow.y) <= Math.max(1, height * 0.4)) {
        currentRow.text += item.str;
      } else {
        rows.push({ text: item.str, y, height });
      }
    }

    if (rows.length === 0) continue;
    const lines: string[] = [];
    rows.forEach((row, index) => {
      if (index === 0) {
        lines.push(row.text);
        return;
      }
      const previous = rows[index - 1];
      if (!previous) return;
      const gap = Math.abs(row.y - previous.y);
      const separator = gap > Math.max(row.height, previous.height) * 1.6 ? "\n\n" : "\n";
      lines.push(`${separator}${row.text}`);
    });
    pageTexts.push(lines.join(""));
  }

  const text = pageTexts.join("\n\n").trim();
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
