import { describe, expect, it } from "vitest";
import {
  getBand,
  getBandSummary,
  getDefiningPoints,
  getLevel,
  getSuggestions,
  getWord,
  viewsFor,
} from "@/lib/bands";
import { DEFINING_EXAMPLE, DEFINING_LANGS, hasDefining, SOURCE_LANGS } from "@/lib/languages";

// German carries display casing (nouns/names capitalized) while lookups stay
// case-insensitive; other languages are unaffected. See scripts/build-bands.ts.
describe("source-language casing", () => {
  // @spec BAND-5, FILTER-6
  it("shows a German noun capitalized, however it was queried", () => {
    expect(getWord("de", "wasser")?.word).toBe("Wasser");
    expect(getWord("de", "WASSER")?.word).toBe("Wasser");
  });

  // @spec FILTER-6
  it("keeps a German verb lowercase (homograph resolved by frequency)", () => {
    expect(getWord("de", "sein")?.word).toBe("sein");
  });

  // @spec BAND-5, BAND-10
  it("matches typeahead on a lowercase prefix but returns display casing", () => {
    const hits = getSuggestions("de", "wass");
    expect(hits).toContain("Wasser");
    expect(hits.every((w) => w.toLowerCase().startsWith("wass"))).toBe(true);
  });

  // @spec FILTER-7
  it("leaves languages without a casing source lowercase", () => {
    const w = getBand("en", "freq", "1")!.words[0]!;
    expect(w).toBe(w.toLowerCase());
  });
});

describe("case-homographs", () => {
  // @spec BAND-6
  it("returns both casings for a homograph, most frequent first", () => {
    expect(getWord("de", "essen")?.forms).toEqual(["Essen", "essen"]);
    expect(getWord("de", "ESSEN")?.forms).toEqual(["Essen", "essen"]);
  });

  // @spec BAND-6
  it("returns just the single word for a non-homograph", () => {
    expect(getWord("de", "wasser")?.forms).toEqual(["Wasser"]);
    expect(getWord("en", "the")?.forms).toEqual(["the"]);
  });
});

// The thresholds are the one number in the app a learner is told to trust. They are
// English-derived and reused unchanged, so a language that disagreed would be a build
// that had quietly diverged.
// @spec BAND-1, BAND-2
describe("band definitions", () => {
  const LANGS = ["en", "es", "fr", "de", "pt", "it"] as const;
  const TOPS = [
    ["A1", 1000],
    ["A2", 3000],
    ["B1", 6000],
    ["B2", 12000],
    ["C1", 25000],
  ] as const;

  // Asserted through the counts rather than the definitions, so this fails on a band
  // that is defined right and emitted wrong.
  const topsOf = (lang: (typeof LANGS)[number]) => {
    const counts = new Map(getBandSummary(lang, "cefr").map((b) => [b.key, b.count]));
    let top = 0;
    return TOPS.map(([key]) => [key, (top += counts.get(key) ?? 0)] as const);
  };

  it("tops each CEFR band at its calibrated rank", () => {
    expect(topsOf("en")).toEqual(TOPS.map(([k, r]) => [k, r]));
  });

  it("uses the same thresholds in every language", () => {
    for (const lang of LANGS) expect(topsOf(lang), lang).toEqual(topsOf("en"));
  });

  it("keeps the two views over one list, so the same word is in both", () => {
    for (const lang of LANGS) {
      const total = (view: "freq" | "cefr") =>
        getBandSummary(lang, view).reduce((n, b) => n + b.count, 0);
      expect(total("cefr"), lang).toBe(total("freq"));
    }
  });
});

