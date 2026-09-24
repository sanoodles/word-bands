// Build the per-language word-bands artifacts backing the app: for each source
// language, a pure-frequency, lemma-merged word ranking plus the frequency- and
// CEFR-band definitions the UI browses by. One artifact per language,
// `data/word-bands.<code>.json`, all sharing the same band thresholds.
//
// One scalable data source per language — a subtitle word-frequency list — with a
// lemmatization list to merge inflections onto their base form (go/goes/going/went
// -> "go"). Frequency ordering is the whole signal (it dominates AoA and the
// definition graph for learn-order; we measured it on English). CEFR bands are
// frequency-rank thresholds calibrated once against the CEFR-J Wordlist, English (median
// rank per level: A1≈635, A2≈2275, B1≈4692, B2≈8394) and baked in below — an
// English-derived heuristic reused for every language, with no CEFR list needed at build
// time. The version used at calibration time was not recorded; CLAUDE.md holds the
// re-verification and the measured agreement.
//
//   tsx scripts/build-bands.ts [lang]   # one language, or all when omitted
//
// Sources. Frequency: en = SUBTLEX-US (Brysbaert & New 2009); es/fr/de/pt/it =
// OpenSubtitles frequency lists (hermitdave/FrequencyWords, 2018). Lemmatization lists
// from github.com/michmech/lemmatization-lists. Display casing from the Leipzig Corpora
// sentences files. The name gazetteer from github.com/smashew/NameDatabases. German's
// spell check from LibreOffice/dictionaries (igerman98). CLAUDE.md tabulates which file
// each language takes, and what is not recorded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => resolve(here, "../data", f);

interface BandDef {
  key: string;
  label: string;
  /** Inclusive 1-based rank range; `max: null` = open-ended top band. */
  min: number;
  max: number | null;
}

// Frequency view: rank bands, the standard vocabulary-pedagogy "K-bands".
const FREQ_BANDS: BandDef[] = [
  { key: "1", label: "Top 1,000", min: 1, max: 1000 },
  { key: "2", label: "1,001–2,000", min: 1001, max: 2000 },
  { key: "3", label: "2,001–3,000", min: 2001, max: 3000 },
  { key: "4", label: "3,001–5,000", min: 3001, max: 5000 },
  { key: "5", label: "5,001–10,000", min: 5001, max: 10000 },
  { key: "6", label: "10,001+", min: 10001, max: null },
];

// CEFR view: rank thresholds calibrated to CEFR-J medians; C1/C2 extrapolate the
// same frequency trend past CEFR-J's B2 cap. Each top roughly doubles the last
// (1k, 3k, 6k, 12k, 25k, 50k), so C2 ends where the trend says it ends rather than
// swallowing the rest of the list.
//
// `rare` is the open-ended last band, which is what lets `getWord` assert a band exists
// at every rank. German reaches it: the morphology vouch buys back ~18k compounds the
// lemma list never held, and the list runs past 50k. The other five stop inside C2,
// because `dictGate` removes their junk tail at its source rather than banding it. Bands
// with no words are filtered per language, so an unreached `rare` renders no empty tab.
// @spec BAND-1, BAND-2
const CEFR_BANDS: BandDef[] = [
  { key: "A1", label: "A1 · Beginner", min: 1, max: 1000 },
  { key: "A2", label: "A2 · Elementary", min: 1001, max: 3000 },
  { key: "B1", label: "B1 · Intermediate", min: 3001, max: 6000 },
  { key: "B2", label: "B2 · Upper-intermediate", min: 6001, max: 12000 },
  { key: "C1", label: "C1 · Advanced", min: 12001, max: 25000 },
  { key: "C2", label: "C2 · Proficiency", min: 25001, max: 50000 },
  { key: "rare", label: "Rare · beyond C2", min: 50001, max: null },
];

// Where the subtitle tail stops being vocabulary and the lemma list takes over as the
// arbiter (see `dictGate`). Chosen from measured dictionary coverage, which runs ~45%
// at 12k–25k and then halves to 26% by 40k. It lands the five subtitle languages at
// 33–40k words each, about where English's curated SUBTLEX ends on its own.
// @spec FILTER-4
const DICT_GATE = 25000;

// The frequency floor for the OpenSubtitles lists, where below ~10 occurrences the tail
// is mostly hapax noise. Stated in occurrences rather than rank so it means the same in
// every language — which is also why it is one constant and not a per-language literal.
// English has no entry: its SUBTLEX column is per-million, not a raw count.
const MIN_COUNT = 10;

interface FreqSource {
  file: string;
  /** "csv" = comma-separated with a header row, columns by name;
   *  "list" = whitespace-separated `word count`, no header, columns by index. */
  format: "csv" | "list";
  wordCol: string | number;
  freqCol: string | number;
  /**
   * Drop surface forms occurring fewer than this many times, before lemma-merging.
   * The OpenSubtitles lists run to ~800k entries of which nearly half are hapax —
   * OCR debris, typos and foreign fragments — so the tail needs a floor. Set it in
   * raw occurrences, not rank, so the cut means the same thing in every language.
   * Omit where the column isn't a raw count (SUBTLEX's SUBTLWF is per-million).
   */
  minCount?: number;
}

