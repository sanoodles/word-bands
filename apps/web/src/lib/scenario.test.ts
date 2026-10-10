// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pageTitle, readScenario, writeScenario } from "./scenario";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("readScenario", () => {
  // @spec URL-3
  it("keeps view=defining in every language, and where the link names none", () => {
    window.history.replaceState(null, "", "/?source=en&view=defining");
    expect(readScenario()).toEqual({ source: "en", view: "defining" });
    window.history.replaceState(null, "", "/?view=defining");
    expect(readScenario()).toEqual({ view: "defining" });
  });

  // @spec URL-1
  it("parses a full scenario from the query string", () => {
    window.history.replaceState(null, "", "/?source=de&word=essen&target=en&view=cefr&band=A2");
    expect(readScenario()).toEqual({
      source: "de",
      word: "essen",
      target: "en",
      view: "cefr",
      band: "A2",
    });
  });

  // @spec URL-3
  it("drops unknown source languages and views", () => {
    window.history.replaceState(null, "", "/?source=xx&view=bogus&word=cat");
    expect(readScenario()).toEqual({ word: "cat" });
  });

  // A link shared under the older spellings still opens on the pair it names.
  // @spec URL-2
  it("also accepts lang and tl", () => {
    window.history.replaceState(null, "", "/?lang=de&word=essen&tl=en");
    expect(readScenario()).toEqual({ source: "de", word: "essen", target: "en" });
  });

  // @spec URL-2
  it("prefers the canonical spelling when both are present", () => {
    window.history.replaceState(null, "", "/?source=fr&lang=de&target=it&tl=en");
    expect(readScenario()).toEqual({ source: "fr", target: "it" });
  });

  it("returns an empty scenario when nothing is set", () => {
    expect(readScenario()).toEqual({});
  });
});

describe("writeScenario", () => {
  const WATER = { source: "en", word: "water", target: "es", view: "cefr", band: null } as const;

  // @spec URL-1
  it("round-trips through readScenario", () => {
    writeScenario({ source: "fr", word: "eau", target: "en", view: "freq", band: null }, "replace");
    expect(readScenario()).toEqual({ source: "fr", word: "eau", target: "en", view: "freq" });
  });

  // @spec URL-4
  it("omits an unset band but always keeps the source and view", () => {
    writeScenario({ source: "en", word: "water", target: "en", view: "cefr", band: null }, "replace");
    const p = new URLSearchParams(window.location.search);
    expect(p.has("band")).toBe(false);
    expect(p.get("source")).toBe("en");
    expect(p.get("view")).toBe("cefr");
  });

  // @spec URL-8
  it("adds an entry for a push and none for a replace", () => {
    const start = window.history.length;
    writeScenario(WATER, "replace");
    expect(window.history.length).toBe(start);
    writeScenario({ ...WATER, word: "cat" }, "push");
    expect(window.history.length).toBe(start + 1);
    expect(readScenario().word).toBe("cat");
  });

  // @spec URL-8
  it("adds no entry where the URL would not change", () => {
    writeScenario(WATER, "replace");
    const start = window.history.length;
    writeScenario(WATER, "push");
    expect(window.history.length).toBe(start);
  });
});

describe("pageTitle", () => {
  // @spec URL-6
  it("names the word", () => {
    expect(pageTitle("Wasser")).toBe("wordbands: Wasser");
  });

  it("falls back to the bare title when there is no word", () => {
    expect(pageTitle(undefined)).toBe("wordbands");
    expect(pageTitle(null)).toBe("wordbands");
    expect(pageTitle(" ")).toBe("wordbands");
  });

  // The word can arrive straight off the query string, so it is not a corpus word yet.
  // @spec URL-6
  it("caps a word the query string made up", () => {
    expect(pageTitle("x".repeat(500))).toBe(`wordbands: ${"x".repeat(40)}`);
  });
});
