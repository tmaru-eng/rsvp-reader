import "./style.css";
import { fetchAozoraBook, type AozoraBook } from "./lib/aozora";
import {
  AOZORA_BROWSE_PAGE_SIZE,
  AOZORA_BROWSE_ROWS,
  getAozoraBrowseIndex,
  getAozoraPage,
  type AozoraBrowseAuthor,
  type AozoraBrowseIndex,
  type AozoraBrowseRowKey,
} from "./lib/aozora-browse";
import {
  AOZORA_INDEX_MISSING_MESSAGE,
  fetchAozoraIndex,
  searchAozoraIndex,
  type AozoraIndexBook,
} from "./lib/aozora-search";
import { buildChunks, type ChunkOptions } from "./lib/chunking";
import { isEpubFilename, parseEpub } from "./lib/epub";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ReaderSettings } from "./lib/settings";
import { createBookRepository, sha256Text, type BookRepository } from "./lib/storage";
import { parseTextDocument } from "./lib/text";
import { calculateChunkDuration, calculateRemainingTime, calculateTimingCoefficient } from "./lib/timing";
import type { TimingOptions } from "./lib/timing";
import type { BookRecord, Chunk, ParsedBook } from "./lib/types";

// 厚生労働省「情報機器作業における労働衛生管理のためのガイドライン」（連続作業は1時間以内）に合わせた休憩の案内。
const BREAK_AFTER_MS = 50 * 60 * 1000;
const BREAK_RESET_AFTER_PAUSE_MS = 5 * 60 * 1000;

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app が見つかりません。");

class ReaderApp {
  private readonly settings: ReaderSettings;
  private repository: BookRepository | undefined;
  private currentBook: BookRecord | undefined;
  private chunks: Chunk[] = [];
  private currentIndex = 0;
  private isPlaying = false;
  private playedMs = 0;
  private playStartedAt: number | undefined;
  private lastPausedAt: number | undefined;
  private breakTimerId: number | undefined;
  private timerId: number | undefined;
  private nextDeadline: number | undefined;
  private wakeLock: WakeLockSentinel | undefined;
  private pointerStart: { x: number; y: number } | undefined;
  private activeMaxChars = 1;
  private timingCoefficient = 1;
  private resizeObserver: ResizeObserver | undefined;
  private layoutFrame: number | undefined;
  private aozoraIndex: AozoraIndexBook[] | null | undefined;
  private aozoraIndexLoad: Promise<AozoraIndexBook[] | null> | undefined;
  private aozoraSearchTimerId: number | undefined;
  private aozoraBrowseIndex: AozoraBrowseIndex | undefined;
  private aozoraTitleRow: AozoraBrowseRowKey | undefined;
  private aozoraTitleStage: string | undefined;
  private aozoraTitlePage = 0;
  private aozoraAuthorRow: AozoraBrowseRowKey | undefined;
  private aozoraAuthorStage: string | undefined;
  private aozoraAuthorPage = 0;
  private aozoraSelectedAuthor: AozoraBrowseAuthor | undefined;
  private aozoraAuthorBookPage = 0;

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
                  <small>TXT・PDF・EPUB・KEPUBに対応</small>
                </div>
              </div>
              <input class="file-input" id="file-input" type="file" accept=".txt,.pdf,.epub,.kepub,.kepub.epub,text/plain,application/pdf,application/epub+zip" />

              <label class="paste-label" for="paste-area">
                または文章を貼り付け
                <textarea class="paste-area" id="paste-area" placeholder="ここに日本語の文章を貼り付けます"></textarea>
              </label>
              <div class="import-actions">
                <button class="primary-button" id="read-paste" type="button">貼り付けた文章を読む</button>
                <span class="privacy-note">選んだファイルと文章はこのブラウザ内で処理します。</span>
              </div>
            </div>

