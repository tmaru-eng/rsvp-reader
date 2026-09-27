import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from "../src/lib/settings";

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
    expect(DEFAULT_SETTINGS).toMatchObject({
      speed: 600,
      groupSize: 1,
      minChars: 0,
      fontSize: 56,
      proportionality: 100,
      commaPause: 1.3,
      sentencePause: 1.6,
      paragraphPause: 1.8,
      minDuration: 150,
    });
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

  it("persists detailed timing settings", () => {
    const storage = memoryStorage();
    const detailed = {
      ...DEFAULT_SETTINGS,
      proportionality: 70,
      commaPause: 2.1,
      sentencePause: 1.9,
      paragraphPause: 3.4,
      minDuration: 220,
    };

    saveSettings(detailed, storage);

    expect(loadSettings(storage)).toMatchObject(detailed);
  });

  it("uses the detailed defaults when reading existing v1 settings without them", () => {
    const oldSettings = JSON.stringify({ speed: 900, punctuationPause: false });

    expect(parseSettings(oldSettings)).toMatchObject({
      speed: 900,
      punctuationPause: false,
      proportionality: 100,
      commaPause: 1.3,
      sentencePause: 1.6,
      paragraphPause: 1.8,
      minDuration: 150,
    });
  });

  it("clamps detailed timing values to their supported ranges", () => {
    const parsed = parseSettings(JSON.stringify({
      proportionality: -10,
      commaPause: 0.5,
      sentencePause: 4,
      paragraphPause: 8,
      minDuration: 999,
    }));

    expect(parsed).toMatchObject({
      proportionality: 0,
      commaPause: 1,
      sentencePause: 3,
      paragraphPause: 4,
      minDuration: 400,
    });
  });

  it("preserves fractional punctuation multipliers when parsing settings", () => {
    const parsed = parseSettings(JSON.stringify({ commaPause: 1.7, sentencePause: 2.2, paragraphPause: 2.7 }));

    expect(parsed).toMatchObject({ commaPause: 1.7, sentencePause: 2.2, paragraphPause: 2.7 });
  });
});
