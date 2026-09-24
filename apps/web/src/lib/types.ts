// Shared API shapes — importable from both server (lib/bands) and client.

/**
 * Which way to split the vocabulary into bands. `freq` and `cefr` are rank windows and
 * every language has them; `defining` is a property of the word rather than of its rank,
 * and only a language with a dictionary graph behind it offers it (`viewsFor`).
 */
export type BandView = "freq" | "cefr" | "defining";

/** A band a word belongs to, as shown on the word card and browser tabs. */
export interface BandRef {
  key: string;
  label: string;
}

/** Where a word sits in a language: its CEFR band, and the rank that put it there. */
export interface WordLevel extends BandRef {
  /** 1-based frequency rank (1 = most frequent). */
  rank: number;
}

/** A single word's placement: its frequency rank and both band labelings. */
export interface WordBands {
  word: string;
  /**
   * Casings to translate. Usually just `[word]`; a case-homograph (German "Essen" the
   * noun vs "essen" the verb) carries both casings, most frequent first, so the card
   * can show a translation for each.
   */
  forms: string[];
  /** 1-based frequency rank (1 = most frequent). */
  rank: number;
  freq: BandRef;
  cefr: BandRef;
  /** Absent for a language with no defining levels. */
  defining?: BandRef;
  /**
   * The inflected form asked for, when the answer is its base word — "branched" on the
   * card for "branch". Absent when the word was found as typed, so its presence is what
   * says a redirect happened and the card should say so rather than swap words silently.
   */
  from?: string;
}

/** One band with its size — the browser's tabs/rail for a view. */
export interface BandSummary {
  key: string;
  label: string;
  /** Spelled out, where the visible label is an abbreviation ("D1"). Absent otherwise. */
  name?: string;
  /** Number of words in the band. */
  count: number;
}

/** A band's word list, in frequency order (most frequent first). */
export interface Band {
  key: string;
  label: string;
  words: string[];
}
