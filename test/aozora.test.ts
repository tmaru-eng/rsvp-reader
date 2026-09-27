import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AOZORA_BOOKS, AOZORA_RAW_BASE, fetchAozoraBook } from "../src/lib/aozora";

const aozoraFixture = new URL("./fixtures/kumo-no-ito-sjis.txt", import.meta.url);

describe("Aozora sample books", () => {
  it("provides the ten requested works with their confirmed raw paths", () => {
    expect(AOZORA_BOOKS.map(({ title, author, path }) => [title, author, path])).toEqual([
      ["蜘蛛の糸", "芥川龍之介", "cards/000879/files/92_ruby_164/92_ruby_164.txt"],
      ["羅生門", "芥川龍之介", "cards/000879/files/127_ruby_150/127_ruby_150.txt"],
      ["走れメロス", "太宰治", "cards/000035/files/1567_ruby_4948/1567_ruby_4948.txt"],
      ["人間失格", "太宰治", "cards/000035/files/301_ruby_5915/301_ruby_5915.txt"],
      ["銀河鉄道の夜", "宮沢賢治", "cards/000081/files/43737_ruby_19028/43737_ruby_19028.txt"],
      ["注文の多い料理店", "宮沢賢治", "cards/000081/files/43754_ruby_17594/43754_ruby_17594.txt"],
      ["坊っちゃん", "夏目漱石", "cards/000148/files/752_ruby_2438/752_ruby_2438.txt"],
      ["こころ", "夏目漱石", "cards/000148/files/773_ruby_5968/773_ruby_5968.txt"],
      ["山月記", "中島敦", "cards/000119/files/624_ruby_5668/624_ruby_5668.txt"],
      ["高瀬舟", "森鴎外", "cards/000129/files/45245_ruby_21882/45245_ruby_21882.txt"],
    ]);
  });

  it("parses fetched Shift_JIS text with the existing Aozora parser", async () => {
    const bytes = new Uint8Array(await readFile(aozoraFixture));
    let requestedUrl = "";
    const book = await fetchAozoraBook(AOZORA_BOOKS[0], async (input) => {
      requestedUrl = String(input);
      return new Response(bytes);
    });

    expect(requestedUrl).toBe("https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/000879/files/92_ruby_164/92_ruby_164.txt");
    expect(book).toMatchObject({
      title: "蜘蛛の糸",
      author: "芥川龍之介",
      format: "txt",
    });
    expect(book.text).toContain("ある日の事でございます。");
  });

  it("reports HTTP failures while fetching a sample", async () => {
    await expect(fetchAozoraBook(AOZORA_BOOKS[0], async () => new Response(null, { status: 503 }))).rejects.toThrow("HTTP 503");
    expect(AOZORA_RAW_BASE).toBe("https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/");
  });

  it("explains network failures in Japanese", async () => {
    await expect(fetchAozoraBook(AOZORA_BOOKS[0], async () => {
      throw new TypeError("Failed to fetch");
    })).rejects.toThrow("ネットワーク接続を確認してください");
  });
});
