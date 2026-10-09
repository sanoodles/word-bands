import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE,
  etymologyHref,
  isSourceLang,
  SOURCE_LANGS,
  SOURCE_LANG_META,
  type SourceLang,
  wiktionaryHref,
} from "./languages";

describe("isSourceLang", () => {
  it("accepts every supported source language", () => {
    for (const l of SOURCE_LANGS) expect(isSourceLang(l)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const l of ["", "zz", "EN", "eng", "japanese"]) expect(isSourceLang(l)).toBe(false);
  });
});

describe("source-language metadata", () => {
  it("covers every source language with a name, default word and corpus", () => {
    for (const l of SOURCE_LANGS) {
      const meta = SOURCE_LANG_META[l];
      expect(meta.name).toBeTruthy();
      expect(meta.defaultWord).toBeTruthy();
      expect(meta.corpus.url).toMatch(/^https:\/\//);
    }
  });

  it("defaults to a supported language", () => {
    expect(isSourceLang(DEFAULT_SOURCE)).toBe(true);
  });
});

describe("etymologyHref", () => {
  // @spec ETYM-2
  it("sends each language to its own dictionary's entry for the word", () => {
    const cases: [SourceLang, string, string][] = [
      ["en", "water", "https://www.etymonline.com/word/water"],
      ["de", "Wasser", "https://www.dwds.de/wb/Wasser#etymwb-1"],
      ["fr", "cœur", "https://www.cnrtl.fr/etymologie/c%C5%93ur"],
      ["es", "agua", "https://dle.rae.es/agua"],
      ["it", "acqua", "https://dizionario.internazionale.it/parola/acqua"],
      ["pt", "água", "https://dicionario.priberam.org/%C3%A1gua"],
    ];
    for (const [source, word, href] of cases) expect(etymologyHref(word, source)).toBe(href);
  });

  // @spec ETYM-3
  it("spells the word the way its dictionary looks it up", () => {
    // The RAE keys on lowercase, so "Dios" answers nothing and "dios" is the entry.
    expect(etymologyHref("Dios", "es")).toBe("https://dle.rae.es/dios");
    // The Nuovo De Mauro drops the accent from its URLs, so "caffè" 404s there.
    expect(etymologyHref("caffè", "it")).toBe("https://dizionario.internazionale.it/parola/caffe");
    expect(etymologyHref("Perché", "it")).toBe("https://dizionario.internazionale.it/parola/perche");
    // German's capital is the word: "essen" and "Essen" are two entries in the DWDS.
    expect(etymologyHref("Essen", "de")).toBe("https://www.dwds.de/wb/Essen#etymwb-1");
  });

  it("keeps a hyphenated word one path segment", () => {
    expect(etymologyHref("arc-en-ciel", "fr")).toBe("https://www.cnrtl.fr/etymologie/arc-en-ciel");
  });
});

describe("wiktionaryHref", () => {
  // @spec WIKT-2
  it("opens the source language's own edition, under the title as given", () => {
    expect(wiktionaryHref("siesta", "es")).toBe("https://es.wiktionary.org/wiki/siesta");
    expect(wiktionaryHref("Wasser", "de")).toBe("https://de.wiktionary.org/wiki/Wasser");
    expect(wiktionaryHref("alienígena", "es")).toBe("https://es.wiktionary.org/wiki/alien%C3%ADgena");
  });
});
