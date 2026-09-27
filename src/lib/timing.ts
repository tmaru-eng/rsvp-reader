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
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((width, character) => width + (/[A-Za-z0-9]/u.test(character) ? 0.5 : 1), 0);
}

export function calculateChunkDuration(chunk: TimedChunk, speed: number, options: TimingOptions = {}): number {
  const baselineChars = Math.min(options.maxChars ?? 5, 5);
  const proportionality = (options.proportionality ?? DEFAULT_TIMING.proportionality) / 100;
  const effectiveChars = proportionality * displayWidth(chunk.text) + (1 - proportionality) * baselineChars;
  const baseDuration = Math.max(options.minDuration ?? DEFAULT_TIMING.minDuration, (effectiveChars / speed) * 60_000);
  if (options.punctuationPause === false) return baseDuration;
  if (options.paragraphEnd) return baseDuration * (options.paragraphPause ?? DEFAULT_TIMING.paragraphPause);
  if (commaPunctuation.test(chunk.text)) return baseDuration * (options.commaPause ?? DEFAULT_TIMING.commaPause);
  if (chunk.endsWithPunct || sentencePunctuation.test(chunk.text)) {
    return baseDuration * (options.sentencePause ?? DEFAULT_TIMING.sentencePause);
  }
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
