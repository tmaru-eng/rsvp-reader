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

function scaledDurationSum<T extends TimedChunk>(durations: readonly number[], coefficient: number, minimum: number): number {
  return durations.reduce((sum, duration) => sum + Math.max(minimum, duration * coefficient), 0);
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
  let lower = 0;
  let upper = targetDuration / durations.reduce((sum, duration) => sum + duration, 0);
  if (!Number.isFinite(upper) || upper <= 0) return 1;
  while (scaledDurationSum(durations, upper, minimum) < targetDuration) upper *= 2;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (scaledDurationSum(durations, middle, minimum) < targetDuration) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
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
