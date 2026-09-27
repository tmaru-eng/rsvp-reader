export interface AozoraIndexBook {
  id: string;
  title: string;
  titleReading: string;
  subtitle: string;
  authors: string;
  authorReadings: string;
  characterType: string;
  path: string;
  copyrightFlag: string;
}

export type CompactAozoraBook = readonly [
  id: string,
  title: string,
  titleReading: string,
  subtitle: string,
  authors: string,
  authorReadings: string,
  characterType: string,
  path: string,
  copyrightFlag: string,
];

export interface CompactAozoraIndex {
  v: 1;
  b: CompactAozoraBook[];
}

export const AOZORA_INDEX_MISSING_MESSAGE = "検索データがありません（npm run build:aozora）";

export function normalizeAozoraText(value: string): string {
  return Array.from(value.normalize("NFKC").toLocaleLowerCase("ja-JP"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x30a1 && codePoint <= 0x30f6) || codePoint === 0x30fd || codePoint === 0x30fe) {
      return String.fromCodePoint(codePoint - 0x60);
    }
    return character;
  }).join("");
}

export function parseAozoraIndex(payload: unknown): AozoraIndexBook[] {
  if (typeof payload !== "object" || payload === null || !("v" in payload) || !("b" in payload)) {
    throw new Error("青空文庫検索データの形式が不正です。");
  }
  const index = payload as { v: unknown; b: unknown };
  if (index.v !== 1 || !Array.isArray(index.b)) throw new Error("青空文庫検索データの形式が不正です。");

  return index.b.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 9 || row.some((value) => typeof value !== "string")) {
      throw new Error("青空文庫検索データの作品行が不正です。");
    }
    const [id, title, titleReading, subtitle, authors, authorReadings, characterType, path, copyrightFlag] = row as unknown as CompactAozoraBook;
    return { id, title, titleReading, subtitle, authors, authorReadings, characterType, path, copyrightFlag };
  });
}

export async function fetchAozoraIndex(
  request: typeof fetch = fetch,
  url = "aozora-index.json",
): Promise<AozoraIndexBook[] | null> {
  const response = await request(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAozoraIndex(await response.json());
}

// 同じ作品が複数の文字遣いで収録されているとき、読みやすい新字新仮名を先に出す。
const characterTypeOrder = ["新字新仮名", "新字旧仮名", "旧字新仮名", "旧字旧仮名"];

function characterTypeRank(characterType: string): number {
  const index = characterTypeOrder.indexOf(characterType);
  return index === -1 ? characterTypeOrder.length : index;
}

export function searchAozoraIndex(
  books: readonly AozoraIndexBook[],
  query: string,
  limit = 50,
): AozoraIndexBook[] {
  const terms = normalizeAozoraText(query).trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [];
  const joinedQuery = terms.join("");
  const matches: Array<{ book: AozoraIndexBook; titleRank: number; authorMatch: boolean; sourceOrder: number }> = [];

  books.forEach((book, sourceOrder) => {
    const title = normalizeAozoraText(book.title);
    const fields = [book.title, book.titleReading, book.subtitle, book.authors, book.authorReadings].map(normalizeAozoraText);
    if (!terms.every((term) => fields.some((field) => field.includes(term)))) return;

    const titleRank = title === joinedQuery ? 0 : title.startsWith(joinedQuery) ? 1 : 2;
    const authorNames = book.authors.split("、").map(normalizeAozoraText);
    const authorReadings = book.authorReadings.split("、").map(normalizeAozoraText);
    const authorMatch = [...authorNames, ...authorReadings].some((name) => name.length > 0 && terms.every((term) => name.includes(term)));
    matches.push({ book, titleRank, authorMatch, sourceOrder });
  });

  matches.sort((left, right) => left.titleRank - right.titleRank
    || Number(right.authorMatch) - Number(left.authorMatch)
    || characterTypeRank(left.book.characterType) - characterTypeRank(right.book.characterType)
    || left.sourceOrder - right.sourceOrder);
  return matches.slice(0, Math.max(0, limit)).map(({ book }) => book);
}
