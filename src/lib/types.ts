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
  lastViewedAt: number;
  format: BookFormat;
  totalChars: number;
}