            <section class="aozora-section" aria-labelledby="aozora-title">
              <div class="library-heading">
                <h2 id="aozora-title">青空文庫から読む</h2>
              </div>
              <div class="aozora-tabs" role="tablist" aria-label="青空文庫の探し方">
                <button class="aozora-tab is-active" id="aozora-tab-search" type="button" role="tab" aria-selected="true" aria-controls="aozora-panel-search" data-aozora-tab="search">検索</button>
                <button class="aozora-tab" id="aozora-tab-title" type="button" role="tab" aria-selected="false" aria-controls="aozora-panel-title" data-aozora-tab="title" tabindex="-1">作品名から</button>
                <button class="aozora-tab" id="aozora-tab-author" type="button" role="tab" aria-selected="false" aria-controls="aozora-panel-author" data-aozora-tab="author" tabindex="-1">作者から</button>
              </div>
              <div class="aozora-panel" id="aozora-panel-search" role="tabpanel" aria-labelledby="aozora-tab-search">
                <label class="aozora-search-label" for="aozora-search">作品名や作者名で検索</label>
                <input class="aozora-search-input" id="aozora-search" type="search" placeholder="作品名・読み・作者名" autocomplete="off" aria-controls="aozora-list" />
                <div class="aozora-grid" id="aozora-list" aria-live="polite"></div>
              </div>
              <div class="aozora-panel is-hidden" id="aozora-panel-title" role="tabpanel" aria-labelledby="aozora-tab-title">
                <div class="aozora-kana-rows" id="aozora-title-rows" aria-label="作品名の行"></div>
                <div class="aozora-kana-stages" id="aozora-title-stages" aria-label="作品名の段"></div>
                <div class="aozora-grid" id="aozora-title-list" aria-live="polite">
                  <p class="aozora-search-message">行を選んでください。</p>
                </div>
                <button class="secondary-button aozora-more is-hidden" id="aozora-title-more" type="button" data-aozora-more="titles">もっと見る</button>
              </div>
              <div class="aozora-panel is-hidden" id="aozora-panel-author" role="tabpanel" aria-labelledby="aozora-tab-author">
                <div id="aozora-author-list-panel">
                  <div class="aozora-kana-rows" id="aozora-author-rows" aria-label="作者の行"></div>
                  <div class="aozora-kana-stages" id="aozora-author-stages" aria-label="作者の段"></div>
                  <div class="aozora-grid" id="aozora-author-list" aria-live="polite">
                    <p class="aozora-search-message">行を選んでください。</p>
                  </div>
                  <button class="secondary-button aozora-more is-hidden" id="aozora-author-more" type="button" data-aozora-more="authors">もっと見る</button>
                </div>
                <div class="is-hidden" id="aozora-author-books-panel">
                  <div class="aozora-author-books-heading">
                    <h3 id="aozora-author-books-title"></h3>
                    <button class="secondary-button" type="button" data-aozora-author-back>作者一覧に戻る</button>
                  </div>
                  <div class="aozora-grid" id="aozora-author-books" aria-live="polite"></div>
                  <button class="secondary-button aozora-more is-hidden" id="aozora-author-books-more" type="button" data-aozora-more="author-books">もっと見る</button>
                </div>
              </div>
              <small class="aozora-attribution">出典：青空文庫（aozorahack/aozorabunko_text の写し） · <a href="https://www.aozora.gr.jp/" target="_blank" rel="noopener noreferrer">青空文庫</a></small>
            </section>

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
            <div class="break-notice is-hidden" id="break-notice" role="alert">
              <span>50分読みました。1〜2分、遠くを見るか目を閉じて休みましょう。</span>
              <button class="secondary-button" id="break-resume" type="button">続きを読む</button>
            </div>
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

                <button class="secondary-button detail-toggle" id="timing-details-toggle" type="button" aria-expanded="false" aria-controls="timing-details">詳細</button>
              </div>
              <section class="timing-details is-hidden" id="timing-details" aria-label="再生リズムの詳細設定">
                <div class="timing-details-header">
                  <strong>再生リズム</strong>
                  <button class="secondary-button" id="timing-details-reset" type="button">既定に戻す</button>
                </div>
                <label class="timing-detail" for="proportionality-slider">
                  <span>字数比例</span>
                  <input id="proportionality-slider" type="range" min="0" max="100" step="10" value="100" />
                  <output class="range-value timing-detail-value" id="proportionality-value" for="proportionality-slider">100%</output>
                </label>
                <label class="timing-detail" for="comma-pause-slider">
                  <span>「、」の倍率</span>
                  <input id="comma-pause-slider" type="range" min="1" max="3" step="0.1" value="1.3" />
                  <output class="range-value timing-detail-value" id="comma-pause-value" for="comma-pause-slider">1.3×</output>
                </label>
                <label class="timing-detail" for="sentence-pause-slider">
                  <span>文末（。！？・」）の倍率</span>
                  <input id="sentence-pause-slider" type="range" min="1" max="3" step="0.1" value="1.6" />
                  <output class="range-value timing-detail-value" id="sentence-pause-value" for="sentence-pause-slider">1.6×</output>
                </label>
                <label class="timing-detail" for="paragraph-pause-slider">
                  <span>段落末の倍率</span>
                  <input id="paragraph-pause-slider" type="range" min="1" max="4" step="0.1" value="1.8" />
                  <output class="range-value timing-detail-value" id="paragraph-pause-value" for="paragraph-pause-slider">1.8×</output>
                </label>
                <label class="control-group break-reminder-option" for="break-reminder">
                  <input id="break-reminder" type="checkbox" checked />
                  50分ごとに休憩を案内する
                </label>
                <label class="control-group break-reminder-option" for="show-ruby">
                  <input id="show-ruby" type="checkbox" checked />
                  ルビを表示
                </label>
                <label class="timing-detail" for="min-duration-slider">
                  <span>1区切りの最短時間</span>
                  <input id="min-duration-slider" type="range" min="50" max="400" step="10" value="150" />
                  <output class="range-value timing-detail-value" id="min-duration-value" for="min-duration-slider">150ms</output>
                </label>
              </section>
            </footer>
          </section>

