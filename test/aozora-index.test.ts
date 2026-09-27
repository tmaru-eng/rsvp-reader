import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AOZORA_BOOKS } from "../src/lib/aozora";
import { buildAozoraIndex, getAozoraSamplePaths, mapAozoraTextUrlToPath, parseAozoraCsv } from "../scripts/build-aozora-index.mjs";

const fixtureUrl = new URL("./fixtures/aozora-small.csv", import.meta.url);
const aozoraSourceUrl = new URL("../src/lib/aozora.ts", import.meta.url);

describe("Aozora index generation", () => {
  it("parses quoted CSV fields and groups author rows for works present in the mirror", async () => {
    const csv = await readFile(fixtureUrl, "utf8");
    const rows = parseAozoraCsv(csv);
    const index = buildAozoraIndex(rows, new Set(["cards/000001/files/10_ruby_11/10_ruby_11.txt"]));

    expect(rows).toHaveLength(4);
    expect(mapAozoraTextUrlToPath(rows[0]?.["テキストファイルURL"] ?? "")).toBe("cards/000001/files/10_ruby_11/10_ruby_11.txt");
    expect(index).toEqual([[
      "000001",
      "月の旅",
      "つきのたび",
      "旅,前編",
      "佐藤花子、山田太郎",
      "さとうはなこ、やまだたろう",
      "新字新仮名",
      "cards/000001/files/10_ruby_11/10_ruby_11.txt",
      "あり",
    ]]);
  });

  it("extracts all ten existing sample paths for build-time mirror validation", async () => {
    const source = await readFile(aozoraSourceUrl, "utf8");
    expect(getAozoraSamplePaths(source)).toEqual(AOZORA_BOOKS.map(({ path }) => path));
  });
});
