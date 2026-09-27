import { describe, expect, it } from "vitest";
import { buildChunks } from "../src/lib/chunking";

describe("buildChunks", () => {
  it("combines the requested number of BudouX phrases without inserting spaces", () => {
    const text = "私は蜘蛛を見た。";
    const segments = ["私", "は", "蜘蛛", "を", "見た。"];
    const chunks = buildChunks(text, { groupSize: 2, minChars: 0, maxChars: 20 }, () => segments);

    expect(chunks.map(({ text: chunkText, charStart }) => [chunkText, charStart])).toEqual([
      ["私は", 0],
      ["蜘蛛を", 2],
      ["見た。", 5],
    ]);
  });

  it("uses the Japanese BudouX model by default", () => {
    const chunks = buildChunks("今日は天気です。", { groupSize: 1, minChars: 0, maxChars: 20 });

    expect(chunks.map(({ text }) => text)).toEqual(["今日は", "天気です。"]);
  });

  it("groups three phrases when requested", () => {
    const chunks = buildChunks("私は蜘蛛を見た。", { groupSize: 3, minChars: 0, maxChars: 20 }, () => ["私", "は", "蜘蛛", "を", "見た。"]);

    expect(chunks.map(({ text, charStart }) => [text, charStart])).toEqual([
      ["私は蜘蛛", 0],
      ["を見た。", 4],
    ]);
  });

  it("joins short chunks forward and attaches a short paragraph ending backward", () => {
    const text = "私は蜘蛛を見た。\n末";
    const chunks = buildChunks(
      text,
      { groupSize: 1, minChars: 3, maxChars: 20 },
      (paragraph) => (paragraph === "私は蜘蛛を見た。" ? ["私", "は", "蜘蛛", "を", "見た。"] : ["末"]),
    );

    expect(chunks.map(({ text: chunkText, charStart, paragraphIndex }) => [chunkText, charStart, paragraphIndex])).toEqual([
      ["私は蜘蛛", 0, 0],
      ["を見た。", 4, 0],
      ["末", 9, 1],
    ]);
  });

  it("attaches leftover short chunks at the end of a paragraph to the preceding chunk", () => {
    const chunks = buildChunks("読みやすい文章", { groupSize: 1, minChars: 4, maxChars: 20 }, () => ["読みやすい", "文", "章"]);

    expect(chunks.map(({ text: chunkText, charStart }) => [chunkText, charStart])).toEqual([["読みやすい文章", 0]]);
  });

  it("never starts a chunk with Japanese punctuation or closing brackets", () => {
    const text = "本文、）」";
    const chunks = buildChunks(text, { groupSize: 1, minChars: 0, maxChars: 20 }, () => ["本文", "、", "）", "」"]);

    expect(chunks.map(({ text: chunkText }) => chunkText)).toEqual(["本文、）」"]);
    expect(chunks.every(({ text: chunkText }) => !/^[、。，．！？…‥）〕］｝〉》」』】]/u.test(chunkText))).toBe(true);
  });

  it("keeps the source paragraph index and marks sentence-ending punctuation", () => {
    const chunks = buildChunks("一文。\n二文！", { groupSize: 1, minChars: 0, maxChars: 20 }, (paragraph) => [paragraph]);

    expect(chunks.map(({ paragraphIndex, endsWithPunct }) => [paragraphIndex, endsWithPunct])).toEqual([
      [0, true],
      [1, true],
    ]);
  });

  it("splits one oversized BudouX phrase into bounded chunks without unsafe beginnings", () => {
    const phrase = "なっていらっしゃいました。";
    const chunks = buildChunks(phrase, { groupSize: 1, minChars: 0, maxChars: 6 }, () => [phrase]);

    expect(chunks.map(({ text }) => text).join("")).toBe(phrase);
    expect(chunks.every(({ text }) => Array.from(text).length <= 6)).toBe(true);
    expect(chunks.every(({ text }) => !/^[、。，．！？…‥）〕］｝〉》」』】”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー]/u.test(text))).toBe(true);
  });

  it("splits an oversized phrase into balanced pieces instead of leaving a tiny tail", () => {
    const phrase = "なっていらっしゃいました。";
    const chunks = buildChunks(phrase, { groupSize: 1, minChars: 0, maxChars: 11 }, () => [phrase]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(phrase);
    const lengths = chunks.map((chunk) => Array.from(chunk.text).length);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(11);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2);
  });

  it("keeps a short heading-like line without punctuation as one chunk", () => {
    const chunks = buildChunks("はしがき\n私は、その男の写真を三葉、見たことがある。", { groupSize: 1, minChars: 0, maxChars: 10 });
    expect(chunks[0]?.text).toBe("はしがき");
    expect(chunks.slice(1).map((chunk) => chunk.text).join("")).toBe("私は、その男の写真を三葉、見たことがある。");
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("keeps punctuation, closing brackets, small kana and long vowel marks off chunk boundaries", () => {
    const phrase = "あいうえお、）ゃーかきくけこ。";
    const chunks = buildChunks(phrase, { groupSize: 1, minChars: 0, maxChars: 5 }, () => [phrase]);
    const unsafeStarts = new Set(Array.from("、。，．・：；？！,.:;!?…‥）〕］｝〉》」』】”’)]}»›ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶヷヸヹヺー"));

    expect(chunks.map(({ text }) => text).join("")).toBe(phrase);
    expect(chunks.every(({ text }) => Array.from(text).length <= 5)).toBe(true);
    expect(chunks.every(({ text }) => !unsafeStarts.has(Array.from(text)[0] ?? ""))).toBe(true);
  });

  it("counts half-width Latin letters as half a display character", () => {
    const chunks = buildChunks("ABC日本語", { groupSize: 1, minChars: 0, maxChars: 4 }, () => ["ABC日本語"]);

    expect(chunks.map(({ text }) => text).join("")).toBe("ABC日本語");
    expect(chunks.every(({ text }) => Array.from(text).reduce((width, char) => width + (/[A-Za-z0-9]/u.test(char) ? 0.5 : 1), 0) <= 4)).toBe(true);
  });

  it("does not let groupSize combine phrases past maxChars", () => {
    const chunks = buildChunks("ああいいううええ", { groupSize: 3, minChars: 0, maxChars: 3 }, () => ["ああ", "いい", "うう", "ええ"]);

    expect(chunks.map(({ text }) => text).join("")).toBe("ああいいううええ");
    expect(chunks.every(({ text }) => Array.from(text).length <= 3)).toBe(true);
  });

  it("does not let minChars combine chunks past maxChars", () => {
    const chunks = buildChunks("あいうえ", { groupSize: 1, minChars: 4, maxChars: 2 }, () => ["あ", "い", "う", "え"]);

    expect(chunks.map(({ text }) => text).join("")).toBe("あいうえ");
    expect(chunks.every(({ text }) => Array.from(text).length <= 2)).toBe(true);
  });
});