          <div class="loading-message is-hidden" id="loading-message" role="status"></div>
          <div class="error-message is-hidden" id="error-message" role="alert"></div>
        </main>
      </div>
    `;
    this.renderAozoraMessage("作品名や作者名を入力してください。");
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
    const aozoraSearch = this.element<HTMLInputElement>("#aozora-search");
    aozoraSearch.addEventListener("focus", () => this.scheduleAozoraSearch());
    aozoraSearch.addEventListener("input", () => this.scheduleAozoraSearch());
    this.element<HTMLElement>(".aozora-section").addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const tab = target.closest<HTMLButtonElement>("[data-aozora-tab]");
      if (tab) {
        const selectedTab = tab.dataset.aozoraTab;
        if (selectedTab === "search" || selectedTab === "title" || selectedTab === "author") {
          this.selectAozoraTab(selectedTab);
        }
        return;
      }

      const rowButton = target.closest<HTMLButtonElement>("[data-aozora-browse-row]");
      if (rowButton) {
        const row = rowButton.dataset.aozoraBrowseRow as AozoraBrowseRowKey | undefined;
        const mode = rowButton.dataset.aozoraBrowseMode;
        if (row && mode === "titles") this.selectAozoraTitleRow(row);
        if (row && mode === "authors") this.selectAozoraAuthorRow(row);
        return;
      }

      const stageButton = target.closest<HTMLButtonElement>("[data-aozora-browse-stage]");
      if (stageButton) {
        const stage = stageButton.dataset.aozoraBrowseStage;
        const mode = stageButton.dataset.aozoraBrowseMode;
        if (mode === "titles") this.selectAozoraTitleStage(stage === "all" ? undefined : stage);
        if (mode === "authors") this.selectAozoraAuthorStage(stage === "all" ? undefined : stage);
        return;
      }

      const button = target.closest<HTMLButtonElement>("[data-aozora-id]");
      const work = this.aozoraIndex?.find(({ id }) => id === button?.dataset.aozoraId);
      if (work) {
        void this.importAozora({ id: work.id, title: work.title, author: work.authors, path: work.path });
        return;
      }

      const authorButton = target.closest<HTMLButtonElement>("[data-aozora-author]");
      if (authorButton?.dataset.aozoraAuthor) {
        this.selectAozoraAuthor(authorButton.dataset.aozoraAuthor);
        return;
      }

      const moreButton = target.closest<HTMLButtonElement>("[data-aozora-more]");
      if (moreButton?.dataset.aozoraMore === "titles") this.appendAozoraTitlePage();
      if (moreButton?.dataset.aozoraMore === "authors") this.appendAozoraAuthorPage();
      if (moreButton?.dataset.aozoraMore === "author-books") this.appendAozoraAuthorBookPage();
      if (target.closest("[data-aozora-author-back]")) {
        this.aozoraSelectedAuthor = undefined;
        this.renderAozoraAuthors();
      }
    });
    this.element<HTMLDivElement>(".aozora-tabs").addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const current = target.closest<HTMLButtonElement>("[data-aozora-tab]");
      const currentTab = current?.dataset.aozoraTab;
      if (!current || (currentTab !== "search" && currentTab !== "title" && currentTab !== "author")) return;

      const tabs = ["search", "title", "author"] as const;
      const currentIndex = tabs.indexOf(currentTab);
      const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
        : event.key === "ArrowLeft" ? (currentIndex + tabs.length - 1) % tabs.length
          : event.key === "Home" ? 0
            : event.key === "End" ? tabs.length - 1
              : -1;
      if (nextIndex < 0) return;

      event.preventDefault();
      const nextTab = tabs[nextIndex];
      const nextButton = this.element<HTMLButtonElement>(`#aozora-tab-${nextTab}`);
      nextButton.focus();
      this.selectAozoraTab(nextTab);
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
    window.addEventListener("resize", () => this.scheduleLayoutUpdate());
    window.addEventListener("orientationchange", () => this.scheduleLayoutUpdate());
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleLayoutUpdate());
      this.resizeObserver.observe(this.element<HTMLDivElement>("#reading-stage"));
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.isPlaying) this.pausePlayback();
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
      this.settingsChanged(false, true);
    });
    this.element<HTMLInputElement>("#punctuation-pause").addEventListener("change", (event) => {
      this.settings.punctuationPause = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#break-reminder").addEventListener("change", (event) => {
      this.settings.breakReminder = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(false);
      this.scheduleBreakReminder();
    });
    this.element<HTMLButtonElement>("#break-resume").addEventListener("click", (event) => {
      event.stopPropagation();
      this.element<HTMLDivElement>("#break-notice").classList.add("is-hidden");
      this.startPlayback();
    });
    this.element<HTMLInputElement>("#focus-guides").addEventListener("change", (event) => {
      this.settings.focusGuides = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(false);
    });
    this.element<HTMLInputElement>("#show-ruby").addEventListener("change", (event) => {
      this.settings.showRuby = (event.currentTarget as HTMLInputElement).checked;
      this.settingsChanged(false);
    });
    this.element<HTMLButtonElement>("#timing-details-toggle").addEventListener("click", (event) => {
      const panel = this.element<HTMLElement>("#timing-details");
      const isOpen = panel.classList.toggle("is-hidden") === false;
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-expanded", String(isOpen));
      this.scheduleLayoutUpdate();
    });
    this.element<HTMLButtonElement>("#timing-details-reset").addEventListener("click", () => {
      this.settings.proportionality = DEFAULT_SETTINGS.proportionality;
      this.settings.commaPause = DEFAULT_SETTINGS.commaPause;
      this.settings.sentencePause = DEFAULT_SETTINGS.sentencePause;
      this.settings.paragraphPause = DEFAULT_SETTINGS.paragraphPause;
      this.settings.minDuration = DEFAULT_SETTINGS.minDuration;
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#proportionality-slider").addEventListener("input", (event) => {
      this.settings.proportionality = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#comma-pause-slider").addEventListener("input", (event) => {
      this.settings.commaPause = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#sentence-pause-slider").addEventListener("input", (event) => {
      this.settings.sentencePause = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#paragraph-pause-slider").addEventListener("input", (event) => {
      this.settings.paragraphPause = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
    });
    this.element<HTMLInputElement>("#min-duration-slider").addEventListener("input", (event) => {
      this.settings.minDuration = Number((event.currentTarget as HTMLInputElement).value);
      this.settingsChanged(true);
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
      } else if (isEpubFilename(filename)) {
        parsed = await parseEpub(bytes);
      } else {
        throw new Error("TXT・PDF・EPUB・KEPUBファイルを選んでください。");
      }
      await this.openBook(parsed);
    } catch (error) {
      if (isStaleModuleError(error) && reloadForUpdate()) return;
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

  private renderAozoraMessage(message: string): void {
    const status = document.createElement("p");
    status.className = "aozora-search-message";
    status.textContent = message;
    this.element<HTMLDivElement>("#aozora-list").replaceChildren(status);
  }

  private loadAozoraIndex(): Promise<AozoraIndexBook[] | null> {
    if (this.aozoraIndex !== undefined) return Promise.resolve(this.aozoraIndex);
    if (this.aozoraIndexLoad) return this.aozoraIndexLoad;

    this.renderAozoraMessage("検索データを読み込んでいます…");
    const loading = fetchAozoraIndex(fetch, `${import.meta.env.BASE_URL}aozora-index.json`)
      .then((index) => {
        this.aozoraIndex = index;
        this.aozoraBrowseIndex = index ? getAozoraBrowseIndex(index) : undefined;
        if (!index) this.renderAozoraMessage(AOZORA_INDEX_MISSING_MESSAGE);
        return index;
      })
      .catch(() => {
        this.renderAozoraMessage(AOZORA_INDEX_MISSING_MESSAGE);
        return null;
      })
      .finally(() => {
        this.aozoraIndexLoad = undefined;
      });
    this.aozoraIndexLoad = loading;
    return loading;
  }

  private scheduleAozoraSearch(): void {
    if (this.aozoraSearchTimerId !== undefined) window.clearTimeout(this.aozoraSearchTimerId);
    this.aozoraSearchTimerId = undefined;
    void this.loadAozoraIndex().then((index) => {
      if (!index) return;
      if (this.aozoraSearchTimerId !== undefined) window.clearTimeout(this.aozoraSearchTimerId);
      this.aozoraSearchTimerId = window.setTimeout(() => {
        this.aozoraSearchTimerId = undefined;
        const query = this.element<HTMLInputElement>("#aozora-search").value;
        this.renderAozoraSearchResults(query);
      }, 150);
    });
  }

  private renderAozoraSearchResults(query: string): void {
    if (!query.trim()) {
      this.renderAozoraMessage("作品名や作者名を入力してください。");
      return;
    }
    const books = this.aozoraIndex;
    if (!books) {
      this.renderAozoraMessage(AOZORA_INDEX_MISSING_MESSAGE);
      return;
    }
    const results = searchAozoraIndex(books, query);
    if (results.length === 0) {
      this.renderAozoraMessage("該当する作品はありません。");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const work of results) fragment.append(this.createAozoraBookButton(work));
    this.element<HTMLDivElement>("#aozora-list").replaceChildren(fragment);
  }

  private createAozoraBookButton(work: AozoraIndexBook): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "aozora-book";
    button.type = "button";
    button.dataset.aozoraId = work.id;
    button.setAttribute("aria-label", `${work.title}（${work.authors}）を読む`);

    const title = document.createElement("span");
    title.className = "aozora-book-title";
    title.textContent = work.title;
    button.append(title);
    if (work.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.className = "aozora-book-subtitle";
      subtitle.textContent = work.subtitle;
      button.append(subtitle);
    }
    const details = document.createElement("span");
    details.className = "aozora-book-meta";
    details.textContent = [work.authors, work.characterType].filter(Boolean).join(" · ");
    button.append(details);
    return button;
  }

  private selectAozoraTab(tab: "search" | "title" | "author"): void {
    for (const name of ["search", "title", "author"] as const) {
      const isSelected = name === tab;
      const tabButton = this.element<HTMLButtonElement>(`#aozora-tab-${name}`);
      tabButton.classList.toggle("is-active", isSelected);
      tabButton.setAttribute("aria-selected", String(isSelected));
      tabButton.tabIndex = isSelected ? 0 : -1;
      this.element<HTMLElement>(`#aozora-panel-${name}`).classList.toggle("is-hidden", !isSelected);
    }

    if (tab === "search") {
      this.scheduleAozoraSearch();
      return;
    }

    const listSelector = tab === "title" ? "#aozora-title-list" : "#aozora-author-list";
    this.renderAozoraBrowseMessage(listSelector, "検索データを読み込んでいます…");
    void this.loadAozoraIndex().then((index) => {
      if (!index) {
        this.renderAozoraBrowseMessage(listSelector, AOZORA_INDEX_MISSING_MESSAGE);
      } else if (tab === "title") {
        this.renderAozoraTitles();
      } else {
        this.renderAozoraAuthors();
      }
    });
  }

  private renderAozoraBrowseMessage(selector: string, message: string): void {
    const status = document.createElement("p");
    status.className = "aozora-search-message";
    status.textContent = message;
    this.element<HTMLDivElement>(selector).replaceChildren(status);
  }

  private renderAozoraKanaFilters(
    mode: "titles" | "authors",
    rowsSelector: string,
    stagesSelector: string,
    selectedRow: AozoraBrowseRowKey | undefined,
    selectedStage: string | undefined,
  ): void {
    const rows = this.element<HTMLDivElement>(rowsSelector);
    const rowFragment = document.createDocumentFragment();
    for (const row of AOZORA_BROWSE_ROWS) {
      const button = document.createElement("button");
      button.className = "aozora-filter-button";
      button.type = "button";
      button.dataset.aozoraBrowseMode = mode;
      button.dataset.aozoraBrowseRow = row.key;
      button.setAttribute("aria-pressed", String(selectedRow === row.key));
      button.textContent = row.label;
      rowFragment.append(button);
    }
    rows.replaceChildren(rowFragment);

    const stages = this.element<HTMLDivElement>(stagesSelector);
    stages.replaceChildren();
    const row = AOZORA_BROWSE_ROWS.find(({ key }) => key === selectedRow);
    if (!row || row.key === "その他") {
      stages.classList.add("is-hidden");
      return;
    }
    stages.classList.remove("is-hidden");

    const stageFragment = document.createDocumentFragment();
    const allButton = document.createElement("button");
    allButton.className = "aozora-filter-button";
    allButton.type = "button";
    allButton.dataset.aozoraBrowseMode = mode;
    allButton.dataset.aozoraBrowseStage = "all";
    allButton.setAttribute("aria-pressed", String(selectedStage === undefined));
    allButton.textContent = "すべて";
    stageFragment.append(allButton);

    for (const stage of row.stages) {
      const button = document.createElement("button");
      button.className = "aozora-filter-button";
      button.type = "button";
      button.dataset.aozoraBrowseMode = mode;
      button.dataset.aozoraBrowseStage = stage;
      button.setAttribute("aria-pressed", String(selectedStage === stage));
      button.textContent = stage;
      stageFragment.append(button);
    }
    stages.replaceChildren(stageFragment);
  }

  private selectAozoraTitleRow(row: AozoraBrowseRowKey): void {
    this.aozoraTitleRow = row;
    this.aozoraTitleStage = undefined;
    this.renderAozoraTitles();
  }

  private selectAozoraTitleStage(stage: string | undefined): void {
    this.aozoraTitleStage = stage;
    this.renderAozoraTitles();
  }

  private getAozoraTitleItems(): readonly AozoraIndexBook[] | undefined {
    if (!this.aozoraBrowseIndex || !this.aozoraTitleRow) return undefined;
    if (!this.aozoraTitleStage) return this.aozoraBrowseIndex.booksByRow.get(this.aozoraTitleRow) ?? [];
    return this.aozoraBrowseIndex.booksByRowStage.get(this.aozoraTitleRow)?.get(this.aozoraTitleStage) ?? [];
  }

  private renderAozoraTitles(): void {
    this.renderAozoraKanaFilters("titles", "#aozora-title-rows", "#aozora-title-stages", this.aozoraTitleRow, this.aozoraTitleStage);
    const list = this.element<HTMLDivElement>("#aozora-title-list");
    list.replaceChildren();
    this.aozoraTitlePage = 0;
    const items = this.getAozoraTitleItems();
    if (!items) {
      this.renderAozoraBrowseMessage("#aozora-title-list", "行を選んでください。");
      this.element<HTMLButtonElement>("#aozora-title-more").classList.add("is-hidden");
      return;
    }
    if (items.length === 0) {
      this.renderAozoraBrowseMessage("#aozora-title-list", "この行に作品はありません。");
      this.element<HTMLButtonElement>("#aozora-title-more").classList.add("is-hidden");
      return;
    }
    this.appendAozoraTitlePage();
  }

  private appendAozoraTitlePage(): void {
    const items = this.getAozoraTitleItems();
    if (!items) return;
    const page = getAozoraPage(items, this.aozoraTitlePage);
    if (page.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const work of page) fragment.append(this.createAozoraBookButton(work));
    this.element<HTMLDivElement>("#aozora-title-list").append(fragment);
    this.aozoraTitlePage += 1;
    this.updateAozoraMoreButton("#aozora-title-more", items.length, this.aozoraTitlePage);
  }

  private selectAozoraAuthorRow(row: AozoraBrowseRowKey): void {
    this.aozoraAuthorRow = row;
    this.aozoraAuthorStage = undefined;
    this.aozoraSelectedAuthor = undefined;
    this.renderAozoraAuthors();
  }

  private selectAozoraAuthorStage(stage: string | undefined): void {
    this.aozoraAuthorStage = stage;
    this.aozoraSelectedAuthor = undefined;
    this.renderAozoraAuthors();
  }

  private getAozoraAuthorItems(): readonly AozoraBrowseAuthor[] | undefined {
    if (!this.aozoraBrowseIndex || !this.aozoraAuthorRow) return undefined;
    if (!this.aozoraAuthorStage) return this.aozoraBrowseIndex.authorsByRow.get(this.aozoraAuthorRow) ?? [];
    return this.aozoraBrowseIndex.authorsByRowStage.get(this.aozoraAuthorRow)?.get(this.aozoraAuthorStage) ?? [];
  }

  private renderAozoraAuthors(): void {
    this.renderAozoraKanaFilters("authors", "#aozora-author-rows", "#aozora-author-stages", this.aozoraAuthorRow, this.aozoraAuthorStage);
    const listPanel = this.element<HTMLDivElement>("#aozora-author-list-panel");
    const booksPanel = this.element<HTMLDivElement>("#aozora-author-books-panel");
    if (this.aozoraSelectedAuthor) {
      listPanel.classList.add("is-hidden");
      booksPanel.classList.remove("is-hidden");
      this.element<HTMLHeadingElement>("#aozora-author-books-title").textContent = `${this.aozoraSelectedAuthor.name}（${this.aozoraSelectedAuthor.books.length}作品）`;
      this.element<HTMLDivElement>("#aozora-author-books").replaceChildren();
      this.aozoraAuthorBookPage = 0;
      this.appendAozoraAuthorBookPage();
      return;
    }

    listPanel.classList.remove("is-hidden");
    booksPanel.classList.add("is-hidden");
    this.element<HTMLDivElement>("#aozora-author-list").replaceChildren();
    this.aozoraAuthorPage = 0;
    const authors = this.getAozoraAuthorItems();
    if (!authors) {
      this.renderAozoraBrowseMessage("#aozora-author-list", "行を選んでください。");
      this.element<HTMLButtonElement>("#aozora-author-more").classList.add("is-hidden");
      return;
    }
    if (authors.length === 0) {
      this.renderAozoraBrowseMessage("#aozora-author-list", "この行に作者はいません。");
      this.element<HTMLButtonElement>("#aozora-author-more").classList.add("is-hidden");
      return;
    }
    this.appendAozoraAuthorPage();
  }

  private appendAozoraAuthorPage(): void {
    const authors = this.getAozoraAuthorItems();
    if (!authors) return;
    const page = getAozoraPage(authors, this.aozoraAuthorPage);
    if (page.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const author of page) {
      const button = document.createElement("button");
      button.className = "aozora-author";
      button.type = "button";
      button.dataset.aozoraAuthor = author.name;
      const name = document.createElement("span");
      name.className = "aozora-author-name";
      name.textContent = author.name;
      const count = document.createElement("span");
      count.className = "aozora-author-meta";
      count.textContent = `${author.books.length}作品`;
      button.append(name, count);
      fragment.append(button);
    }
    this.element<HTMLDivElement>("#aozora-author-list").append(fragment);
    this.aozoraAuthorPage += 1;
    this.updateAozoraMoreButton("#aozora-author-more", authors.length, this.aozoraAuthorPage);
  }

  private selectAozoraAuthor(name: string): void {
    const author = this.aozoraBrowseIndex?.authors.find((item) => item.name === name);
    if (!author) return;
    this.aozoraSelectedAuthor = author;
    this.aozoraAuthorBookPage = 0;
    this.renderAozoraAuthors();
  }

  private appendAozoraAuthorBookPage(): void {
    const books = this.aozoraSelectedAuthor?.books;
    if (!books) return;
    const page = getAozoraPage(books, this.aozoraAuthorBookPage);
    if (page.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const work of page) fragment.append(this.createAozoraBookButton(work));
    this.element<HTMLDivElement>("#aozora-author-books").append(fragment);
    this.aozoraAuthorBookPage += 1;
    this.updateAozoraMoreButton("#aozora-author-books-more", books.length, this.aozoraAuthorBookPage);
  }

  private updateAozoraMoreButton(selector: string, total: number, nextPage: number): void {
    this.element<HTMLButtonElement>(selector).classList.toggle("is-hidden", nextPage * AOZORA_BROWSE_PAGE_SIZE >= total);
  }

  private async importAozora(work: AozoraBook): Promise<void> {
    this.showLoading(`「${work.title}」を青空文庫から読み込んでいます…`);
    this.clearError();
    try {
      await this.openBook(await fetchAozoraBook(work));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "通信状態を確認してください。";
      this.showError(`「${work.title}」を読み込めませんでした。${detail}`);
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
      rubies: parsed.rubies ?? previous?.rubies ?? [],
      position: previous?.position ?? 0,
      lastViewedAt: Date.now(),
      format: parsed.format,
      totalChars: Array.from(parsed.text).length,
    };
    this.currentBook = record;
    this.chunks = buildChunks(record.text, this.chunkOptions(Number.MAX_SAFE_INTEGER), undefined, record.rubies);
    this.currentIndex = this.clampIndex(record.position);
    this.currentBook.position = this.currentIndex;
    this.showReader(parsed.warning);
    this.rebuildChunks();
    await this.repository?.save(this.currentBook);
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
      this.chunks = buildChunks(saved.text, this.chunkOptions(Number.MAX_SAFE_INTEGER), undefined, saved.rubies ?? []);
      this.currentIndex = this.clampIndex(saved.position);
      this.currentBook.position = this.currentIndex;
      this.showReader();
      this.rebuildChunks();
      await this.repository.save(this.currentBook);
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

  private chunkOptions(maxChars = this.calculateMaxChars()): ChunkOptions {
    return { groupSize: this.settings.groupSize, minChars: this.settings.minChars, maxChars };
  }

  private rebuildChunks(): void {
    if (!this.currentBook) return;
    const currentChar = this.chunks[this.currentIndex]?.charStart ?? 0;
    const options = this.chunkOptions();
    this.activeMaxChars = options.maxChars;
    this.chunks = buildChunks(this.currentBook.text, options, undefined, this.currentBook.rubies ?? []);
    let matchingIndex = 0;
    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index];
      if (!chunk || chunk.charStart > currentChar) break;
      matchingIndex = index;
    }
    this.currentIndex = this.clampIndex(matchingIndex);
    this.currentBook.position = this.currentIndex;
    this.recalculateTimingCoefficient();
    if (this.isPlaying) this.resetCurrentDeadline();
    this.updateReadingView();
    void this.persistPosition();
  }

  private settingsChanged(restartCurrentChunk: boolean, reflowChunks = false): void {
    saveSettings(this.settings);
    this.syncSettingsControls();
    if (reflowChunks) {
      this.updateReadingView();
      this.rebuildChunks();
      return;
    }
    this.recalculateTimingCoefficient();
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
    this.element<HTMLInputElement>("#show-ruby").checked = this.settings.showRuby;
    this.element<HTMLInputElement>("#break-reminder").checked = this.settings.breakReminder;
    this.element<HTMLInputElement>("#proportionality-slider").value = String(this.settings.proportionality);
    this.element<HTMLOutputElement>("#proportionality-value").value = `${this.settings.proportionality}%`;
    this.element<HTMLInputElement>("#comma-pause-slider").value = String(this.settings.commaPause);
    this.element<HTMLOutputElement>("#comma-pause-value").value = `${this.settings.commaPause.toFixed(1)}×`;
    this.element<HTMLInputElement>("#sentence-pause-slider").value = String(this.settings.sentencePause);
    this.element<HTMLOutputElement>("#sentence-pause-value").value = `${this.settings.sentencePause.toFixed(1)}×`;
    this.element<HTMLInputElement>("#paragraph-pause-slider").value = String(this.settings.paragraphPause);
    this.element<HTMLOutputElement>("#paragraph-pause-value").value = `${this.settings.paragraphPause.toFixed(1)}×`;
    this.element<HTMLInputElement>("#min-duration-slider").value = String(this.settings.minDuration);
    this.element<HTMLOutputElement>("#min-duration-value").value = `${this.settings.minDuration}ms`;
  }

  private updateReadingView(): void {
    const stage = this.element<HTMLDivElement>("#reading-stage");
    stage.classList.toggle("guides-on", this.settings.focusGuides);
    stage.style.setProperty("--reader-size", `${this.settings.fontSize}px`);
    this.element<HTMLButtonElement>("#play-toggle").textContent = this.isPlaying ? "Ⅱ 停止" : "▶ 再生";
    const chunk = this.chunks[this.currentIndex];
    const chunkElement = this.element<HTMLDivElement>("#current-chunk");
    chunkElement.style.fontSize = "";
    this.renderChunk(chunkElement, chunk);
    this.fitChunkToStage(chunkElement);
    const total = this.currentBook?.totalChars ?? 0;
    const charsRead = chunk ? Math.min(total, chunk.charStart + Array.from(chunk.text).length) : 0;
    this.element<HTMLProgressElement>("#progress").value = total ? charsRead / total : 0;
    this.element<HTMLElement>("#progress-count").textContent = `${charsRead.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}字`;
    const remaining = calculateRemainingTime(this.chunks, this.currentIndex, this.settings.speed, {
      punctuationPause: this.settings.punctuationPause,
      maxChars: this.activeMaxChars,
      proportionality: this.settings.proportionality,
      commaPause: this.settings.commaPause,
      sentencePause: this.settings.sentencePause,
      paragraphPause: this.settings.paragraphPause,
      minDuration: this.settings.minDuration,
      coefficient: this.timingCoefficient,
    });
    const seconds = Math.ceil(remaining / 1000);
    this.element<HTMLElement>("#remaining-time").textContent = `残り 約${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    this.element<HTMLButtonElement>("#go-to-start").disabled = !this.currentBook || this.currentIndex === 0;
    this.element<HTMLButtonElement>("#play-toggle").disabled = !this.currentBook || this.chunks.length === 0;
  }

  private calculateMaxChars(): number {
    const stage = this.element<HTMLDivElement>("#reading-stage");
    const style = window.getComputedStyle(stage);
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const innerWidth = Math.max(0, stage.clientWidth - padding);
    return Math.max(1, Math.floor(innerWidth / (this.settings.fontSize * 0.8)));
  }

  private scheduleLayoutUpdate(): void {
    if (!this.currentBook || this.element<HTMLElement>("#reader").classList.contains("is-hidden") || this.layoutFrame !== undefined) return;
    this.layoutFrame = window.requestAnimationFrame(() => {
      this.layoutFrame = undefined;
      if (!this.currentBook || this.element<HTMLElement>("#reader").classList.contains("is-hidden")) return;
      if (this.calculateMaxChars() !== this.activeMaxChars) this.rebuildChunks();
      else this.fitChunkToStage(this.element<HTMLDivElement>("#current-chunk"));
    });
  }

  private fitChunkToStage(chunkElement: HTMLDivElement): void {
    const preferredSize = this.settings.fontSize;
    const minimumSize = preferredSize * 0.8;
    chunkElement.style.fontSize = "";
    if (!chunkElement.isConnected) return;
    // 表示と同じフレームで縮める（次のフレームまで待つと、はみ出した状態が一瞬見える）。
    const available = chunkElement.clientWidth;
    const needed = chunkElement.scrollWidth;
    if (available <= 0 || needed <= available) return;
    let fontSize = Math.max(minimumSize, Math.floor(preferredSize * (available / needed) * 10) / 10);
    chunkElement.style.fontSize = `${fontSize}px`;
    while (fontSize > minimumSize && chunkElement.scrollWidth > chunkElement.clientWidth) {
      fontSize = Math.max(minimumSize, fontSize - 1);
      chunkElement.style.fontSize = `${fontSize}px`;
    }
  }

  private renderChunk(element: HTMLDivElement, chunk: Chunk | undefined): void {
    if (!chunk) {
      element.textContent = "ファイルを選ぶか、文章を貼り付けてください。";
      return;
    }

    const characters = Array.from(chunk.text);
    const chunkEnd = chunk.charStart + characters.length;
    const rubies = this.settings.showRuby
      ? (this.currentBook?.rubies ?? []).filter((ruby) => ruby.start >= chunk.charStart && ruby.end <= chunkEnd)
      : [];
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const ruby of rubies) {
      const start = ruby.start - chunk.charStart;
      const end = ruby.end - chunk.charStart;
      if (start < cursor || end <= start || end > characters.length) continue;
      if (start > cursor) fragment.append(document.createTextNode(characters.slice(cursor, start).join("")));

      const rubyElement = document.createElement("ruby");
      rubyElement.append(document.createTextNode(characters.slice(start, end).join("")));
      const readingElement = document.createElement("rt");
      readingElement.textContent = ruby.text;
      rubyElement.append(readingElement);
      fragment.append(rubyElement);
      cursor = end;
    }

    if (cursor < characters.length) fragment.append(document.createTextNode(characters.slice(cursor).join("")));
    element.replaceChildren(fragment);
  }

  private timingOptions(): Omit<TimingOptions, "paragraphEnd" | "coefficient"> {
    return {
      punctuationPause: this.settings.punctuationPause,
      maxChars: this.activeMaxChars,
      proportionality: this.settings.proportionality,
      commaPause: this.settings.commaPause,
      sentencePause: this.settings.sentencePause,
      paragraphPause: this.settings.paragraphPause,
      minDuration: this.settings.minDuration,
    };
  }

  private recalculateTimingCoefficient(): void {
    this.timingCoefficient = calculateTimingCoefficient(
      this.chunks,
      this.settings.speed,
      this.timingOptions(),
      this.currentBook?.totalChars,
    );
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
    const now = performance.now();
    // 5分以上止めていたら休んだとみなし、休憩までの時間を数え直す。
    if (this.lastPausedAt !== undefined && now - this.lastPausedAt >= BREAK_RESET_AFTER_PAUSE_MS) this.playedMs = 0;
    this.playStartedAt = now;
    this.element<HTMLDivElement>("#break-notice").classList.add("is-hidden");
    this.scheduleBreakReminder();
    this.resetCurrentDeadline();
    void this.requestWakeLock();
    this.updateReadingView();
  }

  private pausePlayback(): void {
    if (this.isPlaying && this.playStartedAt !== undefined) this.playedMs += performance.now() - this.playStartedAt;
    this.playStartedAt = undefined;
    this.lastPausedAt = performance.now();
    if (this.breakTimerId !== undefined) window.clearTimeout(this.breakTimerId);
    this.breakTimerId = undefined;
    this.isPlaying = false;
    if (this.timerId !== undefined) window.clearTimeout(this.timerId);
    this.timerId = undefined;
    this.nextDeadline = undefined;
    void this.releaseWakeLock();
    if (this.appRoot.querySelector("#play-toggle")) this.updateReadingView();
  }

  private scheduleBreakReminder(): void {
    if (this.breakTimerId !== undefined) window.clearTimeout(this.breakTimerId);
    this.breakTimerId = undefined;
    if (!this.isPlaying || !this.settings.breakReminder || this.playStartedAt === undefined) return;
    const playedSoFar = this.playedMs + (performance.now() - this.playStartedAt);
    this.breakTimerId = window.setTimeout(() => this.showBreakNotice(), Math.max(0, BREAK_AFTER_MS - playedSoFar));
  }

  private showBreakNotice(): void {
    this.breakTimerId = undefined;
    this.pausePlayback();
    this.playedMs = 0;
    this.element<HTMLDivElement>("#break-notice").classList.remove("is-hidden");
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
    if (!chunk) return 150;
    const next = this.chunks[index + 1];
    const paragraphEnd = !next || next.paragraphIndex !== chunk.paragraphIndex;
    return calculateChunkDuration(chunk, this.settings.speed, {
      punctuationPause: this.settings.punctuationPause,
      paragraphEnd,
      maxChars: this.activeMaxChars,
      proportionality: this.settings.proportionality,
      commaPause: this.settings.commaPause,
      sentencePause: this.settings.sentencePause,
      paragraphPause: this.settings.paragraphPause,
      minDuration: this.settings.minDuration,
      coefficient: this.timingCoefficient,
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
      const requestedLock = await wakeLockApi.request("screen");
      if (!this.isPlaying || document.visibilityState === "hidden") {
        await requestedLock.release();
        return;
      }
      this.wakeLock = requestedLock;
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

// 新しい版を公開すると、開いたままの古いページが参照する分割ファイルは消える。
// そのとき Safari は "Importing a module script failed." で失敗するので、1回だけ読み込み直す。
const UPDATE_RELOAD_KEY = "rsvp-reader.reloaded-for-update";
const staleModulePattern = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/iu;

function reloadForUpdate(): boolean {
  try {
    if (sessionStorage.getItem(UPDATE_RELOAD_KEY)) return false;
    sessionStorage.setItem(UPDATE_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function isStaleModuleError(error: unknown): boolean {
  return error instanceof Error && staleModulePattern.test(error.message);
}

window.addEventListener("vite:preloadError", (event) => {
  if (reloadForUpdate()) event.preventDefault();
});
window.addEventListener("unhandledrejection", (event) => {
  if (isStaleModuleError(event.reason)) reloadForUpdate();
});
// 正常に動き続けたら、次の更新でも再び自動で読み込み直せるよう印を消す。
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(UPDATE_RELOAD_KEY);
  } catch {
    // sessionStorage が使えない環境では何もしない。
  }
}, 10_000);

new ReaderApp(root);
