import { describe, expect, it } from "vitest";
import { calculateChunkDuration, calculateRemainingTime } from "../src/lib/timing";

describe("RSVP timing", () => {
  it("uses displayed character width by default", () => {
    expect(calculateChunkDuration({ text: "日本語", endsWithPunct: false }, 600, { maxChars: 5 })).toBe(300);
  });

  it("counts half-width letters as half a character and caps the baseline at maxChars", () => {
    expect(calculateChunkDuration({ text: "ABCD", endsWithPunct: false }, 600, { maxChars: 5 })).toBe(200);
    expect(calculateChunkDuration({ text: "日本語", endsWithPunct: false }, 600, { maxChars: 3 })).toBe(300);
  });

  it("uses the baseline at zero proportionality and blends the two at intermediate values", () => {
    const chunk = { text: "日本語", endsWithPunct: false };

    expect(calculateChunkDuration(chunk, 600, { maxChars: 5, proportionality: 0 })).toBe(500);
    expect(calculateChunkDuration(chunk, 600, { maxChars: 5, proportionality: 50 })).toBe(400);
    expect(calculateChunkDuration(chunk, 600, { maxChars: 5, proportionality: 100 })).toBe(300);
  });

  it("applies the 150ms floor before punctuation multipliers", () => {
    expect(calculateChunkDuration({ text: "語。", endsWithPunct: true }, 3000, { maxChars: 5 })).toBe(240);
  });

  it("uses configurable multipliers for commas, sentences, and paragraph ends", () => {
    expect(calculateChunkDuration({ text: "読む、", endsWithPunct: true }, 600, { maxChars: 5, commaPause: 2 })).toBe(600);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5, sentencePause: 2.4 })).toBe(720);
    expect(calculateChunkDuration({ text: "読む」", endsWithPunct: true }, 600, { maxChars: 5, sentencePause: 2.4 })).toBe(720);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5, paragraphEnd: true, paragraphPause: 3 })).toBe(900);
  });

  it("uses the paragraph-end multiplier and can disable all punctuation pauses", () => {
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5, paragraphEnd: true })).toBe(540);
    expect(calculateChunkDuration({ text: "読む、", endsWithPunct: true }, 600, {
      maxChars: 5,
      punctuationPause: false,
      commaPause: 3,
      sentencePause: 3,
      paragraphPause: 4,
      paragraphEnd: true,
    })).toBe(300);
  });

  it("uses a configurable minimum duration", () => {
    expect(calculateChunkDuration({ text: "語", endsWithPunct: false }, 3000, {
      maxChars: 5,
      minDuration: 80,
    })).toBe(80);
  });

  it("sums the current and following chunk durations for the remaining time", () => {
    const chunks = [
      { text: "日本語", endsWithPunct: false },
      { text: "読む。", endsWithPunct: true },
      { text: "後続", endsWithPunct: false },
    ];

    expect(calculateRemainingTime(chunks, 1, 600, { maxChars: 5 })).toBe(840);
    expect(calculateRemainingTime(chunks, 3, 600, { maxChars: 5 })).toBe(0);
  });
});
