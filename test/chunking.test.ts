import { describe, expect, it } from "vitest";
import { buildChunks } from "../src/lib/chunking";

describe("buildChunks", () => {
  it("combines the requested number of BudouX phrases without inserting spaces", () => {
    const text = "私は蜘蛛を見た。";
    const segments = ["私", "は", "蜘蛛", "を", "見た。"];
    const chunks = buildChunks(text, { groupSize: 2, minChars: 0 }, () => segments);

    expect(chunks.map(({ text: chunkText, charStart }) => [chunkText, charStart])).toEqual([
      ["私は", 0],
      ["蜘蛛を", 2],
      ["見た。", 5],
    ]);
  });

  it("uses the Japanese BudouX model by default", () => {
    const chunks = buildChunks("今日は天気です。", { groupSize: 1, minChars: 0 });

    expect(chunks.map(({ text }) => text)).toEqual(["今日は", "天気です。"]);
  });

  it("groups three phrases when requested", () => {
    const chunks = buildChunks("私は蜘蛛を見た。", { groupSize: 3, minChars: 0 }, () => ["私", "は", "蜘蛛", "を", "見た。"]);

    expect(chunks.map(({ text, charStart }) => [text, charStart])).toEqual([
      ["私は蜘蛛", 0],
      ["を見た。", 4],
    ]);
  });

  it("joins short chunks forward and attaches a short paragraph ending backward", () => {
    const text = "私は蜘蛛を見た。\n末";
    const chunks = buildChunks(
      text,
      { groupSize: 1, minChars: 3 },
      (paragraph) => (paragraph === "私は蜘蛛を見た。" ? ["私", "は", "蜘蛛", "を", "見た。"] : ["末"]),
    );

    expect(chunks.map(({ text: chunkText, charStart, paragraphIndex }) => [chunkText, charStart, paragraphIndex])).toEqual([
      ["私は蜘蛛", 0, 0],
      ["を見た。", 4, 0],
      ["末", 9, 1],
    ]);
  });

  it("attaches leftover short chunks at the end of a paragraph to the preceding chunk", () => {
    const chunks = buildChunks("読みやすい文章", { groupSize: 1, minChars: 4 }, () => ["読みやすい", "文", "章"]);

    expect(chunks.map(({ text: chunkText, charStart }) => [chunkText, charStart])).toEqual([["読みやすい文章", 0]]);
  });

  it("never starts a chunk with Japanese punctuation or closing brackets", () => {
    const text = "本文、）」";
    const chunks = buildChunks(text, { groupSize: 1, minChars: 0 }, () => ["本文", "、", "）", "」"]);

    expect(chunks.map(({ text: chunkText }) => chunkText)).toEqual(["本文、）」"]);
    expect(chunks.every(({ text: chunkText }) => !/^[、。，．！？…‥）〕］｝〉》」』】]/u.test(chunkText))).toBe(true);
  });

  it("keeps the source paragraph index and marks sentence-ending punctuation", () => {
    const chunks = buildChunks("一文。\n二文！", { groupSize: 1, minChars: 0 }, (paragraph) => [paragraph]);

    expect(chunks.map(({ paragraphIndex, endsWithPunct }) => [paragraphIndex, endsWithPunct])).toEqual([
      [0, true],
      [1, true],
    ]);
  });
});