// C2 ends at rank 50,000 and `rare` past it is open-ended, which is what lets `getWord`
// assert that a band exists at every rank. German reaches it, on the strength of the
// morphology vouch (FILTER-10); the other five stop inside C2. See CEFR_BANDS in
// scripts/build-bands.ts.
describe("CEFR tail", () => {
  // @spec BAND-1
  it("bounds C2 instead of letting it swallow the list", () => {
    const c2 = getBandSummary("es", "cefr").find((b) => b.key === "C2")!;
    expect(c2.count).toBeLessThan(25000);
  });

  // @spec BAND-4, FILTER-4
  it("offers the tail band exactly where a list runs past it, and never empty", () => {
    for (const lang of ["en", "es", "fr", "de", "pt", "it"] as const) {
      const bands = getBandSummary(lang, "cefr");
      const total = bands.reduce((n, b) => n + b.count, 0);
      expect(bands.map((b) => b.key).includes("rare"), lang).toBe(total > 50000);
      expect(bands.every((b) => b.count > 0), lang).toBe(true);
    }
  });

  // @spec FILTER-4
  // Whichever band a list ends in, its last word has to be in it — that is the property
  // `getWord`'s non-null band assertion rests on.
  it("gives the deepest word of every list a band", () => {
    for (const lang of ["en", "es", "fr", "de", "pt", "it"] as const) {
      const last = getBandSummary(lang, "cefr").at(-1)!.key;
      const deepest = getBand(lang, "cefr", last)!.words.at(-1)!;
      expect(getWord(lang, deepest)!.cefr.key, lang).toBe(last);
    }
  });

  // The dictionary gate's whole point: the deep tail was names and OCR debris, so the
  // last word of every list should now be something its own dictionary vouches for.
  it("keeps the deepest word inside C2", () => {
    for (const lang of ["fr", "it"] as const) {
      const c2 = getBand(lang, "cefr", "C2")!;
      const last = c2.words.at(-1)!;
      expect(getWord(lang, last)!.cefr.key).toBe("C2");
    }
  });

  // getWord asserts a band exists at every rank, so a gap would be a crash, not a miss.
  // @spec BAND-3
  it("leaves no rank uncovered by a band", () => {
    const sum = (bs: { count: number }[]) => bs.reduce((n, b) => n + b.count, 0);
    for (const lang of ["en", "es", "de"] as const) {
      const cefr = getBandSummary(lang, "cefr");
      expect(sum(cefr)).toBe(sum(getBandSummary(lang, "freq")));
      expect(cefr.every((b) => b.count > 0)).toBe(true);
    }
  });
});

// The level badges on the word card. Google orders the alternatives by confidence,
// not difficulty, so the level is what separates the word to learn from the one beside it.
describe("translation levels", () => {
  it("places a term at its CEFR band and rank", () => {
    const water = getLevel("en", "water")!;
    expect(water.key).toBe("A1");
    expect(water.rank).toBeGreaterThan(0);
    // Same meaning, far rarer alternative — the difference the badge exists to show.
    expect(getLevel("en", "aqua")!.rank).toBeGreaterThan(water.rank * 5);
  });

  // @spec BAND-7
  it("keys case-insensitively, so a capitalized term still resolves", () => {
    expect(getLevel("de", "wasser")).toEqual(getLevel("de", "Wasser"));
  });

  // A translated term is routinely something the list has no headword for; not an error.
  // @spec BAND-8
  it("returns nothing for a phrase or a word the language doesn't carry", () => {
    expect(getLevel("es", "usar naja")).toBeNull();
    expect(getLevel("en", "zzzzznotaword")).toBeNull();
  });
});

// Suggestions come from a prefix index bucketed on the first one or two characters;
// queries shorter than the bucket key still have to reach the right bucket.
describe("typeahead", () => {
  // @spec BAND-10
  it("suggests on a single character, most frequent first", () => {
    const hits = getSuggestions("en", "a");
    expect(hits.every((w) => w.startsWith("a"))).toBe(true);
    expect(hits).toHaveLength(8);
    expect(hits[0]).toBe("a");
  });

  it("returns nothing for a prefix no word starts with", () => {
    expect(getSuggestions("en", "zzq")).toEqual([]);
    expect(getSuggestions("en", "qx")).toEqual([]);
  });

  // @spec BAND-10
  it("honours the limit and keeps frequency order", () => {
    const hits = getSuggestions("en", "th", 3);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toBe("the");
  });

  // The search box reads the head of the list to decide whether the typed text is
  // itself a word, so the exact match has to be there however crowded the prefix is.
  // @spec BAND-10
  it("leads with the exact match, ahead of commoner words sharing the prefix", () => {
    expect(getSuggestions("en", "ban", 3)).toEqual(["ban", "bank", "band"]);
  });

  // @spec BAND-14
  it("matches a letter typed without a diacritic to that letter with one", () => {
    const hits = getSuggestions("es", "cordo");
    expect(hits).toContain("cordón");
    expect(hits).toContain("cordobés");
  });

  // @spec BAND-14
  it("matches a letter typed with a diacritic only to itself", () => {
    const hits = getSuggestions("es", "có");
    expect(hits).toContain("cómo");
    expect(hits.every((w) => w.toLowerCase().startsWith("có"))).toBe(true);
  });

  // The search box looks up the head of the list unasked, so it has to be the spelling typed.
  // @spec BAND-10, BAND-14
  it("leads with the exact spelling, ahead of a commoner word that differs by a diacritic", () => {
    expect(getSuggestions("es", "ano", 2)).toEqual(["ano", "año"]);
  });

  it("reads a decomposed diacritic as the letter it composes", () => {
    expect(getSuggestions("es", "co\u0301mo")[0]).toBe("cómo");
  });
});

