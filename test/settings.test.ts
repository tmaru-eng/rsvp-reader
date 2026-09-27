import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/lib/settings";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("reader settings", () => {
  it("starts at 600 characters per minute with comfortable reading controls", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ speed: 600, groupSize: 1, minChars: 0, fontSize: 56 });
  });

  it("persists settings and clamps invalid stored values to the supported range", () => {
    const storage = memoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, speed: 1200, groupSize: 2, minChars: 3 }, storage);
    expect(loadSettings(storage)).toMatchObject({ speed: 1200, groupSize: 2, minChars: 3 });
    storage.setItem("rsvp-reader.settings.v1", JSON.stringify({ speed: 9999, groupSize: 8, minChars: 9, fontSize: 2 }));
    expect(loadSettings(storage)).toMatchObject({ speed: 3000, groupSize: 1, minChars: 0, fontSize: 32 });
  });

  it("defaults to 40px below 600px wide unless a saved font size exists", () => {
    const storage = memoryStorage();
    expect(loadSettings(storage, 390).fontSize).toBe(40);
    saveSettings({ ...DEFAULT_SETTINGS, fontSize: 48 }, storage);
    expect(loadSettings(storage, 390).fontSize).toBe(48);
  });
});
