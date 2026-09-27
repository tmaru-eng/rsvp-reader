import "./style.css";
import { buildChunks } from "./lib/chunking";
import { parseEpub } from "./lib/epub";
import { loadSettings, saveSettings, type ReaderSettings } from "./lib/settings";
import { createBookRepository, sha256Text, type BookRepository } from "./lib/storage";
import { parseTextDocument } from "./lib/text";
import { calculateChunkDuration, calculateRemainingTime } from "./lib/timing";
import type { BookRecord, Chunk, ParsedBook } from "./lib/types";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app が見つかりません。");

class ReaderApp {
  private readonly settings: ReaderSettings;
  private repository: BookRepository | undefined;
  private currentBook: BookRecord | undefined;
  private chunks: Chunk[] = [];
  private currentIndex = 0;
  private isPlaying = false;
  private timerId: number | undefined;
  private nextDeadline: number | undefined;
  private wakeLock: WakeLockSentinel | undefined;
  private pointerStart: { x: number; y: number } | undefined;

  constructor(private readonly appRoot: HTMLElement) {
    this.settings = loadSettings();
    this.renderShell();
    this.bindEvents();
    this.syncSettingsControls();
    void this.initialize();
  }

  private element<T extends HTMLElement>(selector: string): T {
    const element = this.appRoot.querySelector<T>(selector);
    if (!element) throw new Error(`画面要素が見つかりません: ${selector}`);
    return element;
  }

