import { characterTypeRank, normalizeAozoraText, type AozoraIndexBook } from "./aozora-search";

export const AOZORA_BROWSE_ROWS = [
  { key: "あ", label: "あ行", stages: ["あ", "い", "う", "え", "お"] },
  { key: "か", label: "か行", stages: ["か", "き", "く", "け", "こ"] },
  { key: "さ", label: "さ行", stages: ["さ", "し", "す", "せ", "そ"] },
  { key: "た", label: "た行", stages: ["た", "ち", "つ", "て", "と"] },
  { key: "な", label: "な行", stages: ["な", "に", "ぬ", "ね", "の"] },
  { key: "は", label: "は行", stages: ["は", "ひ", "ふ", "へ", "ほ"] },
  { key: "ま", label: "ま行", stages: ["ま", "み", "む", "め", "も"] },
  { key: "や", label: "や行", stages: ["や", "ゆ", "よ"] },
  { key: "ら", label: "ら行", stages: ["ら", "り", "る", "れ", "ろ"] },
  { key: "わ", label: "わ行", stages: ["わ"] },
  { key: "その他", label: "その他", stages: [] },
] as const;

export const AOZORA_BROWSE_PAGE_SIZE = 100;

export type AozoraBrowseRowKey = (typeof AOZORA_BROWSE_ROWS)[number]["key"];
export type AozoraReadingPosition = {
  row: AozoraBrowseRowKey;
  stage: string | null;
};

export interface AozoraBrowseAuthor {
  name: string;
  reading: string;
  books: readonly AozoraIndexBook[];
}

export interface AozoraBrowseIndex {
  booksByRow: ReadonlyMap<AozoraBrowseRowKey, readonly AozoraIndexBook[]>;
  booksByRowStage: ReadonlyMap<AozoraBrowseRowKey, ReadonlyMap<string, readonly AozoraIndexBook[]>>;
  authors: readonly AozoraBrowseAuthor[];
  authorsByRow: ReadonlyMap<AozoraBrowseRowKey, readonly AozoraBrowseAuthor[]>;
  authorsByRowStage: ReadonlyMap<AozoraBrowseRowKey, ReadonlyMap<string, readonly AozoraBrowseAuthor[]>>;
}

const positionByKana = new Map<string, AozoraReadingPosition>();
const voicedKana = new Map<string, string>([
  ["が", "か"], ["ぎ", "き"], ["ぐ", "く"], ["げ", "け"], ["ご", "こ"],
  ["ざ", "さ"], ["じ", "し"], ["ず", "す"], ["ぜ", "せ"], ["ぞ", "そ"],
  ["だ", "た"], ["ぢ", "ち"], ["づ", "つ"], ["で", "て"], ["ど", "と"],
  ["ば", "は"], ["び", "ひ"], ["ぶ", "ふ"], ["べ", "へ"], ["ぼ", "ほ"],
  ["ぱ", "は"], ["ぴ", "ひ"], ["ぷ", "ふ"], ["ぺ", "へ"], ["ぽ", "ほ"],
  ["ゔ", "う"],
]);
const smallKana = new Map<string, string>([
  ["ぁ", "あ"], ["ぃ", "い"], ["ぅ", "う"], ["ぇ", "え"], ["ぉ", "お"],
  ["ゃ", "や"], ["ゅ", "ゆ"], ["ょ", "よ"], ["っ", "つ"], ["ゎ", "わ"],
  ["ゕ", "か"], ["ゖ", "け"],
]);

for (const row of AOZORA_BROWSE_ROWS) {
  for (const stage of row.stages) positionByKana.set(stage, { row: row.key, stage });
}

function mapKana(position: AozoraReadingPosition, kana: string): void {
  for (const character of kana) positionByKana.set(character, position);
}

mapKana({ row: "わ", stage: "わ" }, "ゐゑを");

const otherPosition: AozoraReadingPosition = { row: "その他", stage: null };

export function normalizeAozoraReading(reading: string): string {
  // 「「しぜんを…」」のように読みの先頭にかっこや記号が付く作品を、「し」の行で正しく並べる。
  return normalizeAozoraText(reading).replace(/^[^\p{L}\p{N}]+/u, "");
}

