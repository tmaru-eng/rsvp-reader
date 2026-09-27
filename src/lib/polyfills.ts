// Safari は ReadableStream の非同期イテレーターに未対応。pdf.js の getTextContent が for await で使うため補う。
export function installReadableStreamAsyncIterator(): void {
  const proto = globalThis.ReadableStream?.prototype as
    | (ReadableStream & { [Symbol.asyncIterator]?: unknown; values?: unknown })
    | undefined;
  if (!proto || typeof proto[Symbol.asyncIterator] === "function") return;

  async function* values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    let finished = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!finished && !options?.preventCancel) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  Object.defineProperty(proto, "values", { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

installReadableStreamAsyncIterator();