interface LangConfig {
  code: string;
  freq: FreqSource;
  lemmaFile: string;
  /** Single-grapheme tokens that are real words in this language (else dropped as noise). */
  singleLetterOk: Set<string>;
  /** Multi-letter subtitle/contraction remnants this corpus lists as standalone "words". */
  fragments: Set<string>;
  /** Sample words for the build report (word -> rank spot-check). */
  spotChecks: string[];
  /**
   * Optional casing oracle: a case-preserving Leipzig Corpora *sentences* file
   * (`id<TAB>sentence`). We measure how often each word is capitalized *mid-sentence*
   * (ignoring sentence-initial position, which capitalizes everything) and capitalize
   * the word when that share clears a threshold. So German nouns/names ("Wasser",
   * "Berlin") and proper nouns in any language come out capitalized while verbs,
   * pronouns, and sentence-initial-heavy words ("wer", "doch") stay lowercase — no
   * per-language rules. Absent = output stays lowercase.
   */
  casingFile?: string;
  /** Determiners, for the name filter: a common noun follows one, a personal name rarely does. */
  determiners?: Set<string>;
  /**
   * Pronouns this language hyphenates onto a verb ("diz-me", "donne-moi"). Every
   * verb x pronoun pair spells a distinct surface form, none of which is vocabulary —
   * pt spends 24% of its list on them — so they merge back into the verb. Matched a
   * whole segment at a time, which is what spares real compounds: "guarda-chuva" ends
   * in "chuva", not in "a". Absent = the language doesn't do this.
   */
  clitics?: Set<string>;
  /** Verb endings that follow a mesoclitic pronoun ("contar-te-ia" = contar + te + ia). */
  mesoEndings?: Set<string>;
  /** Compounds ending in something spelled like a clitic, kept whole. */
  cliticExceptions?: Set<string>;
  /**
   * Rank past which the lemma list must know a word for it to stay. The subtitle
   * tail is not rare vocabulary — past 25k only ~14% of it is in the language's own
   * dictionary, the rest being character names, untranslated English, misspellings
   * ("gerer", "règler") and OCR debris ("lslam", "arrãªtez"). The frequency list can't
   * tell those from rare words, and neither can the name gazetteer, which has no entry
   * for "ryûji" or "rrr"; the dictionary can. Costs the real words michmech happens to
   * lack ("préventivement", "raticide"), which is the price of dropping ~9 in 10 junk.
   * Omitted for English, whose SUBTLEX source is curated and whose lemma list is the
   * smallest by far — gating it would cut 11k mostly-real words.
   */
  dictGate?: number;
  /**
   * Hunspell dictionary basename in `data/` (a `.dic` plus an `.aff`), consulted below
   * `DICT_GATE` — see `spellRejects`. Absent = the head of the list is not checked.
   * Several where one orthography is not the whole language: Portuguese needs both the
   * European and the Brazilian list, and English both en_US and en_GB, or the gate drops
   * one side's spellings wholesale.
   */
  spellDict?: string | string[];
  /**
   * Further spellings of a word to ask the checker about, as literal replacements. French
   * writes "coeur" where its dictionary holds "cœur", and the ligature is on no keyboard,
   * so without this the gate takes "oeil", "coeur" and "soeur" with it. Same trade as the
   * two casings: a word is refused only when none of the spellings the language writes it
   * in is a word.
   */
  spellVariants?: [string, string][];
  /**
   * Word-formation this language spells inside a single word, for `vouchMorphology`:
   * the linking morphemes a compound joins with, and the prefixes and suffixes a
   * derivation takes. Absent = past `dictGate` the lemma list is the only judge, which
   * is right for the Romance five, whose compounds are phrasal ("arc-en-ciel").
   */
  morphology?: {
    links: string[];
    prefixes: string[];
    suffixes: string[];
    /** Real parts shorter than `MORPH_MIN_PART`, which the splitter would otherwise refuse. */
    shortParts: Set<string>;
  };
}

