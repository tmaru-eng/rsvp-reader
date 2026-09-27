import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePdf } from "../src/lib/pdf";

const pdfHarness = vi.hoisted(() => ({ pages: [] as unknown[][] }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      get numPages() {
        return pdfHarness.pages.length;
      },
      getPage: async (pageNumber: number) => ({
        getTextContent: async () => ({ items: pdfHarness.pages[pageNumber - 1] ?? [] }),
      }),
    }),
    destroy: async () => undefined,
  }),
}));

function textItem(text: string, x: number, y: number): object {
  return { str: text, dir: "ltr", height: 12, transform: [1, 0, 0, 12, x, y] };
}

describe("PDF line joining", () => {
  beforeEach(() => {
    pdfHarness.pages = [];
  });

  it("joins wrapped rows and page continuations while marking detected paragraph breaks", async () => {
    pdfHarness.pages = [
      [
        textItem("このページでいちばん長い行です", 10, 700),
        textItem("同じ段落の続きの長い行ですよ", 10, 688),
        textItem("短文です。", 10, 676),
        textItem("見出し", 10, 664),
        textItem("　字下げの段落の長い一行目です", 10, 652),
        textItem("xで始まる行の長い二行目ですね", 10, 640),
        textItem("字下げされた行の長い一行目です", 20, 628),
        textItem("gap後の段落の長い一行目ですね", 10, 600),
        textItem("続きの行で最後にwrap-", 10, 588),
      ],
      [textItem("continued abc の続きの長い行ですね", 5, 700), textItem("abc", 5, 688)],
    ];

    const book = await parsePdf(new Uint8Array([37, 80, 68, 70]), "/cmaps/");

    expect(book.text).toBe("このページでいちばん長い行です同じ段落の続きの長い行ですよ短文です。\n見出し\n　字下げの段落の長い一行目ですxで始まる行の長い二行目ですね\n字下げされた行の長い一行目です\ngap後の段落の長い一行目ですね続きの行で最後にwrapcontinued abc の続きの長い行ですねabc");
  });
});