// A defining level says how heavily the dictionary leans on a word when defining others,
// which is not a rank window and not a learning order. It exists only for DEFINING_LANGS.
describe("the defining view", () => {
  // @spec BAND-11
  it("is offered by exactly the languages that carry levels", () => {
    for (const lang of SOURCE_LANGS) {
      expect(viewsFor(lang).includes("defining"), lang).toBe(hasDefining(lang));
    }
  });

  // @spec BAND-11
  it("offers nothing for a language without levels", () => {
    expect(getBandSummary("en", "defining")).toEqual([]);
    expect(getBand("en", "defining", "D1")).toBeNull();
    expect(getWord("en", "water")?.defining).toBeUndefined();
  });

  // The other two views are total because every rank falls in a window. This one is total
  // only because `none` is offered as a band — a third of the list has no level. A level
  // the bands do not name would drop its words from the sum.
  // @spec BAND-12
  it("puts every word in a band, the unlevelled ones in `none`", () => {
    for (const lang of DEFINING_LANGS) {
      const bands = getBandSummary(lang, "defining");
      const sum = (v: Parameters<typeof getBandSummary>[1]) =>
        getBandSummary(lang, v).reduce((n, b) => n + b.count, 0);
      expect(sum("defining"), lang).toBe(sum("freq"));
      expect(bands.map((b) => b.key), lang).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "none"]);
    }
    const none = (lang: Parameters<typeof getBandSummary>[0]) =>
      getBandSummary(lang, "defining").find((b) => b.key === "none")?.count;
    expect(none("pt")).toBe(13003);
    expect(none("it")).toBe(11558);
  });

  // WCAG 3.1.4: eight tabs reading "D1" to "D7" fit the row only as abbreviations, so
  // each carries a spelled-out name for the tab to be called by.
  it("spells out every defining band, and abbreviates none of the others", () => {
    for (const lang of DEFINING_LANGS) {
      const bands = getBandSummary(lang, "defining");
      expect(bands.map((b) => b.name), lang).toEqual([
        "Defining level 1",
        "Defining level 2",
        "Defining level 3",
        "Defining level 4",
        "Defining level 5",
        "Defining level 6",
        "Defining level 7",
        "No defining level",
      ]);
    }
    // The CEFR and frequency labels are words already, so they carry no second name.
    for (const view of ["cefr", "freq"] as const)
      expect(getBandSummary("pt", view).every((b) => b.name === undefined), view).toBe(true);
  });

  // D1 is the core the dictionary explains everything else with, so it is tiny and its
  // words are the commonest ones. `john` is in the list and has no level at all.
  it("answers a word with its level", () => {
    expect(getWord("pt", "água")?.defining?.key).toBe("D3");
    expect(getWord("pt", "ser")?.defining?.key).toBe("D1");
    expect(getWord("pt", "john")?.defining?.key).toBe("none");
    expect(getWord("it", "acqua")?.defining?.key).toBe("D2");
    expect(getWord("it", "essere")?.defining?.key).toBe("D1");
    expect(getWord("it", "john")?.defining?.key).toBe("none");
  });

  // The scale measures what the dictionary leans on, not what a learner meets first, and
  // each language's example is the word that proves the two come apart: A1 vocabulary at
  // D7, because no definition is ever written in terms of "hello". The figure's caption
  // makes this claim, so every language it can be shown for has to back it.
  it("does not order words by difficulty", () => {
    for (const lang of DEFINING_LANGS) {
      const example = DEFINING_EXAMPLE[lang]!;
      expect(getWord(lang, example)?.cefr.key, example).toBe("A1");
      expect(getWord(lang, example)?.defining?.key, example).toBe("D7");
    }
  });

  // The figure plots a point per levelled word, positioned by its index in `words`. One
  // char missing from `levels` would shift every point after it onto the wrong word.
  // @spec BAND-13
  it("serves the figure one level per ranked word, and only where levels exist", () => {
    for (const lang of DEFINING_LANGS) {
      const p = getDefiningPoints(lang)!;
      expect(p.levels, lang).toHaveLength(p.words.length);
    }
    const levelled = (lang: Parameters<typeof getBandSummary>[0]) =>
      [...getDefiningPoints(lang)!.levels].filter((c) => c !== "-");
    expect(getDefiningPoints("pt")!.words).toHaveLength(35827);
    expect(levelled("pt")).toHaveLength(22824);
    expect(getDefiningPoints("it")!.words).toHaveLength(33480);
    expect(levelled("it")).toHaveLength(21922);
    expect(getDefiningPoints("en")).toBeNull();
  });

  it("lists a band in frequency order", () => {
    const d1 = getBand("pt", "defining", "D1")!;
    expect(d1.words).toHaveLength(51);
    expect(d1.words.slice(0, 4)).toEqual(["o", "que", "a", "não"]);
    const d1It = getBand("it", "defining", "D1")!;
    expect(d1It.words).toHaveLength(366);
    expect(d1It.words.slice(0, 4)).toEqual(["essere", "e", "il", "avere"]);
  });
});
