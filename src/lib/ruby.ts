import type { Ruby } from "./types";

export const RUBY_START_MARKER = "\u0000";
export const RUBY_END_MARKER = "\u0001";

export interface ParsedRubyText {
  text: string;
  rubies: Ruby[];
}

/** Markers keep ruby boundaries intact while surrounding whitespace is normalized. */
export function normalizeMarkedRubyText(
  markedText: string,
  readings: readonly string[],
  normalize: (text: string) => string,
): ParsedRubyText {
  const normalized = normalize(markedText);
  const markerPattern = /\u0000([\s\S]*?)\u0001/gu;
  const rubies: Ruby[] = [];
  let result = "";
  let characterCount = 0;
  let cursor = 0;
  let rubyIndex = 0;

  for (const match of normalized.matchAll(markerPattern)) {
    const markerIndex = match.index ?? cursor;
    const prefix = normalized.slice(cursor, markerIndex);
    result += prefix;
    characterCount += Array.from(prefix).length;

    const base = match[1] ?? "";
    const start = characterCount;
    result += base;
    characterCount += Array.from(base).length;
    const end = characterCount;
    const reading = readings[rubyIndex] ?? "";
    if (end > start && reading) rubies.push({ start, end, text: reading });

    cursor = markerIndex + match[0].length;
    rubyIndex += 1;
  }

  const suffix = normalized.slice(cursor);
  result += suffix;
  return { text: result, rubies };
}
