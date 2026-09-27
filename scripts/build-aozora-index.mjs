import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const CSV_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip";
const TREE_URL = "https://api.github.com/repos/aozorahack/aozorabunko_text/git/trees/master?recursive=1";

export function parseAozoraCsv(csv) {
  const records = [];
  const cells = [];
  let field = "";
  let inQuotes = false;
  const rows = [];

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (inQuotes) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      cells.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      cells.push(field);
      field = "";
      if (cells.some((cell) => cell !== "")) rows.push(cells.splice(0));
      else cells.length = 0;
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("青空文庫CSVの引用符が閉じていません。");
  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    rows.push(cells.splice(0));
  }
  if (rows.length === 0) throw new Error("青空文庫CSVが空です。");

  const headers = rows.shift().map((header, index) => index === 0 ? header.replace(/^\uFEFF/u, "") : header);
  const requiredHeaders = ["作品ID", "作品名", "作品名読み", "副題", "文字遣い種別", "作品著作権フラグ", "姓", "名", "姓読み", "名読み", "役割フラグ", "テキストファイルURL"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) throw new Error(`青空文庫CSVに必要な列がありません: ${missingHeaders.join("、")}`);

  for (const row of rows) {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    records.push(record);
  }
  return records;
}

export function mapAozoraTextUrlToPath(textUrl) {
  if (!textUrl) return null;
  try {
    const url = new URL(textUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.aozora.gr.jp") return null;
    const match = url.pathname.match(/^\/cards\/(\d+)\/files\/([^/]+)\.zip$/u);
    if (!match) return null;
    const authorId = match[1];
    const filename = decodeURIComponent(match[2]);
    return `cards/${authorId}/files/${filename}/${filename}.txt`;
  } catch {
    return null;
  }
}

export function buildAozoraIndex(rows, treePaths) {
  const grouped = new Map();
  for (const row of rows) {
    if (row["役割フラグ"] !== "著者") continue;
    const pathInMirror = mapAozoraTextUrlToPath(row["テキストファイルURL"]);
    if (!pathInMirror || !treePaths.has(pathInMirror)) continue;

    const id = row["作品ID"]?.trim();
    const title = row["作品名"]?.trim();
    if (!id || !title) continue;

    let work = grouped.get(id);
    if (!work) {
      work = {
        id,
        title,
        titleReading: row["作品名読み"] ?? "",
        subtitle: row["副題"] ?? "",
        authors: [],
        authorReadings: [],
        authorNamesSeen: new Set(),
        characterType: row["文字遣い種別"] ?? "",
        path: pathInMirror,
        copyrightFlag: row["作品著作権フラグ"] ?? "",
      };
      grouped.set(id, work);
    }
    if (work.path !== pathInMirror) continue;

    const author = `${row["姓"] ?? ""}${row["名"] ?? ""}`.trim();
    if (!author || work.authorNamesSeen.has(author)) continue;
    work.authorNamesSeen.add(author);
    work.authors.push(author);
    const reading = `${row["姓読み"] ?? ""}${row["名読み"] ?? ""}`.trim();
    if (reading) work.authorReadings.push(reading);
  }

  return [...grouped.values()].map((work) => [
    work.id,
    work.title,
    work.titleReading,
    work.subtitle,
    work.authors.join("、"),
    work.authorReadings.join("、"),
    work.characterType,
    work.path,
    work.copyrightFlag,
  ]);
}

export function getAozoraSampleBooks(source) {
  const start = source.indexOf("export const AOZORA_BOOKS");
  if (start < 0) throw new Error("aozora.ts に AOZORA_BOOKS が見つかりません。");
  const assignment = source.indexOf("=", start);
  const openBracket = source.indexOf("[", assignment);
  const closeBracket = source.indexOf("\n];", openBracket);
  if (assignment < 0 || openBracket < 0 || closeBracket < 0) throw new Error("AOZORA_BOOKS の配列を読み取れません。");
  const body = source.slice(openBracket + 1, closeBracket);
  const samples = [...body.matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*title:\s*"([^"]+)"\s*,\s*author:\s*"([^"]+)"\s*,\s*path:\s*"([^"]+)"\s*\}/gu)];
  if (samples.length !== 10) throw new Error(`AOZORA_BOOKS から既存の10作品を読み取れません (検出: ${samples.length}件)。`);
  return samples.map(([, id, title, author, pathInMirror]) => ({ id, title, author, path: pathInMirror }));
}

export function getAozoraSamplePaths(source) {
  return getAozoraSampleBooks(source).map(({ path: pathInMirror }) => pathInMirror);
}

async function checkedResponse(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} の取得に失敗しました (HTTP ${response.status})`);
  return response;
}

async function loadAozoraCsv() {
  const response = await checkedResponse(CSV_URL);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const csvEntry = Object.values(zip.files).find((file) => !file.dir && file.name.toLowerCase().endsWith(".csv"));
  if (!csvEntry) throw new Error("青空文庫一覧のZIPにCSVがありません。");
  return csvEntry.async("string");
}

async function loadMirrorTree() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "rsvp-reader-aozora-index-builder",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await checkedResponse(TREE_URL, { headers });
  const tree = await response.json();
  if (tree.truncated !== false) throw new Error("GitHub のファイル一覧が truncated です。完全な一覧が必要です。");
  if (!Array.isArray(tree.tree)) throw new Error("GitHub のファイル一覧形式が不正です。");
  return new Set(tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
}

export async function buildIndexFile() {
  const [csv, treePaths] = await Promise.all([loadAozoraCsv(), loadMirrorTree()]);
  const rows = parseAozoraCsv(csv);
  const index = buildAozoraIndex(rows, treePaths);
  const source = await readFile(path.join(repositoryRoot, "src/lib/aozora.ts"), "utf8");
  const samples = getAozoraSampleBooks(source);
  const missingFromMirror = samples.filter(({ path: samplePath }) => !treePaths.has(samplePath));
  if (missingFromMirror.length > 0) {
    throw new Error(`GitHub の写しに既存サンプルのパスがありません: ${missingFromMirror.map(({ path: samplePath }) => samplePath).join("、")}`);
  }
  const indexedPaths = new Set(index.map((row) => row[7]));
  const missingFromIndex = samples.filter(({ path: samplePath }) => !indexedPaths.has(samplePath));
  if (missingFromIndex.length > 0) {
    throw new Error(`生成インデックスに既存サンプルがありません: ${missingFromIndex.map(({ title }) => title).join("、")}`);
  }

  const publicDirectory = path.join(repositoryRoot, "public");
  await mkdir(publicDirectory, { recursive: true });
  const outputPath = path.join(publicDirectory, "aozora-index.json");
  const output = JSON.stringify({ v: 1, b: index });
  await writeFile(outputPath, output, "utf8");

  console.log(`Verified ${samples.length} existing works:`);
  for (const sample of samples) console.log(`  ${sample.title} — ${sample.author}`);
  console.log(`Generated public/aozora-index.json: ${index.length.toLocaleString("ja-JP")} works, ${Buffer.byteLength(output).toLocaleString("ja-JP")} bytes (${(Buffer.byteLength(output) / (1024 * 1024)).toFixed(2)} MiB).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildIndexFile();
}
