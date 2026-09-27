export interface AozoraCsvRow {
  [column: string]: string;
}

export function parseAozoraCsv(csv: string): AozoraCsvRow[];
export function mapAozoraTextUrlToPath(textUrl: string): string | null;
export function buildAozoraIndex(rows: readonly AozoraCsvRow[], treePaths: ReadonlySet<string>): string[][];
export function getAozoraSampleBooks(source: string): Array<{ id: string; title: string; author: string; path: string }>;
export function getAozoraSamplePaths(source: string): string[];
export function buildIndexFile(): Promise<void>;
