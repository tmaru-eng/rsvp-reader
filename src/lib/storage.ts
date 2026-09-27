import type { BookRecord } from "./types";

const DATABASE_NAME = "rsvp-reader";
const DATABASE_VERSION = 1;
const BOOK_STORE = "books";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface BookRepository {
  get(id: string): Promise<BookRecord | undefined>;
  save(book: BookRecord): Promise<void>;
  updatePosition(id: string, position: number, lastViewedAt: number): Promise<void>;
  listRecent(): Promise<BookRecord[]>;
  close(): void;
}

function ensureRubyList(book: BookRecord | undefined): BookRecord | undefined {
  if (!book) return undefined;
  const rubies = (book as Partial<BookRecord>).rubies;
  return { ...book, rubies: Array.isArray(rubies) ? rubies : [] };
}

export async function createBookRepository(
  factory: IDBFactory = indexedDB,
  databaseName = DATABASE_NAME,
): Promise<BookRepository> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOK_STORE)) db.createObjectStore(BOOK_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
  });

  return {
    async get(id) {
      const transaction = database.transaction(BOOK_STORE, "readonly");
      const book = await requestResult(transaction.objectStore(BOOK_STORE).get(id)) as BookRecord | undefined;
      return ensureRubyList(book);
    },
    async save(book) {
      const transaction = database.transaction(BOOK_STORE, "readwrite");
      transaction.objectStore(BOOK_STORE).put(book);
      await transactionResult(transaction);
    },
    async updatePosition(id, position, lastViewedAt) {
      const transaction = database.transaction(BOOK_STORE, "readwrite");
      const request = transaction.objectStore(BOOK_STORE).get(id);
      request.onsuccess = () => {
        const book = ensureRubyList(request.result as BookRecord | undefined);
        if (book) transaction.objectStore(BOOK_STORE).put({ ...book, position, lastViewedAt });
      };
      await transactionResult(transaction);
    },
    async listRecent() {
      const transaction = database.transaction(BOOK_STORE, "readonly");
      const books = (await requestResult(transaction.objectStore(BOOK_STORE).getAll())) as BookRecord[];
      return books.map((book) => ensureRubyList(book)!).sort((left, right) => right.lastViewedAt - left.lastViewedAt);
    },
    close() {
      database.close();
    },
  };
}
