import type { TimedChunk } from "./types";

// 既定値の根拠は docs/research-defaults.md（2026-09-27 調査）。倍率と最短時間は日本語 RSVP の確立値がない仮置き。
const DEFAULT_TIMING = {
  proportionality: 100,
  commaPause: 1.3,
  sentencePause: 1.8,
  paragraphPause: 2.2,
  minDuration: 200,
} as const;
const commaPunctuation = /、$/u;
const sentencePunctuation = /[。！？」]$/u;

export interface TimingOptions {
  punctuationPause?: boolean;
  paragraphEnd?: boolean;
  maxChars?: number;
  proportionality?: number;
  commaPause?: number;
  sentencePause?: number;
  paragraphPause?: number;
  minDuration?: number;
  coefficient?: number;
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((width, character) => width + (/[A-Za-z0-9]/u.test(character) ? 0.5 : 1), 0);
}

export function calculateChunkDuration(chunk: TimedChunk, speed: number, options: TimingOptions = {}): number {
  const baselineChars = Math.min(options.maxChars ?? 5, 5);
  const proportionality = (options.proportionality ?? DEFAULT_TIMING.proportionality) / 100;
  const effectiveChars = proportionality * displayWidth(chunk.text) + (1 - proportionality) * baselineChars;
  const minDuration = options.minDuration ?? DEFAULT_TIMING.minDuration;
  const baseDuration = Math.max(minDuration, (effectiveChars / speed) * 60_000);
  let duration = baseDuration;
  if (options.punctuationPause !== false) {
    if (options.paragraphEnd) duration *= options.paragraphPause ?? DEFAULT_TIMING.paragraphPause;
    else if (commaPunctuation.test(chunk.text)) duration *= options.commaPause ?? DEFAULT_TIMING.commaPause;
    else if (chunk.endsWithPunct || sentencePunctuation.test(chunk.text)) {
      duration *= options.sentencePause ?? DEFAULT_TIMING.sentencePause;
    }
  }
  return Math.max(minDuration, duration * (options.coefficient ?? 1));
}

function isParagraphEnd<T extends TimedChunk>(chunks: readonly T[], index: number): boolean {
  const chunk = chunks[index];
  return Boolean(chunk && (index === chunks.length - 1 || chunks[index + 1]?.paragraphIndex !== chunk.paragraphIndex));
}

/** Find one book-wide scale that preserves pause ratios while targeting the requested reading speed. */
export function calculateTimingCoefficient<T extends TimedChunk>(
  chunks: readonly T[],
  speed: number,
  options: Omit<TimingOptions, "paragraphEnd" | "coefficient"> = {},
  totalChars = chunks.reduce((count, chunk) => count + Array.from(chunk.text).length, 0),
): number {
  if (chunks.length === 0 || totalChars <= 0 || speed <= 0) return 1;

  const minimum = options.minDuration ?? DEFAULT_TIMING.minDuration;
  const targetDuration = (totalChars / speed) * 60_000;
  if (targetDuration <= minimum * chunks.length) return 0;

  const durations = chunks.map((chunk, index) => calculateChunkDuration(chunk, speed, {
    ...options,
    paragraphEnd: isParagraphEnd(chunks, index),
  }));
  // Σ max(minimum, d × c) = target を正確に解く。長い区切りから順に「最短時間より長く伸びる側」に入れていき、
  // 条件を満たす最初の c を返す。二分探索で 7 万区切りを何十回も足し直していたのをやめた（長い本で重かった）。
  const sorted = [...durations].sort((left, right) => right - left);
  let linearSum = 0;
  for (let count = 1; count <= sorted.length; count += 1) {
    linearSum += sorted[count - 1] ?? 0;
    if (linearSum <= 0) continue;
    const coefficient = (targetDuration - minimum * (sorted.length - count)) / linearSum;
    const smallestLinear = sorted[count - 1] ?? 0;
    const nextDuration = sorted[count] ?? 0;
    if (smallestLinear * coefficient >= minimum && (count === sorted.length || nextDuration * coefficient < minimum)) return coefficient;
  }
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  return total > 0 ? targetDuration / total : 1;
}

export function calculateRemainingTime<T extends TimedChunk>(
  chunks: readonly T[],
  currentIndex: number,
  speed: number,
  options: Omit<TimingOptions, "paragraphEnd"> = {},
): number {
  let remaining = 0;
  for (let index = Math.max(0, currentIndex); index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const paragraphEnd = isParagraphEnd(chunks, index);
    remaining += calculateChunkDuration(chunk, speed, { ...options, paragraphEnd });
  }
  return remaining;
}
