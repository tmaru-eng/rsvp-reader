import { loadDefaultJapaneseParser } from "budoux";
import type { Chunk } from "./types";

const startsWithPunctuation = /^[、。，．！？…‥）〕］｝〉》」』】”’]/u;
const endsWithPunctuation = /[、。！？）」』】]$/u;
const japaneseParser = loadDefaultJapaneseParser();

export interface ChunkOptions {
  groupSize: 1 | 2 | 3;
  minChars: 0 | 2 | 3 | 4;
}

type Segmenter = (paragraph: string) => string[];

function countChars(value: string): number {
  return Array.from(value).length;
}

function mergeChunks(left: Chunk, right: Chunk): Chunk {
  const text = left.text + right.text;
  return { ...left, text, endsWithPunct: endsWithPunctuation.test(text) };
}

function groupSegments(paragraph: string, paragraphIndex: number, charOffset: number, segments: string[], groupSize: number): Chunk[] {
  const grouped: Chunk[] = [];
  let cursorUtf16 = 0;
  for (let index = 0; index < segments.length; index += groupSize) {
    const segmentGroup = segments.slice(index, index + groupSize);
    const text = segmentGroup.join("");
    const relativeStart = paragraph.indexOf(segmentGroup[0] ?? "", cursorUtf16);
    const startUtf16 = Math.max(relativeStart, cursorUtf16);
    const charStart = charOffset + countChars(paragraph.slice(0, startUtf16));
    cursorUtf16 = startUtf16 + text.length;
    if (text) grouped.push({ text, charStart, paragraphIndex, endsWithPunct: endsWithPunctuation.test(text) });
  }
  return grouped;
}

function attachPunctuation(chunks: Chunk[]): Chunk[] {
  const attached: Chunk[] = [];
  let leadingPunctuation: Chunk | undefined;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    if (!startsWithPunctuation.test(chunk.text)) {
      attached.push(chunk);
      continue;
    }
    const previous = attached.at(-1);
    if (previous) {
      attached[attached.length - 1] = mergeChunks(previous, chunk);
      continue;
    }
    leadingPunctuation = leadingPunctuation ? mergeChunks(leadingPunctuation, chunk) : chunk;
    continue;
  }
  if (leadingPunctuation) {
    const firstText = attached[0];
    if (firstText) {
      attached[0] = { ...mergeChunks(firstText, leadingPunctuation), charStart: leadingPunctuation.charStart };
    } else {
      attached.push(leadingPunctuation);
    }
  }
  return attached;
}

function enforceMinimumLength(chunks: Chunk[], minChars: number): Chunk[] {
  if (minChars === 0 || chunks.length < 2) return chunks;
  const result: Chunk[] = [];
  let pending: Chunk | undefined;

  for (const chunk of chunks) {
    pending = pending ? mergeChunks(pending, chunk) : chunk;
    if (countChars(pending.text) >= minChars) {
      result.push(pending);
      pending = undefined;
    }
  }

  if (pending) {
    const previous = result.at(-1);
    if (previous) result[result.length - 1] = mergeChunks(previous, pending);
    else result.push(pending);
  }
  return result;
}

export function buildChunks(
  text: string,
  options: ChunkOptions,
  segmenter: Segmenter = (paragraph) => japaneseParser.parse(paragraph),
): Chunk[] {
  const chunks: Chunk[] = [];
  let charOffset = 0;
  const paragraphs = text.split("\n");

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const leading = paragraph.match(/^\s*/u)?.[0] ?? "";
    const content = paragraph.trim();
    if (content) {
      const normalizedOffset = charOffset + countChars(leading);
      const segments = segmenter(content).filter(Boolean);
      const grouped = groupSegments(content, paragraphIndex, normalizedOffset, segments, options.groupSize);
      chunks.push(...enforceMinimumLength(attachPunctuation(grouped), options.minChars));
    }
    charOffset += countChars(paragraph) + 1;
  });

  return chunks;
}
