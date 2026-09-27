import { describe, expect, it } from "vitest";
import { calculateChunkDuration, calculateRemainingTime } from "../src/lib/timing";

describe("RSVP timing", () => {
  it("uses character count and the words-per-minute setting", () => {
    expect(calculateChunkDuration({ text: "日本語", endsWithPunct: false }, 600)).toBe(300);
  });

  it("applies the 120ms floor before punctuation multipliers", () => {
    expect(calculateChunkDuration({ text: "語。", endsWithPunct: true }, 3000)).toBe(240);
  });

  it("uses a 1.5 multiplier for a Japanese comma and 2.0 for sentence punctuation", () => {
    expect(calculateChunkDuration({ text: "読む、", endsWithPunct: true }, 1500)).toBe(180);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600)).toBe(600);
    expect(calculateChunkDuration({ text: "読む」", endsWithPunct: true }, 600)).toBe(600);
  });

  it("uses the paragraph-end multiplier and can disable all punctuation pauses", () => {
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { paragraphEnd: true })).toBe(750);
    expect(calculateChunkDuration({ text: "読む。", endsWithPunct: true }, 600, { punctuationPause: false })).toBe(300);
  });

  it("sums the current and following chunk durations for the remaining time", () => {
    const chunks = [
      { text: "日本語", endsWithPunct: false },
      { text: "読む。", endsWithPunct: true },
      { text: "後続", endsWithPunct: false },
    ];

    expect(calculateRemainingTime(chunks, 1, 600)).toBe(1100);
    expect(calculateRemainingTime(chunks, 3, 600)).toBe(0);
  });
});
