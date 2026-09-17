import "server-only";
import type { Band, BandSummary, BandView, WordBands, WordLevel } from "@/lib/types";
import type { SourceLang } from "@/lib/languages";
// The per-language word-bands artifacts (built by scripts/build-bands.ts). Imported
// directly so Next bundles them into the API functions — each file is small.
import en from "../../data/word-bands.en.json";
import es from "../../data/word-bands.es.json";
import fr from "../../data/word-bands.fr.json";
import de from "../../data/word-bands.de.json";
import pt from "../../data/word-bands.pt.json";
// The defining levels, each keyed positionally against its language's `ranked`. Built outside
// this repo from a Wiktionary extract; see the defining-vocabulary spike.
import definingPt from "../../data/defining.pt.json";
import definingIt from "../../data/defining.it.json";
import it from "../../data/word-bands.it.json";

export { isSourceLang } from "@/lib/languages";

interface BandDef {
  key: string;
  label: string;
  /** Inclusive 1-based rank range; `max: null` = open-ended top band. */
  min: number;
  max: number | null;
}

/**
 * D1-D7 plus the words the dictionary graph never placed. Unlike `freq` and `cefr` this is
 * not a rank window — a level is a property of the word, so a band here is a set. D1 is the
 * core the dictionary explains everything else with; D7 is never used to define anything.
 * `none` is not a level, it is the absence of one, and it is a third of the list.
 */
const DEFINING_BANDS: { key: string; label: string }[] = [
  { key: "D1", label: "D1" },
  { key: "D2", label: "D2" },
  { key: "D3", label: "D3" },
  { key: "D4", label: "D4" },
  { key: "D5", label: "D5" },
  { key: "D6", label: "D6" },
  { key: "D7", label: "D7" },
  { key: "none", label: "No level" },
];
const DEFINING_BY_KEY = new Map(DEFINING_BANDS.map((b) => [b.key, b]));
const definingKey = (c: string) => (c === "-" ? "none" : `D${c}`);

interface DefiningData {
  /** One char per ranked word: "1"-"7" for D1-D7, "-" for a word with no level. */
  levels: string;
  /** Band key -> `ranked` indices, frequency order. */
  byKey: Map<string, number[]>;
}

/**
 * A rebuild of `word-bands.pt.json` that changed the ranking would slide every level onto
 * the wrong word, silently. The length is the free half of the guard and runs here;
 * `artifacts.test.ts` carries the digest, which is the half that actually proves identity.
 */
function loadDefining(ranked: string[], raw: { count: number; levels: string }): DefiningData {
  if (raw.count !== ranked.length || raw.levels.length !== ranked.length) {
    throw new Error(`defining artifact holds ${raw.count} words against ${ranked.length} ranked`);
  }
  const byKey = new Map<string, number[]>();
  // Filled in frequency order, so each band's words come out ranked without a sort.
  ranked.forEach((_, i) => {
    const k = definingKey(raw.levels[i]!);
    const b = byKey.get(k);
    if (b) b.push(i);
    else byKey.set(k, [i]);
  });
  return { levels: raw.levels, byKey };
}

interface LangData {
  ranked: string[];
  freqBands: BandDef[];
  cefrBands: BandDef[];
  /** lowercased word -> 1-based frequency rank, built once per process. */
  rankOf: Map<string, number>;
  /** lowercased key -> both casings of a case-homograph ("essen" -> ["Essen","essen"]). */
  variants: Record<string, string[]>;
  /** 1- and 2-char prefix, lowercased and folded -> `ranked` indices, frequency order. */
  byPrefix: Map<string, number[]>;
  /** Defining levels, or null for a language that has none. */
  defining: DefiningData | null;
}

// Takes the diacritics off: "córdoba" -> "cordoba".
const fold = (s: string) => (/\P{ASCII}/u.test(s) ? s.normalize("NFD").replace(/\p{M}/gu, "") : s);

