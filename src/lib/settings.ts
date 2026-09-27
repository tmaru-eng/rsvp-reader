import type { ChunkOptions } from "./chunking";

export interface ReaderSettings extends Omit<ChunkOptions, "maxChars"> {
  /** 再生した時間が合計 50 分に達したら止めて休憩を案内する（厚生労働省の情報機器作業ガイドライン）。 */
  breakReminder: boolean;
  speed: number;
  fontSize: number;
  punctuationPause: boolean;
  focusGuides: boolean;
  proportionality: number;
  commaPause: number;
  sentencePause: number;
  paragraphPause: number;
  minDuration: number;
}

export const SETTINGS_STORAGE_KEY = "rsvp-reader.settings.v1";

// 既定値の根拠は docs/research-defaults.md。速度は大学生の黙読平均 653字/分（小林・川島 2018）より低め、
// 注視ガイドは誘導なしのほうが理解度が高かった日本語 RSVP 実験（石森・桐谷 2024）に合わせて既定でオフ。
export const DEFAULT_SETTINGS: ReaderSettings = {
  speed: 450,
  groupSize: 1,
  minChars: 3,
  fontSize: 56,
  punctuationPause: true,
  focusGuides: false,
  breakReminder: true,
  proportionality: 100,
  commaPause: 1.3,
  sentencePause: 1.8,
  paragraphPause: 2.2,
  minDuration: 200,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function acceptedValue<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && allowed.includes(value as T) ? (value as T) : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

function boundedDecimal(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function parseSettings(raw: string | null, defaultFontSize = DEFAULT_SETTINGS.fontSize): ReaderSettings {
  if (!raw) return { ...DEFAULT_SETTINGS, fontSize: defaultFontSize };
  try {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object") return { ...DEFAULT_SETTINGS };
    const values = stored as Record<string, unknown>;
    return {
      speed: boundedNumber(values.speed, DEFAULT_SETTINGS.speed, 200, 3000),
      groupSize: acceptedValue(values.groupSize, [1, 2, 3] as const, DEFAULT_SETTINGS.groupSize),
      minChars: acceptedValue(values.minChars, [0, 2, 3, 4] as const, DEFAULT_SETTINGS.minChars),
      fontSize: boundedNumber(values.fontSize, defaultFontSize, 32, 96),
      punctuationPause: typeof values.punctuationPause === "boolean" ? values.punctuationPause : DEFAULT_SETTINGS.punctuationPause,
      focusGuides: typeof values.focusGuides === "boolean" ? values.focusGuides : DEFAULT_SETTINGS.focusGuides,
      breakReminder: typeof values.breakReminder === "boolean" ? values.breakReminder : DEFAULT_SETTINGS.breakReminder,
      proportionality: boundedNumber(values.proportionality, DEFAULT_SETTINGS.proportionality, 0, 100),
      commaPause: boundedDecimal(values.commaPause, DEFAULT_SETTINGS.commaPause, 1, 3),
      sentencePause: boundedDecimal(values.sentencePause, DEFAULT_SETTINGS.sentencePause, 1, 3),
      paragraphPause: boundedDecimal(values.paragraphPause, DEFAULT_SETTINGS.paragraphPause, 1, 4),
      minDuration: boundedNumber(values.minDuration, DEFAULT_SETTINGS.minDuration, 50, 400),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function loadSettings(
  storage: StorageLike = window.localStorage,
  viewportWidth = typeof window === "undefined" ? 600 : window.innerWidth,
): ReaderSettings {
  const defaultFontSize = viewportWidth < 600 ? 40 : DEFAULT_SETTINGS.fontSize;
  try {
    return parseSettings(storage.getItem(SETTINGS_STORAGE_KEY), defaultFontSize);
  } catch {
    return { ...DEFAULT_SETTINGS, fontSize: defaultFontSize };
  }
}

export function saveSettings(settings: ReaderSettings, storage: StorageLike = window.localStorage): void {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The app remains usable when storage is disabled or full.
  }
}