const LANGS: Record<string, LangConfig> = {
  en: {
    code: "en",
    freq: { file: "subtlex.csv", format: "csv", wordCol: "Word", freqCol: "SUBTLWF" },
    lemmaFile: "lemma-en.txt",
    spellDict: ["en_US", "en_GB"],
    singleLetterOk: new Set(["a", "i"]),
    fragments: new Set(["re", "ll", "ve", "em", "im", "n", "st", "nd", "rd", "th"]),
    spotChecks: ["the", "be", "water", "government", "philosophy", "entropy", "photosynthesis"],
    casingFile: "casing-en.txt",
    determiners: new Set([
      "the", "a", "an", "this", "that", "these", "those",
      "my", "your", "his", "her", "its", "our", "their",
      "some", "any", "no", "every", "each", "another",
    ]),
  },
  es: {
    code: "es",
    freq: { file: "freq-es.txt", format: "list", wordCol: 0, freqCol: 1, minCount: MIN_COUNT },
    lemmaFile: "lemma-es.txt",
    dictGate: DICT_GATE,
    spellDict: "es_ES",
    singleLetterOk: new Set(["a", "y", "o", "e", "u"]),
    fragments: new Set(),
    spotChecks: ["de", "ser", "agua", "gobierno", "filosofía", "entropía"],
    casingFile: "casing-es.txt",
    determiners: new Set([
      "el", "la", "los", "las", "lo", "un", "una", "unos", "unas",
      "del", "al", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
      "mi", "tu", "su", "mis", "tus", "sus", "nuestro", "nuestra", "cada", "otro", "otra",
    ]),
  },
  fr: {
    code: "fr",
    freq: { file: "freq-fr.txt", format: "list", wordCol: 0, freqCol: 1, minCount: MIN_COUNT },
    lemmaFile: "lemma-fr.txt",
    dictGate: DICT_GATE,
    spellDict: "fr",
    spellVariants: [["oe", "œ"]],
    singleLetterOk: new Set(["à", "a", "y"]),
    fragments: new Set(["sync"]),
    spotChecks: ["de", "être", "eau", "gouvernement", "philosophie", "entropie"],
    casingFile: "casing-fr.txt",
    // Elided forms ("l'eau") tokenize as one word, so they can't precede — the
    // non-elided determiners carry the test.
    determiners: new Set([
      "le", "la", "les", "un", "une", "des", "du", "au", "aux",
      "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes",
      "son", "sa", "ses", "notre", "votre", "leur", "leurs", "chaque", "autre",
    ]),
    clitics: new Set([
      // Inverted subjects ("est-ce", "avez-vous"), with the euphonic t of "a-t-il".
      "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ce", "t",
      // Imperative objects ("donne-moi", "vas-y").
      "moi", "toi", "lui", "leur", "le", "la", "les", "en", "y",
    ]),
    // "là" and "ci" are deliberately absent: "celui-là" and "là-bas" are vocabulary.
    cliticExceptions: new Set(["rendez-vous", "garde-à-vous"]),
  },
  de: {
    code: "de",
    freq: { file: "freq-de.txt", format: "list", wordCol: 0, freqCol: 1, minCount: MIN_COUNT },
    lemmaFile: "lemma-de.txt",
    dictGate: DICT_GATE,
    spellDict: "de_DE_frami",
    morphology: {
      links: ["", "s", "es", "n", "en", "er", "e", "ns"],
      prefixes: ["ver", "be", "ent", "er", "zer", "ab", "an", "auf", "aus", "ein",
        "vor", "um", "über", "unter", "durch", "mit", "nach", "zu", "un", "miss"],
      suffixes: ["igkeit", "lichkeit", "heit", "keit", "ung", "schaft", "lich", "isch",
        "bar", "los", "haft", "tum", "nis", "ling", "chen", "lein", "erei", "ismus", "ität"],
      shortParts: new Set(["amt", "art", "bad", "bau", "end", "tag", "weg", "zug",
        "ton", "tor", "uhr", "ort"]),
    },
    singleLetterOk: new Set(),
    fragments: new Set(),
    spotChecks: ["ich", "sein", "wasser", "regierung", "philosophie", "entropie"],
    casingFile: "casing-de.txt",
    determiners: new Set([
      "der", "die", "das", "den", "dem", "des",
      "ein", "eine", "einen", "einem", "einer", "eines",
      "kein", "keine", "keinen", "keinem", "keiner",
      "mein", "dein", "sein", "ihr", "unser", "euer",
      "diese", "dieser", "dieses", "diesem", "diesen",
    ]),
  },
  pt: {
    code: "pt",
    freq: { file: "freq-pt.txt", format: "list", wordCol: 0, freqCol: 1, minCount: MIN_COUNT },
    lemmaFile: "lemma-pt.txt",
    dictGate: DICT_GATE,
    spellDict: ["pt_PT", "pt_BR"],
    singleLetterOk: new Set(["a", "o", "e", "é", "à", "á"]),
    fragments: new Set(["pt-subs", "pt-pt"]),
    spotChecks: ["que", "ser", "água", "governo", "filosofia", "entropia"],
    casingFile: "casing-pt.txt",
    determiners: new Set([
      "o", "a", "os", "as", "um", "uma", "uns", "umas",
      "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "à",
      "este", "esta", "esse", "essa", "aquele", "aquela",
      "meu", "minha", "seu", "sua", "nosso", "nossa", "cada", "outro", "outra",
    ]),
    clitics: new Set([
      "me", "te", "se", "lhe", "lhes", "nos", "vos",
      // Direct objects, plus the -lo/-no allomorphs taken after -r and after a nasal.
      "o", "a", "os", "as", "lo", "la", "los", "las", "no", "na", "nas",
      // Contracted indirect+direct pairs ("dá-mo" = dá + me + o).
      "mo", "ma", "mos", "mas", "to", "ta", "tos", "tas", "lho", "lha", "lhos", "lhas",
    ]),
    mesoEndings: new Set([
      "ei", "ás", "á", "emos", "eis", "ão",
      "ia", "ias", "íamos", "íeis", "iam",
    ]),
  },
  it: {
    code: "it",
    freq: { file: "freq-it.txt", format: "list", wordCol: 0, freqCol: 1, minCount: MIN_COUNT },
    lemmaFile: "lemma-it.txt",
    dictGate: DICT_GATE,
    spellDict: "it_IT",
    singleLetterOk: new Set(["a", "e", "è", "i", "o"]),
    fragments: new Set(["srt"]),
    spotChecks: ["di", "essere", "acqua", "società", "filosofia", "entropia"],
    casingFile: "casing-it.txt",
    determiners: new Set([
      "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
      "del", "dello", "della", "dei", "degli", "delle", "al", "alla", "nel", "nella",
      "questo", "questa", "questi", "queste", "quel", "quella",
      "mio", "mia", "tuo", "tua", "suo", "sua", "nostro", "ogni", "altro", "altra",
    ]),
  },
};