// `ranked` may carry display casing (e.g. German "Wasser"); lookups key on lowercase.
function load(
  data: {
    ranked: string[];
    variants?: Record<string, string[]>;
    freqBands: BandDef[];
    cefrBands: BandDef[];
  },
  defining?: { count: number; levels: string },
): LangData {
  const rankOf = new Map<string, number>();
  const byPrefix = new Map<string, number[]>();
  const bucket = (key: string, i: number) => {
    const b = byPrefix.get(key);
    if (b) b.push(i);
    else byPrefix.set(key, [i]);
  };
  data.ranked.forEach((w, i) => {
    const l = w.toLowerCase();
    rankOf.set(l, i + 1);
    const key = fold(l.slice(0, 2));
    // Filled in frequency order, so a bucket already ranks its own candidates.
    bucket(key.slice(0, 1), i);
    if (key.length > 1) bucket(key, i);
  });
  return {
    ranked: data.ranked,
    freqBands: data.freqBands,
    cefrBands: data.cefrBands,
    rankOf,
    variants: data.variants ?? {},
    byPrefix,
    defining: defining ? loadDefining(data.ranked, defining) : null,
  };
}

const REGISTRY: Record<SourceLang, LangData> = {
  en: load(en),
  es: load(es),
  fr: load(fr),
  de: load(de),
  pt: load(pt, definingPt),
  it: load(it, definingIt),
};

// Rank-window views only. Every `defining` caller branches before reaching this.
const defsFor = (d: LangData, view: BandView) => (view === "cefr" ? d.cefrBands : d.freqBands);
const bandAtRank = (defs: BandDef[], rank: number) =>
  defs.find((b) => rank >= b.min && (b.max === null || rank <= b.max));
const lastRank = (d: LangData, b: BandDef) =>
  b.max === null ? d.ranked.length : Math.min(b.max, d.ranked.length);

export function isView(v: string): v is BandView {
  return v === "freq" || v === "cefr" || v === "defining";
}

/**
 * The views a language actually offers. `defining` needs a dictionary graph behind it, which
 * only some languages have.
 * @spec BAND-11
 */
export function viewsFor(source: SourceLang): BandView[] {
  return REGISTRY[source].defining ? ["freq", "cefr", "defining"] : ["freq", "cefr"];
}

// @spec BAND-3, BAND-5, BAND-6
export function getWord(source: SourceLang, word: string): WordBands | null {
  const d = REGISTRY[source];
  const rank = d.rankOf.get(word.toLowerCase());
  if (rank === undefined) return null;
  const freq = bandAtRank(d.freqBands, rank)!;
  const cefr = bandAtRank(d.cefrBands, rank)!;
  const display = d.ranked[rank - 1]!;
  return {
    // Show the corpus's display casing ("Wasser"), not the caller's lowercased query.
    word: display,
    // Case-homographs carry both casings so the card can translate each; else just the word.
    forms: d.variants[display.toLowerCase()] ?? [display],
    rank,
    freq: { key: freq.key, label: freq.label },
    cefr: { key: cefr.key, label: cefr.label },
    // Every word in a language that has levels lands in a band, `none` included, so the
    // browser always has a tab to open. Absent entirely where the language has none.
    ...(d.defining ? { defining: { ...DEFINING_BY_KEY.get(definingKey(d.defining.levels[rank - 1]!))! } } : {}),
  };
}

// The form -> base word maps, one per language. Imported dynamically rather than with the
// artifacts above: together they are several times their size, and they are read only when
// an exact lookup has already missed. A static import would parse all six at module load,
// on every route, to answer a question most requests never ask. The specifiers are literal
// so the bundler still traces each file into the deployment.
const FORMS: Record<SourceLang, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import("../../data/forms.en.json"),
  es: () => import("../../data/forms.es.json"),
  fr: () => import("../../data/forms.fr.json"),
  de: () => import("../../data/forms.de.json"),
  pt: () => import("../../data/forms.pt.json"),
  it: () => import("../../data/forms.it.json"),
};
const formsCache = new Map<SourceLang, Map<string, string>>();

/**
 * The indexed word an inflected form belongs to, or null. The build merges every
 * inflection onto its lemma, so "branched" and "jede" are not entries of their own though
 * the build knew all along that they are "branch" and "jeder".
 * @spec FORM-4
 */
export async function resolveForm(source: SourceLang, word: string): Promise<string | null> {
  let map = formsCache.get(source);
  if (!map) {
    // A Map, not the parsed object it arrives as: this is the one lookup keyed directly
    // on caller input, and a plain object answers "__proto__" and "constructor" with
    // inherited members that the caller would then take for a word.
    map = new Map(Object.entries((await FORMS[source]()).default));
    formsCache.set(source, map);
  }
  return map.get(word.toLowerCase()) ?? null;
}

