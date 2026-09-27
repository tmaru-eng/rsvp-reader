import { loadDefaultJapaneseParser } from "budoux";
import type { Chunk, Ruby } from "./types";

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

const kanaRun = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/**
 * 「ざら｜ざら」「ぺか｜ぺか」のように、繰り返しの言葉（畳語）を割る BudouX の切れ目をつなぐ。
 * 2026-09-27 の Jev 評価で、自然さの確率が最も低かった切れ目の型。
 */
function mergeReduplication(segments: string[]): string[] {
  const result: string[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous !== undefined && splitsReduplication(previous, segment)) {
      result[result.length - 1] = previous + segment;
    } else {
      result.push(segment);
    }
  }
  return result;
}

function splitsReduplication(left: string, right: string): boolean {
  const leftCharacters = Array.from(left);
  for (let length = 2; length <= 4 && length <= leftCharacters.length; length += 1) {
    const tail = leftCharacters.slice(-length).join("");
    if (kanaRun.test(tail) && right.startsWith(tail)) return true;
  }
  return false;
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

interface SegmentPart {
  text: string;
  start: number;
  end: number;
  isRuby: boolean;
}

function makeSegmentParts(paragraph: string, inputSegments: string[], rubyRanges: readonly Ruby[]): SegmentPart[] {
  const segments = attachLeadingCharacters(mergeReduplication(inputSegments.filter(Boolean)));
  const characterCount = countSourceChars(paragraph);
  const boundaries = new Set<number>([0, characterCount]);
  let cursorUtf16 = 0;

  for (const segment of segments) {
    const relativeStart = paragraph.indexOf(segment, cursorUtf16);
    const startUtf16 = relativeStart >= 0 ? relativeStart : cursorUtf16;
    const start = countSourceChars(paragraph.slice(0, startUtf16));
    const end = start + countSourceChars(segment);
    boundaries.add(start);
    boundaries.add(end);
    cursorUtf16 = startUtf16 + segment.length;
  }

  // ルビの親文字の前後を新しい切れ目にはしない（「金色《きんいろ》の」を「金色／の」と割らない）。
  // 親文字の途中にある BudouX の切れ目だけを取り除く。
  const orderedBoundaries = [...boundaries]
    .filter((boundary) => !rubyRanges.some((ruby) => ruby.start < boundary && boundary < ruby.end))
    .sort((left, right) => left - right);
  const characters = Array.from(paragraph);
  const parts: SegmentPart[] = [];
  for (let index = 1; index < orderedBoundaries.length; index += 1) {
    const start = orderedBoundaries[index - 1];
    const end = orderedBoundaries[index];
    if (start === undefined || end === undefined || end <= start) continue;
    parts.push({
      text: characters.slice(start, end).join(""),
      start,
      end,
      // ルビを含む区切りは、長すぎても親文字を割らないよう分割しない。
      isRuby: rubyRanges.some((ruby) => ruby.start < end && start < ruby.end),
    });
  }
  return parts;
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
  rubyRanges: readonly Ruby[],
): Chunk[] {
  const segments = makeSegmentParts(paragraph, inputSegments, rubyRanges);
  const grouped: Chunk[] = [];
  let pending: Chunk | undefined;
  let pendingSegmentCount = 0;

  const flushPending = (): void => {
    if (pending) grouped.push(pending);
    pending = undefined;
    pendingSegmentCount = 0;
  };

  for (const part of segments) {
    const segment = part.text;
    const charStart = charOffset + part.start;
    if (part.isRuby && displayWidth(segment) > maxChars) {
      flushPending();
      grouped.push({ text: segment, charStart, paragraphIndex, endsWithPunct: endsWithPunctuation.test(segment) });
      continue;
    }

    const pieces = part.isRuby ? [segment] : splitOversizedSegment(segment, maxChars);

    if (pieces.length > 1 || displayWidth(segment) > maxChars) {
      flushPending();
      let pieceStart = part.start;
      for (const piece of pieces) {
        grouped.push({ text: piece, charStart: charOffset + pieceStart, paragraphIndex, endsWithPunct: endsWithPunctuation.test(piece) });
        pieceStart += countSourceChars(piece);
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
  rubies: readonly Ruby[] = [],
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
      const contentLength = countSourceChars(content);
      const paragraphRubies = rubies
        .filter((ruby) => ruby.start >= normalizedOffset && ruby.end <= normalizedOffset + contentLength)
        .map((ruby) => ({ ...ruby, start: ruby.start - normalizedOffset, end: ruby.end - normalizedOffset }));
      const grouped = groupSegments(content, paragraphIndex, normalizedOffset, segments, options.groupSize, maxChars, paragraphRubies);
      chunks.push(...enforceMinimumLength(grouped, options.minChars, maxChars));
    }
    charOffset += countSourceChars(paragraph) + 1;
  });

  return chunks;
}