// A token must start and end with a letter (any script), allowing internal
// apostrophes/hyphens — so clitic remnants like French "l'"/"qu'" are rejected while
// "aujourd'hui" survives.
const WORD_OK = /^\p{L}([\p{L}'-]*\p{L})?$/u;

function makeClean(cfg: LangConfig) {
  return (w: string | undefined): string | null => {
    if (!w) return null;
    w = w.trim().toLowerCase();
    if (!WORD_OK.test(w) || cfg.fragments.has(w)) return null;
    if ([...w].length === 1 && !cfg.singleLetterOk.has(w)) return null;
    return w;
  };
}

/**
 * Strip hyphen-attached pronouns off a verb: "diz-me" -> "diz", "parte-se-me" -> "parte",
 * "a-t-il" -> "a". Portuguese mesoclisis wraps the pronoun inside the verb
 * ("contar-te-ia"), so a known verb ending trailing a clitic is stripped with it.
 * Returns null when there is nothing to strip — including every ordinary compound.
 * @spec FILTER-1, FILTER-2
 */
function declitic(w: string, cfg: LangConfig): string | null {
  if (!cfg.clitics || !w.includes("-") || cfg.cliticExceptions?.has(w)) return null;
  const p = w.split("-");
  let end = p.length;
  if (end === 3 && cfg.clitics.has(p[1]!) && cfg.mesoEndings?.has(p[2]!)) end = 1;
  else while (end > 1 && cfg.clitics.has(p[end - 1]!)) end--;
  return end === p.length ? null : p.slice(0, end).join("-");
}

// Portuguese drops the infinitive's -r before -lo/-la and accents the vowel
// ("fazer" + "o" -> "fazê-lo"), so the bare stem needs it back to be a word again.
const STEM_REPAIR: [RegExp, string][] = [[/á$/, "ar"], [/ê$/, "er"], [/ô$/, "or"]];

// --- Casing: lowercase key -> its capitalized display form (absent = stays lowercase).
//
// The core below is language-agnostic; a language supplies only data. Two signals
// combine:
//
//   1. Corpus (primary): mid-sentence capitalization share from a Leipzig sentences
//      file. We ignore each sentence's first token — sentence-initial position
//      capitalizes everything — so mid-sentence casing is the true signal. Wherever the
//      corpus has evidence it is decisive, which resolves case-homographs ("Essen" the
//      noun vs "essen" the verb, merged into one lemma) and captures proper nouns
//      (Berlin) with no per-language rules.
//   2. Dictionary (tail fallback): the michmech lemma list already carries each
//      language's own casing (German nouns capitalized, Romance all-lowercase). For the
//      rare tail the corpus barely sees, we trust it — but only when it is unambiguous
//      (a single, non-ALL-CAPS spelling), so verbs/nouns homographs still defer to the
//      corpus's frequency vote.
//
// Per language this is pure data: which corpus file (`casingFile`) plus the lemma list
// it already uses. One threshold serves all languages (proper nouns sit near 1.0;
// German nouns clear 0.7 too). Genuinely language-specific rules (e.g. Turkish dotless
// i) would slot in as a small hook here.
const CASING_MIN_SHARE = 0.7;
const CASING_MIN_COUNT = 5;
const CASING_TOKEN = /[^\W\d_]+(?:['’-][^\W\d_]+)*/gu;

// Case-homograph: a lemma whose two casings are genuinely both used (German "Essen"
// the noun vs "essen" the verb) — merged into one source entry, but worth translating
// in both casings. Flagged when the minority casing occurs enough mid-sentence to be
// real, not noise. The runtime backstops this: a casing whose translation adds nothing is
// dropped from the card, so a loose gate here only costs a wasted lookup.
const HOMOGRAPH_MIN_COUNT = 100;
const HOMOGRAPH_MIN_SHARE = 0.1;

// Personal names crowd subtitle corpora ("Ahmed", "Moretti", "Kendra") without being
// vocabulary. All three signals are needed: the dictionary spares surnames that are also
// words ("Koch", "Berg"), and mid-sentence casing spares lowercase function words that
// collide with short names ("in", "von", "man"). Only languages with a casing corpus can
// be filtered — without it the gazetteer would eat "que", "por", "he".
const NAMES_FILE = "names.txt";
// Above this rank a hit is far likelier to be a loanword noun missing from the lemma
// list ("Boss", "Sheriff") than a name, so leave the head alone.
// @spec FILTER-5
const NAME_RANK_FLOOR = 1000;
const NAME_CAP_SHARE = 0.9;
const NAME_MIN_OBS = 5;
// Rescue: michmech misses plenty of ordinary nouns ("Kuss", "Fass", "Geduld"), and many
// are surnames too. Taking a determiner this often marks a common noun, not a name.
const NAME_DET_SHARE = 0.1;

let namesCache: Set<string> | null = null;
const loadNames = () =>
  (namesCache ??= new Set(
    readFileSync(data(NAMES_FILE), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/^﻿/, "").trim().toLowerCase())
      .filter(Boolean),
  ));

const isAllCaps = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const isCapped = (w: string) => w[0] !== w[0]!.toLowerCase();
const topKey = (counts: Map<string, number>) =>
  [...counts].sort((a, b) => b[1] - a[1])[0]![0];

interface CorpusStat {
  tot: number;
  cap: number;
  /** occurrences directly after a determiner — a common noun takes them, a name doesn't */
  det: number;
  /** capitalized spelling -> count, to pick the dominant display form */
  forms: Map<string, number>;
}

function corpusCasing(file: string, determiners: Set<string>): Map<string, CorpusStat> {
  const stat = new Map<string, CorpusStat>();
  for (const line of readFileSync(data(file), "utf8").split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const toks = line.slice(tab + 1).match(CASING_TOKEN);
    if (!toks) continue;
    for (let i = 1; i < toks.length; i++) { // skip toks[0]: sentence-initial
      const w = toks[i]!;
      const key = w.toLowerCase();
      let s = stat.get(key);
      if (!s) stat.set(key, (s = { tot: 0, cap: 0, det: 0, forms: new Map() }));
      s.tot++;
      if (determiners.has(toks[i - 1]!.toLowerCase())) s.det++;
      if (isCapped(w) && !isAllCaps(w)) {
        s.cap++;
        s.forms.set(w, (s.forms.get(w) ?? 0) + 1);
      }
    }
  }
  return stat;
}

// The lemma list's own casings: lowercase key -> its (non-ALL-CAPS) spellings. German
// lists a capitalized spelling for nouns, so this is an authoritative "is there a noun
// with this spelling" signal.
function lemmaSpellings(lemmaFile: string): Map<string, Set<string>> {
  const spellings = new Map<string, Set<string>>();
  for (const line of readFileSync(data(lemmaFile), "utf8").split(/\r?\n/)) {
    const lemma = line.replace(/^﻿/, "").split("\t")[0];
    if (!lemma || isAllCaps(lemma)) continue;
    const key = lemma.toLowerCase();
    let s = spellings.get(key);
    if (!s) spellings.set(key, (s = new Set()));
    s.add(lemma);
  }
  return spellings;
}

// Unambiguous authoritative casing: key -> its single capitalized spelling.
function dictCasing(spellings: Map<string, Set<string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, forms] of spellings) {
    if (forms.size === 1 && isCapped([...forms][0]!)) out.set(key, [...forms][0]!);
  }
  return out;
}

// Casing display forms + case-homograph variants for a language.
// @spec FILTER-6, FILTER-7
function buildCasing(cfg: LangConfig): {
  casing: Map<string, string>;
  variants: Map<string, string[]>;
  corpus: Map<string, CorpusStat>;
} {
  const corpus = cfg.casingFile
    ? corpusCasing(cfg.casingFile, cfg.determiners ?? new Set())
    : new Map<string, CorpusStat>();
  const spellings = lemmaSpellings(cfg.lemmaFile);
  const dict = dictCasing(spellings);
  const casing = new Map<string, string>();
  for (const key of new Set([...corpus.keys(), ...dict.keys()])) {
    const c = corpus.get(key);
    if (c && c.tot >= CASING_MIN_COUNT) {
      if (c.cap / c.tot >= CASING_MIN_SHARE) casing.set(key, topKey(c.forms)); // corpus decisive
    } else if (dict.has(key)) {
      casing.set(key, dict.get(key)!); // rare tail: authoritative dictionary
    }
  }

  // Case-homographs: both casings genuinely used mid-sentence AND the lemma list has a
  // capitalized spelling — i.e. the capitalized form is a real common noun, not a
  // surname ("Klein") or a sentence/quote-capitalized adjective ("schwarz"). Store both
  // spellings, more frequent casing first, for the card to translate separately.
  const hasNoun = (key: string) => [...(spellings.get(key) ?? [])].some(isCapped);
  const variants = new Map<string, string[]>();
  for (const [key, c] of corpus) {
    const low = c.tot - c.cap;
    const minority = Math.min(c.cap, low);
    if (c.cap === 0 || minority < HOMOGRAPH_MIN_COUNT || minority / c.tot < HOMOGRAPH_MIN_SHARE) continue;
    if (!hasNoun(key)) continue;
    const capForm = topKey(c.forms);
    variants.set(key, c.cap >= low ? [capForm, key] : [key, capForm]);
  }
  return { casing, variants, corpus };
}

// --- Truncated lemma stems.
//
// michmech headwords some determiners and adjectives on a bare stem — "jed" for
// jede/jedem/jeden/jeder, "ander" for andere — which is not a word in the language. The
// own-entry rule then hands every inflection to it, so the stem lands high on the list
// while the word itself goes missing: "jed" at rank 107 with no "jeder" anywhere. The
// entry moves to whichever of its forms the corpus actually writes, which needs the
// dictionary to say the headword is not a word — see the note in `stemRepairs`.
// @spec FILTER-8
const STEM_MIN_FORM = 20;

/** Stem headword -> the form actually written, for headwords that are not words at all. */
function stemRepairs(
  formsOf: Map<string, string[]>,
  corpus: Map<string, CorpusStat>,
  dictBase: string | string[],
  variants?: [string, string][],
): Map<string, string> {
  const seen = (w: string) => corpus.get(w)?.tot ?? 0;
  const candidates = new Map<string, string>();
  for (const [head, forms] of formsOf) {
    // Every form extending the headword is what marks it a stem rather than a word with
    // inflections: "Dach" does not extend "dachen", so a miscombined entry is left alone.
    if (forms.length < 2) continue;
    if (!forms.every((f) => f.startsWith(head) && f.length > head.length)) continue;
    const best = forms.reduce((a, b) => (seen(b) > seen(a) ? b : a));
    if (seen(best) < STEM_MIN_FORM) continue;
    candidates.set(head, best);
  }
  // The corpus cannot referee which of those headwords is a word, because a German
  // adjective is nearly always written declined: bare "afrikanisch" occurs twice in a
  // million sentences, where "jed" occurs three times. Only a dictionary separates them,
  // so a headword is repaired only when the dictionary says it is not a word.
  const notWords = spellRejects([...candidates.keys()], dictBase, variants);
  return new Map([...candidates].filter(([head]) => notWords.has(head)));
}

/**
 * The words below `DICT_GATE` a spell checker of the language rejects.
 *
 * Past the gate this would be the wrong tool: a checker is thin on the colloquial verbs,
 * diminutives and superlatives the rare tail is made of, and rejects them wholesale. The
 * head of the list has the opposite problem — its junk is personal names the gazetteer
 * spared and untranslated English, which is exactly what the checker knows is not the
 * language. So the two gates split the list between them at the same rank.
 *
 * A word is refused only when none of the spellings its language writes it in is a word:
 * both casings, since the dictionary capitalizes nouns and a checker takes any word
 * capitalized the way a sentence would, plus whatever `spellVariants` adds. Without that
 * the orthography decides vocabulary questions — German's capitalization, French's
 * ligature.
 * @spec FILTER-9
 */
function spellRejects(
  words: string[],
  dictBase: string | string[],
  variants: [string, string][] = [],
): Set<string> {
  const bases = [dictBase].flat();
  for (const base of bases) {
    for (const ext of [".dic", ".aff"]) {
      if (existsSync(data(base) + ext)) continue;
      throw new Error(`${base}${ext} is missing from data/ (see the build inputs table)`);
    }
  }
  // hunspell takes several dictionaries comma-separated and accepts a word any of them
  // holds, which is how one language spans two orthographies.
  const dict = bases.map(data).join(",");
  const ask = (spell: (w: string) => string) => {
    const asked = words.map(spell);
    const r = spawnSync("hunspell", ["-d", dict, "-l"], {
      input: asked.join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    // ENOENT here is the binary missing, which is a broken toolchain rather than a
    // language with nothing to check — say so instead of silently keeping every word.
    if (r.error) throw new Error(`hunspell could not run: ${r.error.message}`);
    // It echoes the spelling it was given, so a variant's answer is read back by position
    // rather than by name: "cœur" comes back as "cœur", and the word asked about is "coeur".
    const bad = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
    return new Set(words.filter((w, i) => bad.has(asked[i]!)));
  };
  const spellings = [(w: string) => w, ...variants.map(([from, to]) => (w: string) => w.replaceAll(from, to))];
  const casings = [(w: string) => w, (w: string) => w.charAt(0).toUpperCase() + w.slice(1)];
  // Refused only where every spelling was refused, so the answers intersect.
  let refused: Set<string> | undefined;
  for (const spelling of spellings) {
    for (const casing of casings) {
      const bad = ask((w) => casing(spelling(w.toLowerCase())));
      const seen = refused;
      refused = seen ? new Set([...bad].filter((w) => seen.has(w))) : bad;
      if (refused.size === 0) return refused;
    }
  }
  return refused ?? new Set<string>();
}

// --- Morphology, the second way past `dictGate`.
//
// The gate asks the lemma list to vouch for a word, and German loses most by it: the
// language spells compounding inside a single word, and compounding is productive, so
// "Bananenbrotrezept" is ordinary German that no list will ever hold. English writes the
// same thing as three words and needs three entries; German needs one per combination,
// forever. A list cannot enumerate an open set, so the rule is re-derived instead.
//
// This is the one thing in the build that is not language-agnostic, and it earns that by
// being the difference between 33k and 53k German words. The Romance five supply no
// `morphology` and are untouched: their compounds are phrasal, so there is nothing here
// for them to re-derive.
// @spec FILTER-10
const MORPH_MIN_PART = 4;
const MORPH_MAX_PARTS = 3;

/**
 * Whether the language's own word-formation accounts for a word the lemma list lacks.
 *
 * The head of a compound and the stem of a derivation must be a **lemma**, not merely a
 * known form. Without that, inflections walk in as though they were base words:
 * "rettungsbooten" splits on "booten" and "bundeskanzlers" on "kanzlers".
 *
 * The split is a yes/no vouch and is never shown, so a wrong analysis of a real word costs
 * nothing — "gaststube" splits as gasts+tube rather than Gast+Stube and is admitted either
 * way. What it must not do is license a name, which German compounding otherwise does
 * freely: "carleton" is carl+ton and "paulchen" is paul+chen. So a part that the gazetteer
 * knows and the lemma list does not poisons the whole split.
 */
function makeVouchMorphology(cfg: LangConfig, isHeadword: Set<string>, known: (w: string) => boolean) {
  const m = cfg.morphology;
  if (!m) return () => false;
  const names = loadNames();
  const okPart = (p: string) => p.length >= MORPH_MIN_PART || m.shortParts.has(p);
  const okHead = (p: string) => okPart(p) && isHeadword.has(p);
  const okMod = (p: string) => okPart(p) && known(p);

  const split = (w: string, depth = 0): string[] | null => {
    if (depth >= MORPH_MAX_PARTS - 1) return null;
    for (let i = w.length - 1; i >= MORPH_MIN_PART; i--) {
      const head = w.slice(i);
      if (!okHead(head)) continue;
      for (const link of m.links) {
        if (link && !w.slice(0, i).endsWith(link)) continue;
        const mod = link ? w.slice(0, i - link.length) : w.slice(0, i);
        if (mod.length < MORPH_MIN_PART) continue;
        if (okMod(mod)) return [mod, head];
        const deeper = split(mod, depth + 1);
        if (deeper) return [...deeper, head];
      }
    }
    return null;
  };
  const derived = (w: string) => m.suffixes.some((s) => {
    if (!w.endsWith(s) || w.length - s.length < MORPH_MIN_PART) return false;
    const stem = w.slice(0, -s.length);
    return [stem, stem + "e", stem + "en", stem + "er", stem.replace(/e$/, "")].some((t) => isHeadword.has(t));
  });
  const prefixed = (w: string) => m.prefixes.some((p) =>
    w.startsWith(p) && w.length - p.length >= MORPH_MIN_PART && isHeadword.has(w.slice(p.length)));

  return (w: string) => {
    const parts = split(w);
    if (parts) return !parts.some((p) => names.has(p) && !isHeadword.has(p));
    return derived(w) || prefixed(w);
  };
}

/**
 * Inflected form -> the indexed word it belongs to, for every form the corpus writes that
 * the merge folded away. Without it "branched" and "jede" answer nothing, though the build
 * knew all along that they are "branch" and "jeder".
 *
 * It resolves with the merge's own `lemmaOf` — own-entry, then first-wins, then the stem
 * repairs — so a form lands on the entry its own frequency was summed into. A rank-based
 * tiebreak was measured instead and is worse: the merge sums every conjugation onto a
 * verb, so verbs outrank the nouns they collide with, and preferring the higher rank then
 * trusts an inflation the merge itself caused. It sends "traiciones" to "traicionar",
 * "opéras" to "opérer" and "rafles" to "rafler", losing about two words for every one it
 * fixes.
 *
 * The one thing on top is the **chase**: a lemma the gates dropped is followed to
 * whichever of its own forms survived, because pointing at michmech's headword would name
 * a word no longer in the list.
 * @spec FORM-1, FORM-2, FORM-3
 */
function formsMap(
  formsOf: Map<string, string[]>,
  rankOf: Map<string, number>,
  lemmaOf: (w: string) => string,
  attested: Set<string>,
): Record<string, string> {
  // A dropped lemma's surviving representative: the form of its entry ranked highest.
  const chaseOf = new Map<string, string>();
  for (const [head, forms] of formsOf) {
    if (rankOf.has(head)) continue;
    let best: string | null = null, bestRank = Infinity;
    for (const f of forms) {
      const r = rankOf.get(f);
      if (r !== undefined && r < bestRank) { best = f; bestRank = r; }
    }
    if (best) chaseOf.set(head, best);
  }

  // Keyed on what the corpus writes, not on what the lemma list holds: the lists carry
  // productive morphology nobody types ("abinha", "aes"), which would double this for
  // nothing.
  const out: Record<string, string> = {};
  for (const form of attested) {
    if (rankOf.has(form)) continue; // findable already
    const lemma = lemmaOf(form);
    const target = rankOf.has(lemma) ? lemma : chaseOf.get(lemma);
    if (target !== undefined && target !== form) out[form] = target;
  }
  return out;
}

function buildLang(cfg: LangConfig) {
  const clean = makeClean(cfg);

  // Lemma map: inflected form -> base lemma (michmech lists are `lemma<TAB>form`).
  const form2lemma = new Map<string, string>();
  const isHeadword = new Set<string>();
  const formsOf = new Map<string, string[]>();
  for (const line of readFileSync(data(cfg.lemmaFile), "utf8").split(/\r?\n/)) {
    const [lemma, form] = line.replace(/^﻿/, "").split("\t");
    const l = clean(lemma), f = clean(form);
    if (!l || !f) continue;
    isHeadword.add(l);
    if (!form2lemma.has(f)) form2lemma.set(f, l);
    const forms = formsOf.get(l);
    if (forms) forms.push(f);
    else formsOf.set(l, [f]);
  }

  // Read before the merge rather than after it: the stem repair below needs the corpus
  // to say which spellings are words, and the merge needs the repair.
  const cased = cfg.casingFile ? buildCasing(cfg) : null;
  const repairs = cased && cfg.spellDict
    ? stemRepairs(formsOf, cased.corpus, cfg.spellDict, cfg.spellVariants)
    : new Map<string, string>();

  // @spec FILTER-3, FILTER-8
  // A word heading its own entry keeps it — else first-wins silently swallows it. Where
  // the headword is a bare stem, the entry moves to the form the corpus writes.
  const lemmaOf = (w: string) => {
    const l = isHeadword.has(w) ? w : form2lemma.get(w) ?? w;
    return repairs.get(l) ?? l;
  };

  // The verb a clitic form belongs to, or null when we can't name it — in which case
  // the form is dropped rather than kept, since "perguntares-me" is not a word either.
  const known = (s: string) => isHeadword.has(s) || form2lemma.has(s);
  const stemOf = (s: string) => {
    if (known(s)) return s;
    for (const [re, sub] of STEM_REPAIR) {
      const t = s.replace(re, sub);
      if (t !== s && known(t)) return t;
    }
    return null;
  };

  // Sum frequency per lemma across all its inflections.
  const lines = readFileSync(data(cfg.freq.file), "utf8").split(/\r?\n/);
  let wCol: number, fCol: number, start: number;
  if (cfg.freq.format === "csv") {
    const [header] = lines;
    // An empty input is a broken download, not a language with no words. Say so here
    // rather than letting indexOf return -1 and every row come out blank.
    if (header === undefined) throw new Error(`${cfg.freq.file} is empty`);
    const head = header.split(",");
    wCol = head.indexOf(cfg.freq.wordCol as string);
    fCol = head.indexOf(cfg.freq.freqCol as string);
    start = 1;
  } else {
    wCol = cfg.freq.wordCol as number;
    fCol = cfg.freq.freqCol as number;
    start = 0;
  }
  const split = (line: string) => (cfg.freq.format === "csv" ? line.split(",") : line.split(/\s+/));

  const freq = new Map<string, number>();
  // Surface forms the corpus actually writes. A lemma list carries productive morphology
  // nobody types ("abinha", "aes"), which would double the redirect map for nothing.
  const attested = new Set<string>();
  let declitMerged = 0, declitDropped = 0;
  // entries() rather than an index: it hands over a `string`, where lines[i] is
  // `string | undefined` to the compiler and copies nothing the way slice(start) would.
  for (const [i, line] of lines.entries()) {
    if (i < start) continue;
    const r = split(line);
    const w = clean(r[wCol]); const wf = Number(r[fCol]);
    if (!w || !(wf > 0)) continue;
    attested.add(w);
    if (cfg.freq.minCount !== undefined && wf < cfg.freq.minCount) continue;
    const stem = declitic(w, cfg);
    let base = w;
    if (stem !== null) {
      const s = stemOf(stem);
      if (s === null) { declitDropped++; continue; }
      base = s;
      declitMerged++;
    }
    const L = lemmaOf(base);
    freq.set(L, (freq.get(L) ?? 0) + wf);
  }

  // Frequency order (desc); alphabetical tie-break keeps the artifact deterministic.
  // Merging/ranking is done on lowercase lemmas; display casing is applied last so
  // lookups (which lowercase their input) still match.
  const rankedKeys = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([w]) => w);

  // Drop personal names (see NAMES_FILE above); needs the casing corpus, so this is a
  // no-op for languages without one.
  const names = cased ? loadNames() : null;
  const isName = (w: string) => {
    if (!names || !cased || isHeadword.has(w) || form2lemma.has(w) || !names.has(w)) return false;
    const s = cased.corpus.get(w);
    if (!s || s.tot < NAME_MIN_OBS || s.cap / s.tot < NAME_CAP_SHARE) return false;
    return s.det / s.tot < NAME_DET_SHARE;
  };
  const namedKeys = rankedKeys.filter((w, i) => i < NAME_RANK_FLOOR || !isName(w));
  const dropped = rankedKeys.length - namedKeys.length;

  // Past DICT_GATE the corpus stops being vocabulary, so the lemma list has to vouch
  // for a word to stay (see `dictGate`). Applied on the post-name-filter ranking, so
  // the gate rank means the rank a learner actually sees. Below the gate a spell checker
  // of the language is the better judge, and answers the other half of the same list
  // (see `spellRejects`).
  const gate = cfg.dictGate ?? Infinity;
  // The spell gate stops at `DICT_GATE` whether or not this language has a `dictGate`.
  // The rank is where a checker stops being right about a corpus, which is a property of
  // the checker; English has no dictionary gate and still has a head worth cleaning.
  const spellGate = Math.min(gate, DICT_GATE);
  const misspelt = cfg.spellDict
    ? spellRejects(namedKeys.slice(0, spellGate), cfg.spellDict, cfg.spellVariants)
    : new Set<string>();
  // @spec FILTER-10
  // Past the gate the lemma list is not the only judge: a word the language's own
  // word-formation accounts for is vocabulary whether or not anyone listed it.
  const vouch = makeVouchMorphology(cfg, isHeadword, known);
  const kept = (w: string) => known(w) || vouch(w);
  const keptKeys = namedKeys.filter((w, i) => (i < gate ? !misspelt.has(w) : kept(w)));
  const gated = namedKeys.filter((w, i) => i >= gate && !kept(w)).length;
  const vouched = namedKeys.filter((w, i) => i >= gate && !known(w) && vouch(w)).length;

  const ranked = cased ? keptKeys.map((w) => cased.casing.get(w) ?? w) : keptKeys;

  // Case-homographs among the ranked words: lowercase key -> both casings to translate.
  const variants: Record<string, string[]> = {};
  if (cased) for (const w of keptKeys) if (cased.variants.has(w)) variants[w] = cased.variants.get(w)!;

  const bandCount = (d: BandDef) =>
    Math.max(0, (d.max === null ? ranked.length : Math.min(d.max, ranked.length)) - d.min + 1);
  // @spec BAND-4
  // A band the list never reaches would render as an empty tab, so drop it.
  const reached = (defs: BandDef[]) => defs.filter((d) => bandCount(d) > 0);
  const freqBands = reached(FREQ_BANDS);
  const cefrBands = reached(CEFR_BANDS);

  const outPath = data(`word-bands.${cfg.code}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ lang: cfg.code, ranked, variants, freqBands, cefrBands }),
  );

  const rankOf = new Map(keptKeys.map((w, i) => [w, i + 1]));
  const forms = formsMap(formsOf, rankOf, lemmaOf, attested);
  const formsPath = data(`forms.${cfg.code}.json`);
  writeFileSync(formsPath, JSON.stringify(forms));

  // --- Report ---
  console.log(`\n[${cfg.code}] ranked ${ranked.length.toLocaleString()} lemmas -> ${outPath}`);
  console.log("  freq:", freqBands.map((d) => `${d.label}=${bandCount(d).toLocaleString()}`).join("  "));
  console.log("  CEFR:", cefrBands.map((d) => `${d.key}=${bandCount(d).toLocaleString()}`).join("  "));
  console.log("  spot-checks:", cfg.spotChecks.map((w) => `${w}→${(rankOf.get(w) ?? "—").toLocaleString()}`).join("  "));
  if (cased) {
    const capped = keptKeys.filter((w) => cased.casing.has(w)).length;
    const pct = ((capped / keptKeys.length) * 100).toFixed(0);
    const examples = keptKeys.filter((w) => cased.casing.has(w)).slice(0, 4).map((w) => cased.casing.get(w)!);
    console.log(`  casing: ${capped.toLocaleString()} capitalized (${pct}%)`, "e.g.", examples.join(" "));
    console.log(`  homographs: ${Object.keys(variants).length}`, "e.g.",
      Object.values(variants).slice(0, 3).map((v) => v.join("/")).join(" "));
    const sample = rankedKeys.filter((w, i) => i >= NAME_RANK_FLOOR && isName(w)).slice(0, 6);
    console.log(`  names dropped: ${dropped.toLocaleString()}`, "e.g.", sample.join(" "));
  }
  if (cfg.clitics) {
    console.log(`  clitics: ${declitMerged.toLocaleString()} forms merged into their verb,`,
      `${declitDropped.toLocaleString()} dropped as unattributable`);
  }
  if (cfg.dictGate) {
    const sample = namedKeys.filter((w, i) => i >= cfg.dictGate! && !kept(w)).slice(0, 6);
    console.log(`  dict gate: ${gated.toLocaleString()} dropped past rank`,
      `${cfg.dictGate.toLocaleString()}`, "e.g.", sample.join(" "));
  }
  if (cfg.morphology) {
    const sample = namedKeys.filter((w, i) => i >= gate && !known(w) && vouch(w)).slice(0, 6);
    console.log(`  morphology: ${vouched.toLocaleString()} kept past the gate`, "e.g.", sample.join(" "));
  }
  if (repairs.size) {
    const sample = [...repairs].filter(([h]) => rankOf.has(repairs.get(h)!)).slice(0, 6);
    console.log(`  stem repairs: ${repairs.size.toLocaleString()}`, "e.g.",
      sample.map(([h, f]) => `${h}→${f}`).join(" "));
  }
  if (cfg.spellDict) {
    const sample = namedKeys.filter((w, i) => i < spellGate && misspelt.has(w)).slice(0, 8);
    console.log(`  spell gate: ${misspelt.size.toLocaleString()} dropped below rank`,
      `${spellGate.toLocaleString()}`, "e.g.", sample.join(" "));
  }
  const chased = Object.entries(forms).filter(([f, t]) => lemmaOf(f) !== t).length;
  console.log(`  forms: ${Object.keys(forms).length.toLocaleString()} redirects ->`,
    `${formsPath} (${chased.toLocaleString()} chased past a dropped lemma)`, "e.g.",
    Object.entries(forms).slice(0, 4).map(([f, t]) => `${f}→${t}`).join(" "));
}

const only = process.argv[2];
if (only && !LANGS[only]) {
  console.error(`unknown language "${only}" (have: ${Object.keys(LANGS).join(", ")})`);
  process.exit(1);
}
for (const cfg of Object.values(LANGS)) {
  if (!only || only === cfg.code) buildLang(cfg);
}
