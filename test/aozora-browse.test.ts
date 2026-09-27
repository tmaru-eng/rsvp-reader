import { describe, expect, it } from "vitest";
import type { AozoraIndexBook } from "../src/lib/aozora-search";
import {
  AOZORA_BROWSE_PAGE_SIZE,
  buildAozoraBrowseIndex,
  getAozoraBrowseIndex,
  getAozoraPage,
  getAozoraReadingPosition,
  normalizeAozoraReading,
} from "../src/lib/aozora-browse";

function book(
  id: string,
  title: string,
  titleReading: string,
  authors = "作者",
  authorReadings = "さくしゃ",
  characterType = "新字新仮名",
): AozoraIndexBook {
  return {
    id,
    title,
    titleReading,
    subtitle: "",
    authors,
    authorReadings,
    characterType,
    path: `cards/${id}/files/${id}/${id}.txt`,
    copyrightFlag: "なし",
  };
}

describe("Aozora browse kana", () => {
  it.each([
    ["がく", { row: "か", stage: "か" }],
    ["ぱん", { row: "は", stage: "は" }],
    ["ぁさ", { row: "あ", stage: "あ" }],
    ["ゃま", { row: "や", stage: "や" }],
    ["っぷ", { row: "た", stage: "つ" }],
    ["ヴェル", { row: "あ", stage: "う" }],
    ["カタカナ", { row: "か", stage: "か" }],
    ["ｶﾞｸ", { row: "か", stage: "か" }],
    ["吾輩", { row: "その他", stage: null }],
    ["", { row: "その他", stage: null }],
  ] as const)("places %s in the expected gojuon position", (reading, expected) => {
    expect(getAozoraReadingPosition(reading)).toEqual(expected);
  });
});

describe("Aozora browse index", () => {
  it("sorts title readings, then title names, then character types", () => {
    const books = [
      book("b", "B作品", "ア"),
      book("old", "A作品", "あ", "作者", "さくしゃ", "旧字旧仮名"),
      book("ka", "別作品", "か"),
      book("modern", "A作品", "あ", "作者", "さくしゃ", "新字新仮名"),
      book("new-old", "A作品", "あ", "作者", "さくしゃ", "新字旧仮名"),
      book("old-new", "A作品", "あ", "作者", "さくしゃ", "旧字新仮名"),
      book("i", "A作品", "い"),
    ];

    expect(buildAozoraBrowseIndex(books).booksByRow.get("あ")?.map(({ id }) => id))
      .toEqual(["modern", "new-old", "old-new", "old", "b", "i"]);
    expect(buildAozoraBrowseIndex(books).booksByRow.get("か")?.map(({ id }) => id)).toEqual(["ka"]);
  });

  it("lists each coauthor with their work count and falls back to names when readings do not align", () => {
    const books = [
      book("one", "一作品", "いっさくひん", "佐藤花子、山田太郎", "さとうはなこ、やまだたろう"),
      book("two", "二作品", "にさくひん", "佐藤花子", "さとうはなこ"),
      book("three", "三作品", "さんさくひん", "田中一郎、林", "たなかいちろう"),
    ];
    const browse = buildAozoraBrowseIndex(books);
    const sato = browse.authors.find(({ name }) => name === "佐藤花子");
    const yamada = browse.authors.find(({ name }) => name === "山田太郎");
    const tanaka = browse.authors.find(({ name }) => name === "田中一郎");
    const hayashi = browse.authors.find(({ name }) => name === "林");

    expect(sato?.books.map(({ id }) => id)).toEqual(["one", "two"]);
    expect(yamada?.books.map(({ id }) => id)).toEqual(["one"]);
    expect(tanaka?.reading).toBe("田中一郎");
    expect(hayashi?.reading).toBe("林");
    expect(browse.authorsByRow.get("さ")?.map(({ name, books: authorBooks }) => [name, authorBooks.length]))
      .toContainEqual(["佐藤花子", 2]);
    expect(browse.authorsByRow.get("その他")?.map(({ name }) => name)).toEqual(["田中一郎", "林"]);
  });

  it("caches the aggregate for the same loaded index", () => {
    const books = [book("one", "一作品", "いっさくひん")];

    expect(getAozoraBrowseIndex(books)).toBe(getAozoraBrowseIndex(books));
  });
});

describe("Aozora browse pagination", () => {
  it("returns consecutive pages of one hundred and a short final page", () => {
    const items = Array.from({ length: AOZORA_BROWSE_PAGE_SIZE * 2 + 1 }, (_, index) => index);

    expect(getAozoraPage(items, 0)).toHaveLength(100);
    expect(getAozoraPage(items, 1)).toEqual(Array.from({ length: 100 }, (_, index) => index + 100));
    expect(getAozoraPage(items, 2)).toEqual([200]);
    expect(getAozoraPage(items, 3)).toEqual([]);
  });

  it("ignores leading brackets and symbols in readings", () => {
    expect(getAozoraReadingPosition("「しぜんをうつすぶんしょう」")).toEqual({ row: "さ", stage: "し" });
    expect(normalizeAozoraReading("『こころ』")).toBe("こころ』");
  });
});