export function getAozoraReadingPosition(reading: string): AozoraReadingPosition {
  const initial = Array.from(normalizeAozoraReading(reading))[0];
  if (!initial || !/^[\u3041-\u3096]$/u.test(initial)) return otherPosition;

  const fullKana = smallKana.get(initial) ?? initial;
  const unvoicedKana = voicedKana.get(fullKana) ?? fullKana;
  return positionByKana.get(unvoicedKana) ?? otherPosition;
}

function makeRowBuckets<T>(): Map<AozoraBrowseRowKey, T[]> {
  return new Map(AOZORA_BROWSE_ROWS.map(({ key }) => [key, []]));
}

function makeStageBuckets<T>(): Map<AozoraBrowseRowKey, Map<string, T[]>> {
  return new Map(AOZORA_BROWSE_ROWS.map(({ key, stages }) => [
    key,
    new Map(stages.map((stage) => [stage, []])),
  ]));
}

function addToBuckets<T>(
  item: T,
  position: AozoraReadingPosition,
  rowBuckets: Map<AozoraBrowseRowKey, T[]>,
  stageBuckets: Map<AozoraBrowseRowKey, Map<string, T[]>>,
): void {
  rowBuckets.get(position.row)?.push(item);
  if (position.stage) stageBuckets.get(position.row)?.get(position.stage)?.push(item);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "ja");
}

export function buildAozoraBrowseIndex(books: readonly AozoraIndexBook[]): AozoraBrowseIndex {
  const sortedBooks = books.map((book, sourceOrder) => ({
    book,
    reading: normalizeAozoraReading(book.titleReading),
    position: getAozoraReadingPosition(book.titleReading),
    sourceOrder,
  }));
  sortedBooks.sort((left, right) => compareText(left.reading, right.reading)
    || compareText(left.book.title, right.book.title)
    || characterTypeRank(left.book.characterType) - characterTypeRank(right.book.characterType)
    || left.sourceOrder - right.sourceOrder);

  const booksByRow = makeRowBuckets<AozoraIndexBook>();
  const booksByRowStage = makeStageBuckets<AozoraIndexBook>();
  const authorsByName = new Map<string, { name: string; reading: string; books: AozoraIndexBook[] }>();

  for (const { book, position } of sortedBooks) {
    addToBuckets(book, position, booksByRow, booksByRowStage);

    const authors = book.authors.split("、").map((author) => author.trim()).filter(Boolean);
    if (authors.length === 0) continue;
    const readings = book.authorReadings.split("、").map((reading) => reading.trim());
    const alignedReadings = readings.length === authors.length
      ? authors.map((name, index) => readings[index] || name)
      : authors;
    const seenOnBook = new Set<string>();

    authors.forEach((name, index) => {
      let author = authorsByName.get(name);
      if (!author) {
        author = { name, reading: alignedReadings[index] ?? name, books: [] };
        authorsByName.set(name, author);
      }
      if (!seenOnBook.has(name)) {
        author.books.push(book);
        seenOnBook.add(name);
      }
    });
  }

  const authors = [...authorsByName.values()].sort((left, right) => compareText(normalizeAozoraReading(left.reading), normalizeAozoraReading(right.reading))
    || compareText(left.name, right.name))
    .map(({ name, reading, books: authorBooks }) => ({ name, reading, books: authorBooks }));
  const authorsByRow = makeRowBuckets<AozoraBrowseAuthor>();
  const authorsByRowStage = makeStageBuckets<AozoraBrowseAuthor>();
  for (const author of authors) {
    addToBuckets(author, getAozoraReadingPosition(author.reading), authorsByRow, authorsByRowStage);
  }

  return {
    booksByRow,
    booksByRowStage,
    authors,
    authorsByRow,
    authorsByRowStage,
  };
}

const browseIndexCache = new WeakMap<readonly AozoraIndexBook[], AozoraBrowseIndex>();

export function getAozoraBrowseIndex(books: readonly AozoraIndexBook[]): AozoraBrowseIndex {
  const cached = browseIndexCache.get(books);
  if (cached) return cached;
  const browseIndex = buildAozoraBrowseIndex(books);
  browseIndexCache.set(books, browseIndex);
  return browseIndex;
}

export function getAozoraPage<T>(items: readonly T[], page: number, pageSize = AOZORA_BROWSE_PAGE_SIZE): T[] {
  const normalizedPage = Math.max(0, Math.floor(page));
  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  return items.slice(normalizedPage * normalizedPageSize, (normalizedPage + 1) * normalizedPageSize);
}
