import type { TimedChunk } from "./types";

const MIN_DURATION_MS = 150;
const commaPunctuation = /、$/u;
const sentencePunctuation = /[。！？」]$/u;

export interface TimingOptions {
  punctuationPause?: boolean;
  paragraphEnd?: boolean;
  maxChars?: number;
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((width, character) => width + (/[A-Za-z0-9]/u.test(character) ? 0.5 : 1), 0);
}

export function calculateChunkDuration(chunk: TimedChunk, speed: number, options: TimingOptions = {}): number {
  const baselineChars = Math.min(options.maxChars ?? 5, 5);
  const effectiveChars = 0.5 * displayWidth(chunk.text) + 0.5 * baselineChars;
  const baseDuration = Math.max(MIN_DURATION_MS, (effectiveChars / speed) * 60_000);
  if (options.punctuationPause === false) return baseDuration;
  if (options.paragraphEnd) return baseDuration * 1.8;
  if (commaPunctuation.test(chunk.text)) return baseDuration * 1.3;
  if (chunk.endsWithPunct || sentencePunctuation.test(chunk.text)) return baseDuration * 1.6;
  return baseDuration;
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
    const paragraphEnd = index === chunks.length - 1 || chunks[index + 1]?.paragraphIndex !== chunk.paragraphIndex;
    remaining += calculateChunkDuration(chunk, speed, { ...options, paragraphEnd });
  }
  return remaining;
}