/**
 * A word's CEFR placement, keyed case-insensitively — what the word card's level badges
 * show. This is the one lookup taken against the *target* language, so the caller checks
 * `isSourceLang` first — only the six indexed languages have levels. Unlike `getWord` it
 * is asked about a translated term, which is often a phrase or a word the language doesn't
 * have; a miss is ordinary, and simply goes unbadged.
 * @spec BAND-7, BAND-8
 */
export function getLevel(target: SourceLang, word: string): WordLevel | null {
  const d = REGISTRY[target];
  const rank = d.rankOf.get(word.toLowerCase());
  if (rank === undefined) return null;
  const b = bandAtRank(d.cefrBands, rank)!;
  return { key: b.key, label: b.label, rank };
}

/**
 * Everything the defining figure plots: the level of every ranked word, and the words
 * themselves so a point can name itself. Null where the language has no levels.
 *
 * This is the one place the whole ranking goes to the client — about 165KB gzipped — so it
 * is served on its own route and fetched only when the defining view is opened.
 * @spec BAND-13
 */
export function getDefiningPoints(source: SourceLang): { levels: string; words: string[] } | null {
  const d = REGISTRY[source];
  return d.defining ? { levels: d.defining.levels, words: d.ranked } : null;
}

/**
 * Every band of a view with its word count — the browser's tabs. Empty for a view the
 * language does not offer, which is what the routes 404 on.
 * @spec BAND-4, BAND-12
 */
export function getBandSummary(source: SourceLang, view: BandView): BandSummary[] {
  const d = REGISTRY[source];
  if (view === "defining") {
    const def = d.defining;
    if (!def) return [];
    return DEFINING_BANDS.map((b) => ({
      key: b.key,
      label: b.label,
      count: def.byKey.get(b.key)?.length ?? 0,
    })).filter((b) => b.count > 0);
  }
  return defsFor(d, view).map((b) => ({
    key: b.key,
    label: b.label,
    count: Math.max(0, lastRank(d, b) - b.min + 1),
  }));
}

/** One band's words, in frequency order. */
export function getBand(source: SourceLang, view: BandView, key: string): Band | null {
  const d = REGISTRY[source];
  if (view === "defining") {
    const idx = d.defining?.byKey.get(key);
    const def = DEFINING_BY_KEY.get(key);
    if (!idx || !def) return null;
    return { key: def.key, label: def.label, words: idx.map((i) => d.ranked[i]!) };
  }
  const b = defsFor(d, view).find((x) => x.key === key);
  if (!b) return null;
  return { key: b.key, label: b.label, words: d.ranked.slice(b.min - 1, lastRank(d, b)) };
}

// A letter typed without a diacritic also matches it with one; a typed diacritic must match.
function matchesPrefix(word: string, prefix: string): boolean {
  if (word.length < prefix.length) return false;
  for (let k = 0; k < prefix.length; k++) {
    if (prefix[k] !== word[k] && prefix[k] !== fold(word[k]!)) return false;
  }
  return true;
}

/**
 * Words starting with `prefix`, most frequent first, for typeahead. An exact match
 * leads, ahead of frequency: commoner words sharing the prefix would otherwise crowd
 * it past `limit` — "ban" trails bank, band, bang, banana, bandit and banker — and
 * the search box reads the head of this list to decide whether what was typed is
 * itself a word, and so worth looking up unasked.
 * @spec BAND-10, BAND-14
 */
export function getSuggestions(source: SourceLang, prefix: string, limit = 8): string[] {
  // Composed, so a typed diacritic is one letter, as it is in the lists.
  const p = prefix.trim().toLowerCase().normalize("NFC");
  if (!p) return [];
  const d = REGISTRY[source];
  // Every candidate shares the query's first two characters once folded, so one bucket
  // holds them all: a miss costs a failed lookup, and a hit never walks the rest of the list.
  const candidates = d.byPrefix.get(fold(p.slice(0, 2)));
  if (!candidates) return [];
  const exact = d.rankOf.get(p);
  const out: string[] = exact === undefined ? [] : [d.ranked[exact - 1]!];
  for (const i of candidates) {
    const word = d.ranked[i]!;
    const l = word.toLowerCase();
    if (l !== p && matchesPrefix(l, p)) {
      out.push(word);
      if (out.length >= limit) break;
    }
  }
  return out;
}
