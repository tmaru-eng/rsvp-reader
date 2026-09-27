import type { ParsedBook } from "./types";
import { parseTextDocument } from "./text";

export interface AozoraBook {
  id: string;
  title: string;
  author: string;
  path: string;
}

export const AOZORA_RAW_BASE = "https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/";

export const AOZORA_BOOKS: readonly AozoraBook[] = [
  { id: "kumono-ito", title: "蜘蛛の糸", author: "芥川龍之介", path: "cards/000879/files/92_ruby_164/92_ruby_164.txt" },
  { id: "rashomon", title: "羅生門", author: "芥川龍之介", path: "cards/000879/files/127_ruby_150/127_ruby_150.txt" },
  { id: "hashire-merosu", title: "走れメロス", author: "太宰治", path: "cards/000035/files/1567_ruby_4948/1567_ruby_4948.txt" },
  { id: "ningen-shikkaku", title: "人間失格", author: "太宰治", path: "cards/000035/files/301_ruby_5915/301_ruby_5915.txt" },
  { id: "ginga-tetsudo", title: "銀河鉄道の夜", author: "宮沢賢治", path: "cards/000081/files/43737_ruby_19028/43737_ruby_19028.txt" },
  { id: "chumon-ryoriten", title: "注文の多い料理店", author: "宮沢賢治", path: "cards/000081/files/43754_ruby_17594/43754_ruby_17594.txt" },
  { id: "botchan", title: "坊っちゃん", author: "夏目漱石", path: "cards/000148/files/752_ruby_2438/752_ruby_2438.txt" },
  { id: "kokoro", title: "こころ", author: "夏目漱石", path: "cards/000148/files/773_ruby_5968/773_ruby_5968.txt" },
  { id: "sangetsuki", title: "山月記", author: "中島敦", path: "cards/000119/files/624_ruby_5668/624_ruby_5668.txt" },
  { id: "takasebune", title: "高瀬舟", author: "森鴎外", path: "cards/000129/files/45245_ruby_21882/45245_ruby_21882.txt" },
];

export async function fetchAozoraBook(work: AozoraBook, request: typeof fetch = fetch): Promise<ParsedBook> {
  let response: Response;
  try {
    response = await request(`${AOZORA_RAW_BASE}${work.path}`);
  } catch {
    throw new Error("青空文庫から取得できませんでした。ネットワーク接続を確認してください。");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const parsed = parseTextDocument(bytes, `${work.title}.txt`);
  return { ...parsed, title: work.title, author: work.author };
}
