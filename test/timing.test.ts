import { describe, expect, it } from "vitest";
import { calculateChunkDuration, calculateRemainingTime } from "../src/lib/timing";

describe("RSVP timing", () => {
  it("uses half the chunk length and half the maxChars-based baseline", () => {
    expect(calculateChunkDuration({ text: "日本語", endsWithPunct: false }, 600, { maxChars: 5 })).toBe(400);
  });

  it("counts half-width letters as half a character and caps the baseline at maxChars", () => {
    expect(calculateChunkDuration({ text: "AB", endsWithPunct: false }, 600, { maxChars: 5 })).toBe(300);
    expect(calculateChunkDuration({ text: "日本語", endsWithPunct: false }, 600, { maxChars: 3 })).toBe(300);
  });

  it("applies the 150ms floor before punctuation multipliers", () => {
    expect(calculateChunkDuration({ text: "語。", endsWithPunct: true }, 3000, { maxChars: 5 })).toBe(240);
  });

  it("uses 1.3 for commas and 1.6 for sentence punctuation and closing quotes", () => {
    expect(calculateChunkDuration({ text: "読む、", endsWithPunct: true }, 1500, { maxChars: 5 })).toBe(208);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5 })).toBe(640);
    expect(calculateChunkDuration({ text: "読む」", endsWithPunct: true }, 600, { maxChars: 5 })).toBe(640);
  });

  it("uses the paragraph-end multiplier and can disable all punctuation pauses", () => {
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5, paragraphEnd: true })).toBe(720);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { maxChars: 5, punctuationPause: false })).toBe(400);
  });

  it("sums the current and following chunk durations for the remaining time", () => {
    const chunks = [
      { text: "日本語", endsWithPunct: false },
      { text: "読む。", endsWithPunct: true },
      { text: "後続", endsWithPunct: false },
    ];

    expect(calculateRemainingTime(chunks, 1, 600, { maxChars: 5 })).toBe(1270);
    expect(calculateRemainingTime(chunks, 3, 600, { maxChars: 5 })).toBe(0);
  });
});
