import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createBookRepository, sha256Text } from "../src/lib/storage";

describe("local reading history", () => {
  it("uses the SHA-256 digest of the normalized book text as its stable ID", async () => {
    await expect(sha256Text("abc")).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("stores book text and bookmark position in IndexedDB and lists recent books first", async () => {
    const repository = await createBookRepository(new IDBFactory(), `rsvp-test-${crypto.randomUUID()}`);
    const first = {
      id: "book-1",
      title: "一冊目",
      author: "作者",
      text: "一冊目の本文",
      position: 0,
      lastViewedAt: 100,
      format: "txt" as const,
      totalChars: 6,
      rubies: [],
    };
    const second = { ...first, id: "book-2", title: "二冊目", lastViewedAt: 200 };

    await repository.save(first);
    await repository.save(second);
    await repository.updatePosition(first.id, 4, 300);

    expect(await repository.get(first.id)).toMatchObject({ text: first.text, position: 4, lastViewedAt: 300 });
    expect((await repository.listRecent()).map(({ id }) => id)).toEqual(["book-1", "book-2"]);
    repository.close();
  });

  it("loads legacy records without ruby data as books with an empty ruby list", async () => {
    const repository = await createBookRepository(new IDBFactory(), `rsvp-test-${crypto.randomUUID()}`);
    const legacyRecord = {
      id: "legacy-book",
      title: "旧形式",
      author: "作者",
      text: "本文",
      position: 0,
      lastViewedAt: 100,
      format: "txt" as const,
      totalChars: 2,
    };

    await repository.save(legacyRecord as Parameters<typeof repository.save>[0]);

    expect((await repository.get(legacyRecord.id))?.rubies).toEqual([]);
    expect((await repository.listRecent())[0]?.rubies).toEqual([]);
    repository.close();
  });
});
