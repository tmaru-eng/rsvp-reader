import type { TimedChunk } from "./types";

const MIN_DURATION_MS = 120;
const commaPunctuation = /、$/u;
const sentencePunctuation = /[。！？」]$/u;

export interface TimingOptions {
  punctuationPause?: boolean;
  paragraphEnd?: boolean;
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

export function calculateChunkDuration(chunk: TimedChunk, speed: number, options: TimingOptions = {}): number {
  const baseDuration = Math.max(MIN_DURATION_MS, (characterCount(chunk.text) / speed) * 60_000);
  if (options.punctuationPause === false) return baseDuration;
  if (options.paragraphEnd) return baseDuration * 2.5;
  if (commaPunctuation.test(chunk.text)) return baseDuration * 1.5;
  if (chunk.endsWithPunct || sentencePunctuation.test(chunk.text)) return baseDuration * 2;
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