  private renderShell(): void {
    this.appRoot.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="book-heading">
            <strong id="book-title">ことば送り</strong>
            <span class="book-author" id="book-author"></span>
            <button class="change-book-button is-hidden" id="change-book" type="button">本を選ぶ</button>
          </div>
          <div class="keyboard-hint">Space 再生/停止 · ←→ 1文節 · Shift+←→ 段落 · ↑↓ 速度 · V 縦表示（予約）</div>
        </header>

        <main class="main-content">
          <section class="library" id="library" aria-labelledby="library-title">
            <div class="library-intro">
              <h1 id="library-title">本を、ひと息ずつ。</h1>
              <p>日本語の本を文節ごとに表示して読む、ブラウザ内で動くRSVPリーダーです。</p>
            </div>

            <div class="import-panel">
              <div class="drop-zone" id="drop-zone">
                <div>
                  <p>ファイルをここにドロップ</p>
                  <label class="file-button" for="file-input">ファイルを選ぶ</label>
                  <small>TXT・PDF・EPUBに対応</small>
                </div>
              </div>
              <input class="file-input" id="file-input" type="file" accept=".txt,.pdf,.epub,text/plain,application/pdf,application/epub+zip" />

              <label class="paste-label" for="paste-area">
                または文章を貼り付け
                <textarea class="paste-area" id="paste-area" placeholder="ここに日本語の文章を貼り付けます"></textarea>
              </label>
              <div class="import-actions">
                <button class="primary-button" id="read-paste" type="button">貼り付けた文章を読む</button>
                <span class="privacy-note">選んだファイルと文章はこのブラウザ内で処理します。</span>
              </div>
            </div>

            <section class="recent-section" aria-labelledby="recent-title">
              <div class="library-heading">
                <h2 id="recent-title">最近読んだ本</h2>
              </div>
              <div class="recent-list" id="recent-list" aria-live="polite">
                <p class="empty-recent">読み込み中…</p>
              </div>
            </section>
          </section>

          <section class="reader is-hidden" id="reader" aria-label="読書画面">
            <div class="reading-stage guides-on" id="reading-stage" role="button" tabindex="0" aria-label="タップして再生または停止">
              <div class="current-chunk" id="current-chunk" aria-live="off">ファイルを選ぶか、文章を貼り付けてください。</div>
            </div>
            <div class="reader-warning is-hidden" id="reader-warning" role="status"></div>
            <footer class="reader-footer">
              <progress class="progress-track" id="progress" max="1" value="0" aria-label="読書の進捗"></progress>
              <div class="reader-status">
                <span id="progress-count">0 / 0字</span>
                <span id="remaining-time">残り 約0:00</span>
              </div>
              <div class="control-row">
                <div class="control-group reader-main-controls">
                  <button class="icon-button" id="go-to-start" type="button" aria-label="先頭へ">|◀</button>
                  <button class="primary-button" id="play-toggle" type="button" disabled>▶ 再生</button>
                </div>

                <label class="control-group" for="speed-slider">
                  速度
                  <input id="speed-slider" type="range" min="200" max="3000" step="50" value="600" />
                  <output class="range-value" id="speed-value" for="speed-slider">600字/分</output>
                </label>

                <label class="control-group" for="group-size">
                  まとめる
                  <select id="group-size">
                    <option value="1">1文節ずつ</option>
                    <option value="2">2文節ずつ</option>
                    <option value="3">3文節ずつ</option>
                  </select>
                </label>

                <label class="control-group" for="min-chars">
                  最小字数
                  <select id="min-chars">
                    <option value="0">なし</option>
                    <option value="2">2字以上</option>
                    <option value="3">3字以上</option>
                    <option value="4">4字以上</option>
                  </select>
                </label>

                <label class="control-group" for="font-size">
                  文字
                  <input class="font-range" id="font-size" type="range" min="32" max="96" step="2" value="56" />
                  <output class="range-value" id="font-size-value" for="font-size">56px</output>
                </label>

                <label class="control-group" for="punctuation-pause">
                  <input id="punctuation-pause" type="checkbox" checked />
                  句読点で間をとる
                </label>

                <label class="control-group" for="focus-guides">
                  <input id="focus-guides" type="checkbox" checked />
                  注視点ガイド
                </label>
              </div>
            </footer>
          </section>

          <div class="loading-message is-hidden" id="loading-message" role="status"></div>
          <div class="error-message is-hidden" id="error-message" role="alert"></div>
        </main>
      </div>
    `;
  }

  private bindEvents(): void {
    this.element<HTMLInputElement>("#file-input").addEventListener("change", (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file) void this.importFile(file);
    });
    this.element<HTMLButtonElement>("#read-paste").addEventListener("click", () => {
      const text = this.element<HTMLTextAreaElement>("#paste-area").value;
      if (!text.trim()) {
        this.showError("文章を貼り付けてから読み始めてください。");
        return;
      }
      void this.importParsed(parseTextDocument(text, "貼り付け.txt"));
    });
    this.element<HTMLButtonElement>("#change-book").addEventListener("click", () => this.showLibrary());
    this.element<HTMLButtonElement>("#go-to-start").addEventListener("click", () => this.goToStart());
    this.element<HTMLButtonElement>("#play-toggle").addEventListener("click", () => this.togglePlayback());
    this.element<HTMLDivElement>("#reading-stage").addEventListener("pointerdown", (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.element<HTMLDivElement>("#reading-stage").addEventListener("pointerup", (event) => {
      if (!this.pointerStart) return;
      const deltaX = event.clientX - this.pointerStart.x;
      const deltaY = event.clientY - this.pointerStart.y;
      this.pointerStart = undefined;
      if (Math.abs(deltaX) > 38 && Math.abs(deltaX) > Math.abs(deltaY)) {
        this.moveBy(deltaX < 0 ? 1 : -1);
      } else if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
        this.togglePlayback();
      }
    });
    this.element<HTMLDivElement>("#reading-stage").addEventListener("pointercancel", () => {
      this.pointerStart = undefined;
    });

    this.element<HTMLButtonElement>("#recent-list").addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-book-id]");
      if (button?.dataset.bookId) void this.openRecentBook(button.dataset.bookId);
    });

    this.bindSettingsEvents();
    this.bindDropEvents();
    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isPlaying) void this.requestWakeLock();
    });
  }

  private bindSettingsEvents(): void {
    this.element<HTMLInputElement>("#speed-slider").addEventListener("input", (event) => {
      this.settings.speed = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
    });
    this.element<HTMLSelectElement>("#group-size").addEventListener("change", (event) => {
      this.settings.groupSize = Number((event.currentTarget as HTMLSelectElement).value) as 1 | 2 | 3;
      this.settingsChanged(false);
      this.rebuildChunks();
    });
    this.element<HTMLSelectElement>("#min-chars").addEventListener("change", (event) => {
      this.settings.minChars = Number((event.currentTarget as HTMLSelectElement).value) as 0 | 2 | 3 | 4;
      this.settingsChanged(false);
      this.rebuildChunks();
    });
    this.element<HTMLInputElement>("#font-size").addEventListener("input", (event) => {
      this.settings.fontSize = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(false);
    });
    this.element<HTMLInputElement>("#punctuation-pause").addEventListener("change", (event) => {
      this.settings.punctuationPause = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#focus-guides").addEventListener("change", (event) => {
      this.settings.focusGuides = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(false);
    });
  }

  private bindDropEvents(): void {
    const zone = this.element<HTMLDivElement>("#drop-zone");
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget as Node | null)) zone.classList.remove("is-dragging");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
      const file = (event as DragEvent).dataTransfer?.files[0];
      if (file) void this.importFile(file);
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.repository = await createBookRepository();
      await this.refreshRecentBooks();
    } catch {
      this.element<HTMLDivElement>("#recent-list").innerHTML = '<p class="empty-recent">しおりを保存できません。ファイル読み込みは利用できます。</p>';
    }
  }

  private async importFile(file: File): Promise<void> {
    const filename = file.name;
    const extension = filename.toLowerCase().split(".").at(-1);
    this.showLoading(`${filename} を読み込んでいます…`);
    this.clearError();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let parsed: ParsedBook;
      if (extension === "txt") {
        parsed = parseTextDocument(bytes, filename);
      } else if (extension === "pdf") {
        const [pdfjs, workerModule, pdfModule] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
          import("./lib/pdf"),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        parsed = await pdfModule.parsePdf(bytes, `${import.meta.env.BASE_URL}cmaps/`, {}, filename);
      } else if (extension === "epub") {
        parsed = await parseEpub(bytes);
      } else {
        throw new Error("TXT・PDF・EPUBファイルを選んでください。");
      }
      await this.openBook(parsed);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    } finally {
      this.hideLoading();
    }
  }

  private async importParsed(parsed: ParsedBook): Promise<void> {
    this.showLoading("文章を準備しています…");
    this.clearError();
    try {
      await this.openBook(parsed);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "文章を読み込めませんでした。");
    } finally {
      this.hideLoading();
    }
  }

  private async openBook(parsed: ParsedBook): Promise<void> {
    if (!parsed.text.trim()) throw new Error("本文が空です。");
    const id = await sha256Text(parsed.text);
    const previous = await this.repository?.get(id);
    const record: BookRecord = {
      id,
      title: parsed.title || previous?.title || "タイトル不明",
      author: parsed.author || previous?.author || "",
      text: parsed.text,
      position: previous?.position ?? 0,
      lastViewedAt: Date.now(),
      format: parsed.format,
      totalChars: Array.from(parsed.text).length,
    };
    this.currentBook = record;
    this.chunks = buildChunks(record.text, this.chunkOptions());
    this.currentIndex = this.clampIndex(record.position);
    this.currentBook.position = this.currentIndex;
    await this.repository?.save(this.currentBook);
    this.showReader(parsed.warning);
    await this.refreshRecentBooks();
  }

  private async openRecentBook(id: string): Promise<void> {
    if (!this.repository) {
      this.showError("しおりを読み込めません。");
      return;
    }
    this.showLoading("しおりを開いています…");
    this.clearError();
    try {
      const saved = await this.repository.get(id);
      if (!saved) throw new Error("この本のしおりが見つかりません。");
      this.currentBook = { ...saved, lastViewedAt: Date.now() };
      this.chunks = buildChunks(saved.text, this.chunkOptions());
      this.currentIndex = this.clampIndex(saved.position);
      this.currentBook.position = this.currentIndex;
      await this.repository.save(this.currentBook);
      this.showReader();
      await this.refreshRecentBooks();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "しおりを開けませんでした。");
    } finally {
      this.hideLoading();
    }
  }

  private async refreshRecentBooks(): Promise<void> {
    const list = this.element<HTMLDivElement>("#recent-list");
    if (!this.repository) return;
    const books = await this.repository.listRecent();
    list.replaceChildren();
    if (books.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-recent";
      empty.textContent = "まだ本はありません。読み込んだ本のしおりがここに表示されます。";
      list.append(empty);
      return;
    }
    for (const book of books) {
      const button = document.createElement("button");
      button.className = "recent-book";
      button.type = "button";
      button.dataset.bookId = book.id;
      const details = document.createElement("span");
      const title = document.createElement("span");
      title.className = "recent-book-title";
      title.textContent = book.title;
      const meta = document.createElement("span");
      meta.className = "recent-book-meta";
      meta.textContent = book.author ? `${book.author} · ${book.format.toUpperCase()}` : book.format.toUpperCase();
      details.append(title, meta);
      const position = document.createElement("span");
      position.className = "recent-book-position";
      position.textContent = `しおり ${book.position + 1}チャンク目`;
      button.append(details, position);
      list.append(button);
    }
  }

  private showReader(warning?: string): void {
    this.pausePlayback();
    this.element<HTMLElement>("#library").classList.add("is-hidden");
    this.element<HTMLElement>("#reader").classList.remove("is-hidden");
    this.element<HTMLButtonElement>("#change-book").classList.remove("is-hidden");
    const book = this.currentBook;
    this.element<HTMLElement>("#book-title").textContent = book?.title ?? "ことば送り";
    const author = this.element<HTMLElement>("#book-author");
    author.textContent = book?.author ?? "";
    author.classList.toggle("is-hidden", !book?.author);
    const warningElement = this.element<HTMLDivElement>("#reader-warning");
    warningElement.textContent = warning ?? "";
    warningElement.classList.toggle("is-hidden", !warning);
    this.element<HTMLButtonElement>("#play-toggle").disabled = this.chunks.length === 0;
    this.element<HTMLDivElement>("#reading-stage").focus({ preventScroll: true });
    this.updateReadingView();
  }

  private showLibrary(): void {
    this.pausePlayback();
    this.element<HTMLElement>("#reader").classList.add("is-hidden");
    this.element<HTMLElement>("#library").classList.remove("is-hidden");
    this.element<HTMLButtonElement>("#change-book").classList.add("is-hidden");
    this.element<HTMLElement>("#book-title").textContent = "ことば送り";
    this.element<HTMLElement>("#book-author").textContent = "";
    void this.refreshRecentBooks();
  }

  private chunkOptions(): { groupSize: 1 | 2 | 3; minChars: 0 | 2 | 3 | 4 } {
    return { groupSize: this.settings.groupSize, minChars: this.settings.minChars };
  }

  private rebuildChunks(): void {
    if (!this.currentBook) return;
    const currentChar = this.chunks[this.currentIndex]?.charStart ?? 0;
    this.chunks = buildChunks(this.currentBook.text, this.chunkOptions());
    const matchingIndex = this.chunks.findIndex((chunk) => chunk.charStart >= currentChar);
    this.currentIndex = matchingIndex < 0 ? this.clampIndex(this.chunks.length - 1) : matchingIndex;
    this.currentBook.position = this.currentIndex;
    if (this.isPlaying) this.resetCurrentDeadline();
    this.updateReadingView();
    void this.persistPosition();
  }

  private settingsChanged(restartCurrentChunk: boolean): void {
    saveSettings(this.settings);
    this.syncSettingsControls();
    if (restartCurrentChunk && this.isPlaying) this.resetCurrentDeadline();
    this.updateReadingView();
  }

  private syncSettingsControls(): void {
    this.element<HTMLInputElement>("#speed-slider").value = String(this.settings.speed);
    this.element<HTMLOutputElement>("#speed-value").value = `${this.settings.speed}字/分`;
    this.element<HTMLSelectElement>("#group-size").value = String(this.settings.groupSize);
    this.element<HTMLSelectElement>("#min-chars").value = String(this.settings.minChars);
    this.element<HTMLInputElement>("#font-size").value = String(this.settings.fontSize);
    this.element<HTMLOutputElement>("#font-size-value").value = `${this.settings.fontSize}px`;
    this.element<HTMLInputElement>("#punctuation-pause").checked = this.settings.punctuationPause;
    this.element<HTMLInputElement>("#focus-guides").checked = this.settings.focusGuides;
  }

  private updateReadingView(): void {
    const stage = this.element<HTMLDivElement>("#reading-stage");
    stage.classList.toggle("guides-on", this.settings.focusGuides);
    stage.style.setProperty("--reader-size", `${this.settings.fontSize}px`);
    this.element<HTMLButtonElement>("#play-toggle").textContent = this.isPlaying ? "Ⅱ 停止" : "▶ 再生";
    const chunk = this.chunks[this.currentIndex];
    this.element<HTMLDivElement>("#current-chunk").textContent = chunk?.text ?? "ファイルを選ぶか、文章を貼り付けてください。";
    const total = this.currentBook?.totalChars ?? 0;
    const charsRead = chunk ? Math.min(total, chunk.charStart + Array.from(chunk.text).length) : 0;
    this.element<HTMLProgressElement>("#progress").value = total ? charsRead / total : 0;
    this.element<HTMLElement>("#progress-count").textContent = `${charsRead.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}字`;
    const remaining = calculateRemainingTime(this.chunks, this.currentIndex, this.settings.speed, {
      punctuationPause: this.settings.punctuationPause,
    });
    const seconds = Math.ceil(remaining / 1000);
    this.element<HTMLElement>("#remaining-time").textContent = `残り 約${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    this.element<HTMLButtonElement>("#go-to-start").disabled = !this.currentBook || this.currentIndex === 0;
    this.element<HTMLButtonElement>("#play-toggle").disabled = !this.currentBook || this.chunks.length === 0;
  }

  private clampIndex(index: number): number {
    return Math.min(Math.max(0, index), Math.max(0, this.chunks.length - 1));
  }

  private goToStart(): void {
    this.pausePlayback();
    this.currentIndex = 0;
    if (this.currentBook) this.currentBook.position = 0;
    this.updateReadingView();
    void this.persistPosition();
  }

  private moveBy(delta: number): void {
    if (!this.currentBook) return;
    const next = this.clampIndex(this.currentIndex + delta);
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    this.currentBook.position = next;
    if (this.isPlaying) this.resetCurrentDeadline();
    this.updateReadingView();
    void this.persistPosition();
  }

  private moveParagraph(direction: -1 | 1): void {
    const current = this.chunks[this.currentIndex];
    if (!current) return;
    if (direction < 0) {
      for (let index = this.currentIndex - 1; index >= 0; index -= 1) {
        if (this.chunks[index]?.paragraphIndex !== current.paragraphIndex) {
          this.currentIndex = index;
          break;
        }
      }
    } else {
      for (let index = this.currentIndex + 1; index < this.chunks.length; index += 1) {
        if (this.chunks[index]?.paragraphIndex !== current.paragraphIndex) {
          this.currentIndex = index;
          break;
        }
      }
    }
    if (this.currentBook) this.currentBook.position = this.currentIndex;
    if (this.isPlaying) this.resetCurrentDeadline();
    this.updateReadingView();
    void this.persistPosition();
  }

  private togglePlayback(): void {
    if (!this.currentBook || this.chunks.length === 0) return;
    if (this.isPlaying) this.pausePlayback();
    else this.startPlayback();
  }

  private startPlayback(): void {
    if (!this.currentBook || this.chunks.length === 0 || this.isPlaying) return;
    this.isPlaying = true;
    this.resetCurrentDeadline();
    void this.requestWakeLock();
    this.updateReadingView();
  }

  private pausePlayback(): void {
    this.isPlaying = false;
    if (this.timerId !== undefined) window.clearTimeout(this.timerId);
    this.timerId = undefined;
    this.nextDeadline = undefined;
    void this.releaseWakeLock();
    if (this.appRoot.querySelector("#play-toggle")) this.updateReadingView();
  }

  private resetCurrentDeadline(): void {
    if (this.timerId !== undefined) window.clearTimeout(this.timerId);
    this.timerId = undefined;
    if (!this.isPlaying) return;
    this.nextDeadline = performance.now() + this.chunkDuration(this.currentIndex);
    this.scheduleAdvance();
  }

  private chunkDuration(index: number): number {
    const chunk = this.chunks[index];
    if (!chunk) return 120;
    const next = this.chunks[index + 1];
    const paragraphEnd = !next || next.paragraphIndex !== chunk.paragraphIndex;
    return calculateChunkDuration(chunk, this.settings.speed, {
      punctuationPause: this.settings.punctuationPause,
      paragraphEnd,
    });
  }

  private scheduleAdvance(): void {
    if (!this.isPlaying || this.nextDeadline === undefined) return;
    const delay = Math.max(0, this.nextDeadline - performance.now());
    this.timerId = window.setTimeout(() => this.advanceChunk(), delay);
  }

  private advanceChunk(): void {
    this.timerId = undefined;
    if (!this.isPlaying || this.nextDeadline === undefined) return;
    if (this.currentIndex + 1 >= this.chunks.length) {
      this.pausePlayback();
      return;
    }
    this.currentIndex += 1;
    if (this.currentBook) this.currentBook.position = this.currentIndex;
    this.nextDeadline += this.chunkDuration(this.currentIndex);
    this.updateReadingView();
    void this.persistPosition();
    this.scheduleAdvance();
  }

  private async requestWakeLock(): Promise<void> {
    const wakeLockApi = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!wakeLockApi || this.wakeLock) return;
    try {
      this.wakeLock = await wakeLockApi.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = undefined;
      }, { once: true });
    } catch {
      // Browsers may reject wake locks while the page is backgrounded or in power-save mode.
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const currentLock = this.wakeLock;
    this.wakeLock = undefined;
    if (!currentLock) return;
    try {
      await currentLock.release();
    } catch {
      // The browser may have released the lock when the page lost visibility.
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.code === "Space" && event.target instanceof HTMLButtonElement) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      this.togglePlayback();
    } else if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      this.moveParagraph(-1);
    } else if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      this.moveParagraph(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.moveBy(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.moveBy(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this.settings.speed = Math.min(3000, Math.max(200, this.settings.speed + (event.key === "ArrowUp" ? 50 : -50)));
      this.settingsChanged(true);
    }
  }

  private async persistPosition(): Promise<void> {
    if (!this.repository || !this.currentBook) return;
    this.currentBook.lastViewedAt = Date.now();
    try {
      await this.repository.updatePosition(this.currentBook.id, this.currentIndex, this.currentBook.lastViewedAt);
    } catch {
      this.showError("しおりを保存できませんでした。このタブを閉じる前に読書位置を控えてください。");
    }
  }

  private showLoading(message: string): void {
    const loading = this.element<HTMLDivElement>("#loading-message");
    loading.textContent = message;
    loading.classList.remove("is-hidden");
  }

  private hideLoading(): void {
    this.element<HTMLDivElement>("#loading-message").classList.add("is-hidden");
  }

  private showError(message: string): void {
    const error = this.element<HTMLDivElement>("#error-message");
    error.textContent = message;
    error.classList.remove("is-hidden");
  }

  private clearError(): void {
    this.element<HTMLDivElement>("#error-message").classList.add("is-hidden");
  }
}

interface WakeLock {
  request(type: "screen"): Promise<WakeLockSentinel>;
}

new ReaderApp(root);
