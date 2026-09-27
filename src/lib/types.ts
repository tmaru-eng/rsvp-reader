export type BookFormat = "txt" | "pdf" | "epub";

export interface Ruby {
  start: number;
  end: number;
  text: string;
}

export interface ParsedBook {
  title: string;
  author: string;
  text: string;
  rubies: Ruby[];
  format: BookFormat;
  warning?: string;
}

export interface Chunk {
  text: string;
  charStart: number;
  paragraphIndex: number;
  endsWithPunct: boolean;
}

export interface TimedChunk {
  text: string;
  endsWithPunct: boolean;
  paragraphIndex?: number;
}

export interface BookRecord {
  id: string;
  title: string;
  author: string;
  text: string;
  rubies: Ruby[];
  position: number;
  /** 読んでいる位置（本文の何文字目か）。区切りの設定が変わっても同じ場所から再開できる。古いレコードにはない。 */
  charPosition?: number;
  /** ルビを解析できる版で保存したか。false や未設定なら、ルビ対応前に保存したレコード。 */
  rubySupport?: boolean;
  lastViewedAt: number;
  format: BookFormat;
  totalChars: number;
}
