import { afterEach, describe, expect, it, vi } from "vitest";
import { getBand } from "@/lib/bands";
import { GET as wordGET } from "./word/[word]/route";
import { GET as suggestGET } from "./suggest/route";
import { GET as bandsGET } from "./bands/[view]/route";
import { GET as bandGET } from "./band/[view]/[key]/route";
import { GET as translateGET } from "./translate/[word]/route";
import { GET as wiktionaryGET } from "./wiktionary/[word]/route";

// A guaranteed-present headword (the single most frequent) and an absent one.
const REAL = getBand("en", "freq", "1")!.words[0]!;
const REAL_ES = getBand("es", "freq", "1")!.words[0]!;
const MISSING = "zzzzznotaword";
const req = (url: string) => new Request(`http://test${url}`);
const promise = <T>(v: T) => Promise.resolve(v);

describe("GET /api/word/[word]", () => {
  // @spec ROUTE-8
  it("returns the word's bands and lowercases the param", async () => {
    const res = await wordGET(req("/api/word/X"), { params: promise({ word: REAL.toUpperCase() }) });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.word).toBe(REAL);
    expect(info.rank).toBe(1);
    expect(info.freq.key).toBe("1");
    expect(info.cefr.key).toBe("A1");
  });

  // @spec ROUTE-9
  it("404s for an unknown word", async () => {
    const res = await wordGET(req("/api/word/x"), { params: promise({ word: MISSING }) });
    expect(res.status).toBe(404);
  });

  it("looks the word up in the requested source language", async () => {
    const res = await wordGET(req(`/api/word/x?source=es`), { params: promise({ word: REAL_ES }) });
    expect(res.status).toBe(200);
    expect((await res.json()).word).toBe(REAL_ES);
  });

  // @spec ROUTE-9
  it("404s for an unknown source language", async () => {
    const res = await wordGET(req("/api/word/x?source=zz"), { params: promise({ word: REAL }) });
    expect(res.status).toBe(404);
  });

  // @spec FORM-4
  it("answers an inflected form with its base word, naming the form asked for", async () => {
    const res = await wordGET(req("/api/word/x"), { params: promise({ word: "Branched" }) });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.word).toBe("branch");
    expect(info.from).toBe("branched");
  });

  // @spec FORM-3
  it("does not call a word found as typed a redirect", async () => {
    const res = await wordGET(req("/api/word/x"), { params: promise({ word: REAL }) });
    expect((await res.json()).from).toBeUndefined();
  });

  // Next decodes the param before the handler sees it, so a decode here would be a second
  // one — and would throw on anything holding a stray percent.
  // @spec ROUTE-7
  it("treats the param as already decoded", async () => {
    const res = await wordGET(req("/api/word/x"), { params: promise({ word: "%" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/suggest", () => {
  it("returns prefix matches, honoring the limit", async () => {
    const res = await suggestGET(req("/api/suggest?q=th&limit=3"));
    const words = (await res.json()) as string[];
    expect(words.length).toBeLessThanOrEqual(3);
    expect(words.every((w) => w.startsWith("th"))).toBe(true);
  });

  // Unbounded, one lookup hands back the query's whole prefix bucket.
  // @spec ROUTE-11
  it("clamps a limit asking for more than a dropdown's worth", async () => {
    const res = await suggestGET(req("/api/suggest?q=a&limit=1000000000"));
    expect(((await res.json()) as string[]).length).toBeLessThanOrEqual(50);
  });

  // @spec ROUTE-11
  it("falls back to the default for a limit that is not a count", async () => {
    for (const qs of ["limit=abc", "limit=-1", "limit="]) {
      const res = await suggestGET(req(`/api/suggest?q=a&${qs}`));
      const words = (await res.json()) as string[];
      expect(words.length).toBeGreaterThan(0);
      expect(words.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("GET /api/bands/[view]", () => {
  it("returns a summary for each view", async () => {
    for (const view of ["freq", "cefr"]) {
      const res = await bandsGET(req("/api/bands/x"), { params: promise({ view }) });
      expect(res.status).toBe(200);
      const summary = await res.json();
      expect(summary.length).toBe(6);
      expect(summary.every((b: { count: number }) => b.count > 0)).toBe(true);
    }
  });

  // @spec ROUTE-9
  it("404s for an unknown view", async () => {
    const res = await bandsGET(req("/api/bands/x"), { params: promise({ view: "nope" }) });
    expect(res.status).toBe(404);
  });
});

// A gtx dt=bd response: translation segments, then dictionary groups of scored entries.
function mockGtx(translation: string, pos: string, entries: [string, number][]) {
  const body = [
    [[translation, "x", null, null, 1]],
    [[pos, entries.map(([t]) => t), entries.map(([t, s]) => [t, [], null, s])]],
  ];
  return vi.fn(async () => new Response(JSON.stringify(body)));
}

const translate = (word: string, qs: string) =>
  translateGET(req(`/api/translate/x?${qs}`), { params: promise({ word }) });

afterEach(() => vi.unstubAllGlobals());

// This route answers by calling Google, so what it declines to forward matters as much as
// what it returns: unguarded it is a general-purpose translation relay on our own quota.
describe("GET /api/translate/[word] input", () => {
  // @spec GATE-5
  const refuses = async (word: string, qs: string) => {
    const upstream = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", upstream);
    const res = await translate(word, qs);
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  };

  // @spec GATE-1
  it("refuses arbitrary text, which is what a word is not", async () => {
    await refuses("the quick brown fox jumps over the lazy dog", "source=en&target=es");
  });

  // @spec GATE-1
  it("refuses a word longer than any the corpora hold", async () => {
    await refuses("a".repeat(65), "source=en&target=es");
  });

  // @spec GATE-4
  it("refuses a target that is not a language code", async () => {
    await refuses("water", "source=en&target=notalanguage");
  });

  // @spec GATE-3
  it("refuses a source outside the six we index", async () => {
    await refuses("water", "source=zz&target=es");
  });

  // @spec GATE-4
  it("still takes any language Google does as a target", async () => {
    vi.stubGlobal("fetch", mockGtx("水", "noun", [["水", 0.6]]));
    expect((await translate("water", "source=en&target=ja&dict=1")).status).toBe(200);
  });
});

// Google ranks a translation's alternatives by confidence, not difficulty, so the card badges
// each with its level in the language it's written in — "agua" A1 beside "orina" B1.
describe("GET /api/translate/[word] levels", () => {
  it("levels every dictionary term in the target language", async () => {
    vi.stubGlobal("fetch", mockGtx("agua", "noun", [["agua", 0.6], ["orina", 0.02]]));
    const { levels } = await (await translate("water", "source=en&target=es&dict=1")).json();
    expect(levels.agua.key).toBe("A1");
    expect(levels.agua.rank).toBeGreaterThan(0);
    expect(levels.orina.key).not.toBe("A1");
  });

  it("levels the plain translation too, which is all there is without a dictionary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([[["casa", "x"]]]))));
    const { levels } = await (await translate("house", "source=en&target=es")).json();
    expect(levels.casa.key).toBe("A1");
  });

  // Only the six indexed languages have a word list to place a term in.
  // @spec BAND-9
  it("leaves the terms unlevelled for a language we don't index", async () => {
    vi.stubGlobal("fetch", mockGtx("水", "noun", [["水", 0.6]]));
    const { levels } = await (await translate("water", "source=en&target=ja&dict=1")).json();
    expect(levels).toEqual({});
  });

  // "constructor" is an ordinary English headword. Keyed on an object literal it looked
  // already-seen, because `in` walks the prototype chain, and so never got a badge.
  it("levels a term that shares a name with an Object.prototype key", async () => {
    vi.stubGlobal("fetch", mockGtx("constructor", "noun", [["constructor", 0.6]]));
    const { levels } = await (await translate("constructor", "source=es&target=en&dict=1")).json();
    expect(Object.hasOwn(levels, "constructor")).toBe(true);
    expect(levels.constructor.rank).toBeGreaterThan(0);
  });

  // Phrases and words the list has no headword for are ordinary, and go unbadged.
  it("skips a term the target language has no entry for", async () => {
    vi.stubGlobal("fetch", mockGtx("naja", "noun", [["naja", 0.6], ["cuchillo", 0.5]]));
    const { levels } = await (await translate("knife", "source=en&target=es&dict=1")).json();
    expect(levels.cuchillo).toBeDefined();
    expect(levels.naja).toBeUndefined();
  });
});

// The gate decides what is forwarded; these two are what the route does with what it
// forwarded, and with what came back.
describe("GET /api/translate/[word] output", () => {
  const urlOf = (f: ReturnType<typeof vi.fn>) => new URL(String(f.mock.calls[0]![0]));

  // Google failing is not this app failing. hostile-input.test.ts sweeps for 5xx with a
  // healthy upstream, so nothing else here looks at an unhealthy one.
  // @spec GATE-6
  it("answers 502 when the upstream call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect((await translate("water", "source=en&target=es")).status).toBe(502);
  });

  // @spec GATE-7
  it("lowercases the word, for a stable answer and a warmer cache", async () => {
    const upstream = mockGtx("agua", "noun", [["agua", 0.6]]);
    vi.stubGlobal("fetch", upstream);
    const res = await translate("Water", "source=en&target=es");
    expect(urlOf(upstream).searchParams.get("q")).toBe("water");
    expect((await res.json()).word).toBe("water");
  });

  // dt=bd is casing-sensitive — "Essen" is food, "essen" is to eat — so the casing is
  // the question being asked.
  // @spec GATE-7
  it("keeps the casing when asking for the dictionary block", async () => {
    const upstream = mockGtx("food", "noun", [["food", 0.6]]);
    vi.stubGlobal("fetch", upstream);
    const res = await translate("Essen", "source=de&target=en&dict=1");
    expect(urlOf(upstream).searchParams.get("q")).toBe("Essen");
    expect((await res.json()).word).toBe("Essen");
  });
});

describe("GET /api/band/[view]/[key]", () => {
  it("returns a band's words in frequency order", async () => {
    const res = await bandGET(req("/api/band/x/x"), { params: promise({ view: "cefr", key: "A1" }) });
    expect(res.status).toBe(200);
    const band = await res.json();
    expect(band.key).toBe("A1");
    expect(band.words.length).toBe(1000);
  });

  // @spec ROUTE-9
  it("404s for an unknown band or view", async () => {
    const bad = await bandGET(req("/api/band/x/x"), { params: promise({ view: "cefr", key: "Z9" }) });
    expect(bad.status).toBe(404);
    const badView = await bandGET(req("/api/band/x/x"), { params: promise({ view: "nope", key: "A1" }) });
    expect(badView.status).toBe(404);
  });
});

describe("GET /api/wiktionary/[word]", () => {
  const ask = (word: string, query: string) =>
    wiktionaryGET(req(`/api/wiktionary/x?${query}`), { params: promise({ word }) });

  // @spec WIKT-1, BAND-9
  it("answers Wiktionary's terms with their levels in the target language", async () => {
    const res = await ask("siesta", "source=es&target=de");
    expect(res.status).toBe(200);
    const { terms, title, levels } = await res.json();
    expect(terms).toEqual(expect.arrayContaining(["Siesta", "Nickerchen"]));
    expect(title).toBe("siesta");
    expect(levels.Nickerchen).toMatchObject({ rank: expect.any(Number) });
  });

  // @spec WIKT-5
  it("answers from committed data, calling no one", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await ask("Wasser", "source=de&target=es");
    expect((await res.json()).terms).toContain("agua");
    expect(spy).not.toHaveBeenCalled();
  });

  // @spec ROUTE-8
  it("lowercases the param, and links the page the way Wiktionary titles it", async () => {
    const { terms, title } = await (await ask("WASSER", "source=de&target=es")).json();
    expect(terms).toContain("agua");
    expect(title).toBe("Wasser");
  });

  it("answers no terms for a pair or a word it has none for", async () => {
    for (const [word, query] of [
      ["siesta", "source=es&target=en"],
      [MISSING, "source=es&target=de"],
      ["siesta", "source=es&target=__proto__"],
    ] as const) {
      const res = await ask(word, query);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ terms: [], title: null, levels: {} });
    }
  });

  // @spec ROUTE-9
  it("404s for an unknown source language", async () => {
    expect((await ask("siesta", "source=xx&target=de")).status).toBe(404);
  });
});
