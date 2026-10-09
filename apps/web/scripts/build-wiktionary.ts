// Build the Wiktionary translation artifacts the word card shows beside Google's. For each
// pair of indexed languages and each direction, every word of the source list that the
// two languages' own Wiktionaries translate into the target, with at most four terms.
// One artifact per direction, `data/wiktionary.<source>-<target>.json`.
//
// Both editions are read. The source edition's entry for a word lists its translations;
// the target edition's entries list theirs back, and inverting those finds the target words
// whose translations include it. Neither goes through English, which is the point.
//
//   tsx scripts/build-wiktionary.ts
//
// Inputs: `data/wiktextract-<code>.jsonl.gz`, Wiktextract's extract of that language's own
// edition, from kaikki.org — the files the defining-vocabulary repo already downloads.
// Wiktionary's text is CC BY-SA 4.0. CLAUDE.md holds the measurements behind the choices.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => resolve(here, "../data", f);

// Each pair is built in both directions.
const PAIRS: [string, string][] = [["es", "de"]];

// The card's line holds four terms, as Google's does.
const MAX_TERMS = 4;
// Past two words a translation is an explanation or a proverb rather than a term.
const MAX_WORDS = 2;

const ARTICLE: Record<string, RegExp> = {
  es: /^(?:el|la|los|las|un|una|unos|unas)\s+(?=\S)/i,
  de: /^(?:der|die|das|ein|eine)\s+(?=\S)/i,
};

/** The terms one translation string holds: notes stripped, variants split, phrases dropped. */
function termsOf(raw: string, lang: string): string[] {
  const bare = raw.replace(/\([^()]*\)|\[[^\]]*\]/g, " ");
  if (/[()[\]]/.test(bare)) return [];
  const out: string[] = [];
  for (const piece of bare.split(/[,;/]/)) {
    const term = piece
      .replace(/^[\s¡¿!?.]+|[\s¡¿!?.]+$/g, "")
      .replace(/\s+/g, " ")
      .replace(ARTICLE[lang] ?? /$^/, "");
    if (!term || /\d/.test(term) || term.split(" ").length > MAX_WORDS) continue;
    out.push(term);
  }
  return out;
}

interface Edition {
  /** Headword -> its translation terms into the other language. */
  translations: Map<string, string[]>;
  /** Every page title holding an entry in the edition's own language. */
  heads: Set<string>;
}

/** One edition's entries in `lang`, with their translations into `other`. */
async function harvest(lang: string, other: string): Promise<Edition> {
  const translations = new Map<string, string[]>();
  const heads = new Set<string>();
  const lines = createInterface({ input: createReadStream(data(`wiktextract-${lang}.jsonl.gz`)).pipe(createGunzip()) });
  for await (const line of lines) {
    const e = JSON.parse(line) as {
      word?: string;
      lang_code?: string;
      translations?: { word?: string; lang_code?: string }[];
    };
    if (e.lang_code !== lang || !e.word?.trim()) continue;
    const head = e.word.trim();
    heads.add(head);
    for (const t of e.translations ?? []) {
      if (t.lang_code !== other || !t.word) continue;
      const terms = translations.get(head) ?? [];
      for (const term of termsOf(t.word, other)) if (!terms.includes(term)) terms.push(term);
      if (terms.length) translations.set(head, terms);
    }
  }
  return { translations, heads };
}

function ranked(lang: string): string[] {
  return (JSON.parse(readFileSync(data(`word-bands.${lang}.json`), "utf8")) as { ranked: string[] }).ranked;
}

interface Artifact {
  source: string;
  target: string;
  /** A source word, lowercased, -> its terms in the target language. */
  terms: Record<string, string[]>;
  /** A word's page title where it is not the word as the list displays it; null where it has none. */
  titles: Record<string, string | null>;
}

interface Candidate {
  term: string;
  editions: Set<"source" | "target">;
  seen: number;
}

/**
 * One direction. A term both editions give comes first, since two sets of editors reached
 * it separately; then the more frequent in the target language; then the order it was met.
 */
function build(source: string, target: string, own: Edition, other: Edition): Artifact {
  const words = ranked(source);
  const known = new Set(words.map((w) => w.toLowerCase()));
  const rank = new Map(ranked(target).map((w, i) => [w.toLowerCase(), i + 1]));
  const found = new Map<string, Map<string, Candidate>>();
  let seen = 0;
  const add = (word: string, term: string, edition: "source" | "target") => {
    const key = word.toLowerCase();
    if (!known.has(key)) return;
    const terms = found.get(key) ?? new Map<string, Candidate>();
    const c = terms.get(term.toLowerCase()) ?? { term, editions: new Set(), seen: seen++ };
    c.editions.add(edition);
    terms.set(term.toLowerCase(), c);
    found.set(key, terms);
  };
  for (const [head, terms] of own.translations) for (const term of terms) add(head, term, "source");
  for (const [head, terms] of other.translations) {
    // The target edition's headword becomes the term, so it passes the same cleaning.
    const [term, ...more] = termsOf(head, target);
    if (!term || more.length) continue;
    for (const word of terms) add(word, term, "target");
  }
  const anyCasing = new Map<string, string>();
  for (const head of own.heads) if (!anyCasing.has(head.toLowerCase())) anyCasing.set(head.toLowerCase(), head);
  const terms: Record<string, string[]> = {};
  const titles: Record<string, string | null> = {};
  for (const w of words) {
    const key = w.toLowerCase();
    const candidates = found.get(key);
    if (!candidates) continue;
    // The page the line links to: the entry its terms came from, where one did.
    const casings = [w, key, anyCasing.get(key)].filter((t): t is string => t !== undefined);
    const title = casings.find((t) => own.translations.has(t)) ?? casings.find((t) => own.heads.has(t)) ?? null;
    if (title !== w) titles[key] = title;
    terms[key] = [...candidates.values()]
      .sort(
        (a, b) =>
          b.editions.size - a.editions.size ||
          (rank.get(a.term.toLowerCase()) ?? Infinity) - (rank.get(b.term.toLowerCase()) ?? Infinity) ||
          a.seen - b.seen,
      )
      .slice(0, MAX_TERMS)
      .map((c) => c.term);
  }
  return { source, target, terms, titles };
}

function report({ source, target, terms }: Artifact) {
  const a = JSON.parse(readFileSync(data(`word-bands.${source}.json`), "utf8")) as {
    ranked: string[];
    cefrBands: { key: string; min: number; max: number | null }[];
  };
  const cover = a.cefrBands
    .map((b) => {
      const band = a.ranked.slice(b.min - 1, b.max ?? a.ranked.length);
      if (!band.length) return null;
      const n = band.filter((w) => terms[w.toLowerCase()]).length;
      return `${b.key} ${Math.round((100 * n) / band.length)}%`;
    })
    .filter(Boolean)
    .join(", ");
  console.log(`wiktionary.${source}-${target}.json  ${Object.keys(terms).length.toLocaleString("en-US")} words  ${cover}`);
}

async function main() {
  for (const [a, b] of PAIRS) {
    const [ea, eb] = await Promise.all([harvest(a, b), harvest(b, a)]);
    for (const [source, target, own, other] of [
      [a, b, ea, eb],
      [b, a, eb, ea],
    ] as const) {
      const artifact = build(source, target, own, other);
      writeFileSync(data(`wiktionary.${source}-${target}.json`), JSON.stringify(artifact));
      report(artifact);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
