// The source languages whose vocabulary the app bands — the axis a learner picks from.
// Distinct from the target language, which a word is translated into on the word card.
// Shared by the server (lib/bands) and the client UI.

export const SOURCE_LANGS = ["en", "es", "fr", "de", "pt", "it"] as const;
export type SourceLang = (typeof SOURCE_LANGS)[number];

/**
 * The language a word is translated into. Anything Google translates to, not only the
 * six we index, so it stays a plain code — `isSourceLang` is what asks whether this
 * one also has a word list behind it (CEFR levels on the translation, and the swap).
 */
export type TargetLang = string;

export const DEFAULT_SOURCE: SourceLang = "en";

/**
 * Languages that carry defining levels, so `view=defining` is offered for them, and how many
 * levels each one's dictionary peels into. `bands` answers from the loaded artifact instead;
 * `bands.test.ts` proves the two agree.
 * @spec BAND-11, BAND-15
 */
export const DEFINING_LEVEL_COUNT: Partial<Record<SourceLang, number>> = {
  pt: 7,
  it: 7,
  fr: 14,
  es: 11,
  de: 5,
};

export const DEFINING_LANGS = Object.keys(DEFINING_LEVEL_COUNT) as readonly SourceLang[];

export const hasDefining = (l: SourceLang) => DEFINING_LANGS.includes(l);

/** A word's defining level from its one-character code: a base-36 digit, or "-" for none. */
export const definingLevel = (c: string): number | null => (c === "-" ? null : parseInt(c, 36));

/** An A1 word at the bottom level of each language with defining levels, named by the caption. */
export const DEFINING_EXAMPLE: Partial<Record<SourceLang, string>> = {
  pt: "olá",
  it: "ciao",
  fr: "allô",
  es: "hola",
  de: "hallo",
};

export function isSourceLang(v: string): v is SourceLang {
  return (SOURCE_LANGS as readonly string[]).includes(v);
}

export interface SourceLangMeta {
  /** Name in the language's own tongue, for the picker. */
  name: string;
  /** Word looked up when this language is first selected. */
  defaultWord: string;
  /** Where its frequency ranking comes from, credited beneath the browser. */
  corpus: { name: string; url: string };
}

const SUBTLEX_US = {
  name: "SUBTLEX-US",
  url: "https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus",
};
// OpenSubtitles-derived frequency lists (hermitdave/FrequencyWords, 2018).
const opensubs = (path: string) => ({
  name: "OpenSubtitles frequencies",
  url: `https://github.com/hermitdave/FrequencyWords/tree/master/content/2018/${path}`,
});

export const SOURCE_LANG_META: Record<SourceLang, SourceLangMeta> = {
  en: { name: "English", defaultWord: "water", corpus: SUBTLEX_US },
  es: { name: "Español", defaultWord: "agua", corpus: opensubs("es") },
  fr: { name: "Français", defaultWord: "eau", corpus: opensubs("fr") },
  de: { name: "Deutsch", defaultWord: "wasser", corpus: opensubs("de") },
  pt: { name: "Português", defaultWord: "água", corpus: opensubs("pt") },
  it: { name: "Italiano", defaultWord: "acqua", corpus: opensubs("it") },
};

// The Nuovo De Mauro keys its pages without diacritics: "caffè" is /parola/caffe.
const bare = (w: string) => w.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Each language's etymology, in a dictionary written in that language, keyed the way that
 * dictionary looks a word up.
 * @spec ETYM-2, ETYM-3
 */
const ETYMOLOGY: Record<SourceLang, (word: string) => string> = {
  en: (w) => `https://www.etymonline.com/word/${encodeURIComponent(w)}`,
  // The entry, not Pfeifer's own page: a compound he lacks still shows its parts there.
  de: (w) => `https://www.dwds.de/wb/${encodeURIComponent(w)}#etymwb-1`,
  fr: (w) => `https://www.cnrtl.fr/etymologie/${encodeURIComponent(w)}`,
  es: (w) => `https://dle.rae.es/${encodeURIComponent(w.toLowerCase())}`,
  it: (w) => `https://dizionario.internazionale.it/parola/${encodeURIComponent(bare(w))}`,
  pt: (w) => `https://dicionario.priberam.org/${encodeURIComponent(w)}`,
};

export const etymologyHref = (word: string, source: SourceLang) => ETYMOLOGY[source](word);

/**
 * The languages Wiktionary's translations are built between, each into every other. `bands`
 * loads one artifact per direction; `bands.test.ts` proves the two agree.
 * @spec WIKT-1
 */
export const WIKTIONARY_LANGS: readonly SourceLang[] = ["es", "de", "fr", "it", "pt"];

export const hasWiktionary = (source: SourceLang, target: TargetLang) =>
  source !== target &&
  WIKTIONARY_LANGS.includes(source) &&
  (WIKTIONARY_LANGS as readonly string[]).includes(target);

/** A page of the source language's own Wiktionary. Titles are case-sensitive there. */
export const wiktionaryHref = (title: string, source: SourceLang) =>
  `https://${source}.wiktionary.org/wiki/${encodeURIComponent(title)}`;

/**
 * A language named in English, for the app's English prose. `SOURCE_LANG_META.name` is
 * the endonym instead, which is what the picker shows.
 */
export function englishName(code: string): string {
  const fallback = isSourceLang(code) ? SOURCE_LANG_META[code].name : code;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}
