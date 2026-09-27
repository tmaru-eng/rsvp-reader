import { describe, expect, it } from "vitest";
import {
  AOZORA_INDEX_MISSING_MESSAGE,
  fetchAozoraIndex,
  parseAozoraIndex,
  searchAozoraIndex,
} from "../src/lib/aozora-search";

function book(
  id: string,
  title: string,
  author = "作者",
  overrides: Partial<{
    titleReading: string;
    subtitle: string;
    authorReadings: string;
    characterType: string;
    path: string;
    copyrightFlag: string;
  }> = {},
) {
  return {
    id,
    title,
    titleReading: overrides.titleReading ?? "",
    subtitle: overrides.subtitle ?? "",
    authors: author,
    authorReadings: overrides.authorReadings ?? "",
    characterType: overrides.characterType ?? "新字新仮名",
    path: overrides.path ?? `cards/${id}/files/${id}/${id}.txt`,
    copyrightFlag: overrides.copyrightFlag ?? "なし",
  };
}

describe("Aozora search", () => {
  it("matches hiragana and katakana without distinguishing them", () => {
    const books = [book("1", "吾輩は猫", "夏目漱石", { titleReading: "わがはいはねこ" })];
    expect(searchAozoraIndex(books, "ネコ").map(({ id }) => id)).toEqual(["1"]);
  });

  it("normalizes compatibility characters with NFKC", () => {
    const books = [book("1", "ABCを読む")];
    expect(searchAozoraIndex(books, "ＡＢＣ").map(({ id }) => id)).toEqual(["1"]);
  });

  it("requires every whitespace-separated term to match", () => {
    const books = [
      book("1", "猫の話", "夏目漱石", { titleReading: "ねこのはなし" }),
      book("2", "猫の話", "別の人", { titleReading: "ねこのはなし" }),
    ];
    expect(searchAozoraIndex(books, "ねこ 夏目").map(({ id }) => id)).toEqual(["1"]);
  });

  it("ranks exact title, title prefix, then partial matches, preferring an author match within a rank", () => {
    const books = [
      book("partial", "黒猫の話", "別の人"),
      book("author", "黒猫記", "猫作家"),
      book("prefix", "猫の話", "別の人"),
      book("exact", "猫", "別の人"),
    ];
    expect(searchAozoraIndex(books, "猫").map(({ id }) => id)).toEqual(["exact", "prefix", "author", "partial"]);
  });

  it("returns at most fifty matches", () => {
    const books = Array.from({ length: 60 }, (_, index) => book(String(index), `猫の話${index}`));
    expect(searchAozoraIndex(books, "猫")).toHaveLength(50);
  });

  it("expands the compact generated index rows", () => {
    expect(parseAozoraIndex({
      v: 1,
      b: [["000001", "月の旅", "つきのたび", "旅", "佐藤花子", "さとうはなこ", "新字新仮名", "cards/000001/files/10/10.txt", "あり"]],
    })).toEqual([{
      id: "000001",
      title: "月の旅",
      titleReading: "つきのたび",
      subtitle: "旅",
      authors: "佐藤花子",
      authorReadings: "さとうはなこ",
      characterType: "新字新仮名",
      path: "cards/000001/files/10/10.txt",
      copyrightFlag: "あり",
    }]);
  });

  it("handles a missing generated index without throwing and provides the build instruction", async () => {
    const result = await fetchAozoraIndex(async () => new Response(null, { status: 404 }), "/aozora-index.json");
    expect(result).toBeNull();
    expect(AOZORA_INDEX_MISSING_MESSAGE).toBe("検索データがありません（npm run build:aozora）");
  });

  it("lists the modern-orthography edition first among otherwise equal matches", () => {
    const base = { titleReading: "れもん", subtitle: "", authors: "梶井基次郎", authorReadings: "かじいもとじろう", path: "p", copyrightFlag: "なし" };
    const books = [
      { ...base, id: "1", title: "檸檬", characterType: "旧字旧仮名" },
      { ...base, id: "2", title: "檸檬", characterType: "新字新仮名" },
    ];
    expect(searchAozoraIndex(books, "檸檬").map((book) => book.id)).toEqual(["2", "1"]);
  });
});
