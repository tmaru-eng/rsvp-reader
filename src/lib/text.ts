import type { ParsedBook } from "./types";
import { normalizeMarkedRubyText, RUBY_END_MARKER, RUBY_START_MARKER } from "./ruby";

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
  return parseAozoraBody(source).text;
}

function parseAozoraBody(source: string): { text: string; rubies: ParsedBook["rubies"] } {
  const cleanSource = source
    .replace(/^\s*-{7,}[ \t]*\n[\s\S]*?\n[ \t]*-{7,}[ \t]*(?:\n|$)/mu, "\n")
    .replace(/^底本：[\s\S]*$/mu, "")
    .replace(/※(?=［＃)/gu, "")
    .replace(/［＃[^］]*］/gu, "");
  const rubyPattern = /｜([^《｜]+)《([^》]*)》|([\p{Script=Han}々〆ヶ〇]+)《([^》]*)》/gu;
  const readings: string[] = [];
  let markedText = "";
  let cursor = 0;

  for (const match of cleanSource.matchAll(rubyPattern)) {
    const index = match.index ?? cursor;
    markedText += cleanSource.slice(cursor, index).replace(/｜/gu, "");
    const base = match[1] ?? match[3] ?? "";
    const reading = match[2] ?? match[4] ?? "";
    markedText += `${RUBY_START_MARKER}${base}${RUBY_END_MARKER}`;
    readings.push(reading);
    cursor = index + match[0].length;
  }

  markedText += cleanSource.slice(cursor).replace(/｜/gu, "");
  return normalizeMarkedRubyText(markedText, readings, normalizeBody);
}

export function parseTextDocument(input: string | ArrayBuffer | Uint8Array, filename = "貼り付け.txt"): ParsedBook {
  const source = decodeText(input).replace(/\r\n?|\u0085/gu, "\n");
  const isAozora = /《[^》]*》|［＃[\s\S]*?］|^-{7,}/mu.test(source);
  let title = titleFromFilename(filename);
  let author = "";
  let text = source;
  let rubies: ParsedBook["rubies"] = [];

  if (isAozora) {
    const hasAozoraHeader = source.split("\n").slice(0, 8).some((line) => /^[ \t]*-{7,}[ \t]*$/u.test(line));
    let skippedHeaderLines = 0;
    const body = hasAozoraHeader
      ? source.split("\n").filter((line) => {
        if (skippedHeaderLines < 2 && line.trim()) {
          if (skippedHeaderLines === 0) title = line.trim();
          else author = line.trim();
          skippedHeaderLines += 1;
          return false;
        }
        return true;
      }).join("\n")
      : source;
    const parsed = parseAozoraBody(body);
    text = parsed.text;
    rubies = parsed.rubies;
  } else {
    text = normalizeBody(text);
  }

  return { title, author, text, rubies, format: "txt" };
}
