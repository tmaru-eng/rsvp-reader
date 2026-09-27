import { loadDefaultJapaneseParser } from "budoux";
import type { Chunk } from "./types";

const unsafeChunkStarts = new Set(Array.from("、。，．・：；？！,.:;!?…‥）〕］｝〉》」』】”’)]}»›ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶヷヸヹヺー"));
const endsWithPunctuation = /[、。！？）」』】]$/u;
const japaneseParser = loadDefaultJapaneseParser();

export interface ChunkOptions {
  groupSize: 1 | 2 | 3;
  minChars: 0 | 2 | 3 | 4;
  maxChars: number;
}

type Segmenter = (paragraph: string) => string[];

function countSourceChars(value: string): number {
  return Array.from(value).length;
}

function displayWidth(value: string): number {
  return Array.from(value).reduce((width, character) => width + (/[A-Za-z0-9]/u.test(character) ? 0.5 : 1), 0);
}

function startsUnsafeChunk(value: string): boolean {
  return unsafeChunkStarts.has(Array.from(value)[0] ?? "");
}

function mergeChunks(left: Chunk, right: Chunk): Chunk {
  const text = left.text + right.text;
  return { ...left, text, endsWithPunct: endsWithPunctuation.test(text) };
}

function attachLeadingCharacters(segments: string[]): string[] {
  const result: string[] = [];
  let leading = "";

  for (const segment of segments) {
    if (startsUnsafeChunk(segment)) {
      if (result.length > 0) result[result.length - 1] += segment;
      else leading += segment;
    } else {
      result.push(leading + segment);
      leading = "";
    }
  }

  if (leading) {
    if (result.length > 0) result[0] = leading + result[0];
    else result.push(leading);
  }
  return result;
}

function splitOversizedSegment(segment: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  // 末尾に短い切れ端（例：「…まし」「た。」）が残らないよう、均等な長さで切る。
  const pieceCount = Math.ceil(displayWidth(segment) / maxChars);
  const targetChars = pieceCount > 1 ? Math.min(maxChars, Math.ceil(displayWidth(segment) / pieceCount)) : maxChars;

  for (const character of Array.from(segment)) {
    if (current && displayWidth(current + character) > targetChars) {
      if (startsUnsafeChunk(character)) {
        const currentCharacters = Array.from(current);
        const carriedCharacter = currentCharacters.pop();
        const prefix = currentCharacters.join("");
        if (prefix && carriedCharacter) {
          pieces.push(prefix);
          current = carriedCharacter + character;
        } else {
          current += character;
        }
      } else {
        pieces.push(current);
        current = character;
      }
    } else {
      current += character;
    }
  }

  if (current) pieces.push(current);

  // A protected character at a cut belongs with the preceding text. Rebalance
  // by carrying its preceding character forward so neither piece exceeds max.
  for (let index = 1; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (!piece || !startsUnsafeChunk(piece)) continue;
    const previous = pieces[index - 1];
    const previousCharacters = Array.from(previous ?? "");
    const carriedCharacter = previousCharacters.pop();
    if (!carriedCharacter) continue;
    pieces[index - 1] = previousCharacters.join("");
    pieces[index] = carriedCharacter + piece;
  }

  return pieces.filter(Boolean);
}

function groupSegments(
  paragraph: string,
  paragraphIndex: number,
  charOffset: number,
  inputSegments: string[],
  groupSize: number,
  maxChars: number,
): Chunk[] {
  const segments = attachLeadingCharacters(inputSegments.filter(Boolean));
  const grouped: Chunk[] = [];
  let cursorUtf16 = 0;
  let pending: Chunk | undefined;
  let pendingSegmentCount = 0;

  const flushPending = (): void => {
    if (pending) grouped.push(pending);
    pending = undefined;
    pendingSegmentCount = 0;
  };

  for (const segment of segments) {
    const relativeStart = paragraph.indexOf(segment, cursorUtf16);
    const startUtf16 = relativeStart >= 0 ? relativeStart : cursorUtf16;
    cursorUtf16 = startUtf16 + segment.length;
    const charStart = charOffset + countSourceChars(paragraph.slice(0, startUtf16));
    const pieces = splitOversizedSegment(segment, maxChars);

    if (pieces.length > 1 || displayWidth(segment) > maxChars) {
      flushPending();
      let pieceUtf16 = startUtf16;
      for (const piece of pieces) {
        const pieceStart = charOffset + countSourceChars(paragraph.slice(0, pieceUtf16));
        grouped.push({ text: piece, charStart: pieceStart, paragraphIndex, endsWithPunct: endsWithPunctuation.test(piece) });
        pieceUtf16 += piece.length;
      }
      continue;
    }

    const currentWidth = pending ? displayWidth(pending.text) : 0;
    if (pending && (pendingSegmentCount >= groupSize || currentWidth + displayWidth(segment) > maxChars)) {
      flushPending();
    }

    const segmentChunk: Chunk = { text: segment, charStart, paragraphIndex, endsWithPunct: endsWithPunctuation.test(segment) };
    if (pending) {
      pending = mergeChunks(pending, segmentChunk);
      pendingSegmentCount += 1;
    } else {
      pending = segmentChunk;
      pendingSegmentCount = 1;
    }
  }

  flushPending();
  return grouped;
}

function enforceMinimumLength(chunks: Chunk[], minChars: number, maxChars: number): Chunk[] {
  if (minChars === 0 || chunks.length < 2) return chunks;
  const result: Chunk[] = [];
  let pending: Chunk | undefined;

  for (const chunk of chunks) {
    if (!pending) {
      pending = chunk;
    } else if (displayWidth(pending.text + chunk.text) <= maxChars) {
      pending = mergeChunks(pending, chunk);
    } else {
      result.push(pending);
      pending = chunk;
    }

    if (pending && displayWidth(pending.text) >= minChars) {
      result.push(pending);
      pending = undefined;
    }
  }

  if (pending) {
    const previous = result.at(-1);
    if (previous && displayWidth(previous.text + pending.text) <= maxChars) {
      result[result.length - 1] = mergeChunks(previous, pending);
    } else {
      result.push(pending);
    }
  }
  return result;
}

const HEADING_MAX_CHARS = 8;
const headingBreakers = /[、。，．！？!?「」『』（）()…‥]/u;

export function buildChunks(
  text: string,
  options: ChunkOptions,
  segmenter: Segmenter = (paragraph) => japaneseParser.parse(paragraph),
): Chunk[] {
  const chunks: Chunk[] = [];
  const maxChars = Math.max(1, options.maxChars);
  let charOffset = 0;
  const paragraphs = text.split("\n");

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const leading = paragraph.match(/^\s*/u)?.[0] ?? "";
    const content = paragraph.trim();
    if (content) {
      const normalizedOffset = charOffset + countSourceChars(leading);
      // 見出しのような短く句読点のない行（例：「はしがき」）は、BudouX が細かく割りすぎるので分けない。
      const headingLike = displayWidth(content) <= Math.min(maxChars, HEADING_MAX_CHARS) && !headingBreakers.test(content);
      const segments = headingLike ? [content] : segmenter(content).filter(Boolean);
      const grouped = groupSegments(content, paragraphIndex, normalizedOffset, segments, options.groupSize, maxChars);
      chunks.push(...enforceMinimumLength(grouped, options.minChars, maxChars));
    }
    charOffset += countSourceChars(paragraph) + 1;
  });

  return chunks;
}
