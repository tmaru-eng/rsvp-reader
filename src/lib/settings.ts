import type { ChunkOptions } from "./chunking";

export interface ReaderSettings extends Omit<ChunkOptions, "maxChars"> {
  speed: number;
  fontSize: number;
  punctuationPause: boolean;
  focusGuides: boolean;
}

export const SETTINGS_STORAGE_KEY = "rsvp-reader.settings.v1";

export const DEFAULT_SETTINGS: ReaderSettings = {
  speed: 600,
  groupSize: 1,
  minChars: 0,
  fontSize: 56,
  punctuationPause: true,
  focusGuides: true,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function acceptedValue<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && allowed.includes(value as T) ? (value as T) : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
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
