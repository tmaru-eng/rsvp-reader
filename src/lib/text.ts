import type { ParsedBook } from "./types";

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function decodeText(input: string | ArrayBuffer | Uint8Array): string {
  if (typeof input === "string") return input;

  const bytes = toBytes(input);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

function titleFromFilename(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const baseName = filename.slice(lastSlash + 1).replace(/\.[^.]+$/u, "").trim();
  return baseName || "貼り付けた文章";
}

function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?|\u0085/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t \u3000]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function cleanAozoraText(source: string): string {
  return normalizeBody(
    source
      .replace(/^\s*-{7,}[ \t]*\n[\s\S]*?\n[ \t]*-{7,}[ \t]*(?:\n|$)/mu, "\n")
      .replace(/^底本：[\s\S]*$/mu, "")
      .replace(/※(?=［＃)/gu, "")
      .replace(/［＃[^］]*］/gu, "")
      .replace(/《[^》]*》/gu, "")
      .replace(/｜/gu, ""),
  );
}

export function parseTextDocument(input: string | ArrayBuffer | Uint8Array, filename = "貼り付け.txt"): ParsedBook {
  const source = decodeText(input).replace(/\r\n?|\u0085/gu, "\n");
  const isAozora = /《[^》]*》|［＃[\s\S]*?］|^-{7,}/mu.test(source);
  let title = titleFromFilename(filename);
  let author = "";
  let text = source;

  if (isAozora) {
    const headerLines = source.split("\n").filter((line) => line.trim()).slice(0, 2);
    title = headerLines[0]?.trim() || title;
    author = headerLines[1]?.trim() || "";
    let skippedHeaderLines = 0;
    text = source
      .split("\n")
      .filter((line) => {
        if (skippedHeaderLines < 2 && line.trim()) {
          skippedHeaderLines += 1;
          return false;
        }
        return true;
      })
      .join("\n");
    text = cleanAozoraText(text);
  } else {
    text = normalizeBody(text);
  }

  return { title, author, text, format: "txt" };
}
