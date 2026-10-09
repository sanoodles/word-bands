"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import CefrBadge from "@/components/CefrBadge";
import LangSelect from "@/components/LangSelect";
import Loading from "@/components/Loading";
import { PANEL, PANEL_LANG, SECTION_HEADING } from "@/components/panel";
import {
  englishName,
  etymologyHref,
  hasWiktionary,
  wiktionaryHref,
  type SourceLang,
  type TargetLang,
} from "@/lib/languages";
import type { WordLevel } from "@/lib/types";
import { baseLang, type SenseGroup } from "@/lib/translate";

// Offered in the picker; the reader's browser language and current pick are merged in.
const COMMON_LANGS = [
  "ar", "de", "en", "es", "fr", "hi", "id", "it", "ja",
  "ko", "nl", "pl", "pt", "ru", "tr", "uk", "vi", "zh",
];

function browserLang() {
  return baseLang(typeof navigator !== "undefined" ? navigator.language : "en");
}

// Each language named in its own tongue (endonym), so any reader recognizes theirs.
function endonym(code: string) {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Google Translate UI link — the escape hatch for what we don't do inline:
// pronunciation audio, example sentences, alternate senses. Always a new tab.
function translateHref(word: string, source: string, target: TargetLang) {
  const p = new URLSearchParams({ sl: source, tl: target, text: word, op: "translate" });
  return `https://translate.google.com/?${p}`;
}

/** Each translated term's CEFR level in the target language, keyed by the term. */
type Levels = Record<string, WordLevel>;

// Session cache: learners check dozens of words and revisit some, so don't refetch.
const glossCache = new Map<string, { text: string; groups: SenseGroup[]; levels: Levels }>();

const NO_GROUPS: SenseGroup[] = [];
const NO_LEVELS: Levels = {};
const PENDING = { status: "loading", text: "", groups: NO_GROUPS, levels: NO_LEVELS } as const;

type Gloss = {
  status: "loading" | "done" | "error";
  text: string;
  groups: SenseGroup[];
  levels: Levels;
};

// Dict mode: it carries the per-part-of-speech readings.
function useGloss(word: string, source: string, target: TargetLang, enabled: boolean): Gloss {
  const [gloss, setGloss] = useState<Gloss>(PENDING);
  useEffect(() => {
    if (!enabled) return;
    const key = `${source}:${target}:${word}`;
    const cached = glossCache.get(key);
    if (cached !== undefined) {
      setGloss({ status: "done", ...cached });
      return;
    }
    setGloss(PENDING);
    const ac = new AbortController();
    fetch(`/api/translate/${encodeURIComponent(word)}?source=${source}&target=${target}&dict=1`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { translation: string; groups?: SenseGroup[]; levels?: Levels }) => {
        const entry = {
          text: d.translation,
          groups: d.groups ?? NO_GROUPS,
          levels: d.levels ?? NO_LEVELS,
        };
        glossCache.set(key, entry);
        setGloss({ status: "done", ...entry });
      })
      .catch(() => {
        if (!ac.signal.aborted) setGloss({ ...PENDING, status: "error" });
      });
    return () => ac.abort();
  }, [word, source, target, enabled]);
  return gloss;
}

type Wikt = {
  status: "loading" | "done" | "error";
  terms: string[];
  /** The source edition's page for the word, or null where it has none. */
  title: string | null;
  levels: Levels;
};

const wiktCache = new Map<string, Omit<Wikt, "status">>();
const WIKT_PENDING: Wikt = { status: "loading", terms: [], title: null, levels: NO_LEVELS };

function useWiktionary(word: string, source: string, target: TargetLang, enabled: boolean): Wikt {
  const [wikt, setWikt] = useState<Wikt>(WIKT_PENDING);
  useEffect(() => {
    if (!enabled) return;
    const key = `${source}:${target}:${word.toLowerCase()}`;
    const cached = wiktCache.get(key);
    if (cached !== undefined) {
      setWikt({ status: "done", ...cached });
      return;
    }
    setWikt(WIKT_PENDING);
    const ac = new AbortController();
    fetch(`/api/wiktionary/${encodeURIComponent(word)}?source=${source}&target=${target}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { terms: string[]; title: string | null; levels?: Levels }) => {
        const entry = { terms: d.terms, title: d.title, levels: d.levels ?? NO_LEVELS };
        wiktCache.set(key, entry);
        setWikt({ status: "done", ...entry });
      })
      .catch(() => {
        if (!ac.signal.aborted) setWikt({ ...WIKT_PENDING, status: "error" });
      });
    return () => ac.abort();
  }, [word, source, target, enabled]);
  return wikt;
}

/** One listed line: a label — a source-language casing, or a part of speech — and its terms. */
type GlossLine = { label: string; terms: string[] };
type Forms = { status: "loading" | "done" | "error"; items: GlossLine[]; levels: Levels };

// Translations for a case-homograph: translate each casing on its own (dict mode, which
// is casing-sensitive), then keep only casings whose meaning is distinct — so a spurious
// pairing ("wer"/"Wer" → both "who") collapses back to a single line.
function useForms(forms: string[], source: string, target: TargetLang, enabled: boolean): Forms {
  const [state, setState] = useState<Forms>({ status: "loading", items: [], levels: NO_LEVELS });
  const key = `${source}:${target}:${forms.join("|")}`;
  useEffect(() => {
    if (!enabled) return;
    setState({ status: "loading", items: [], levels: NO_LEVELS });
    const ac = new AbortController();
    Promise.all(
      forms.map((form) =>
        fetch(`/api/translate/${encodeURIComponent(form)}?source=${source}&target=${target}&dict=1`, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((d: { translation: string; senses: string[]; levels?: Levels }) => ({
            line: {
              label: form,
              terms: (d.senses.length ? d.senses : [d.translation]).filter(Boolean),
            },
            levels: d.levels ?? NO_LEVELS,
          })),
      ),
    )
      .then((all) => {
        const seen = new Set<string>();
        const items: GlossLine[] = [];
        const levels: Levels = {};
        for (const { line, levels: own } of all) {
          Object.assign(levels, own);
          const text = line.terms.join(", ").toLowerCase();
          if (text && !seen.has(text)) {
            seen.add(text);
            items.push(line);
          }
        }
        setState({ status: "done", items, levels });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ status: "error", items: [], levels: NO_LEVELS });
      });
    return () => ac.abort();
  }, [key, enabled]); // forms is captured via `key`
  return state;
}

function TargetSelect({
  value,
  onChange,
}: {
  value: TargetLang;
  onChange: (l: TargetLang) => void;
}) {
  const options = [...new Set([...COMMON_LANGS, browserLang(), value])]
    .map((code) => ({ code, name: endonym(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <LangSelect label="Target language" value={value} options={options} onChange={onChange} />
  );
}

// Body size, on a line one and a half times its height, so two sources' lines still read
// apart when they wrap (WCAG 1.4.8). Inline, because Fondue's typography utilities are
// emitted last and a class cannot override them. `block` pins the line to its own
// line-height; inline, it unions with the parent strut.
const GLOSS_TYPE = {
  display: "block",
  lineHeight: "var(--typography-line-height-loose)",
};

// The translation's line box — else each translation resizes the card.
const STATUS_TYPE = { display: GLOSS_TYPE.display, lineHeight: GLOSS_TYPE.lineHeight };

// The etymology link, a 44px target (WCAG 2.5.5).
const OUT_LINK =
  "tw-inline-flex tw-min-h-[44px] tw-shrink-0 tw-items-center tw-justify-center tw-gap-1 tw-rounded-full tw-border tw-border-line-subtle tw-px-3 tw-py-1.5 tw-body-medium tw-text-secondary tw-no-underline hover:tw-border-line hover:tw-text-primary";

// A line's source trails its terms, quieter than they are: the line is a translation first.
// Unselectable, like the badges, so a copied line is the translation and nothing else.
const SOURCE = "tw-ml-3 tw-select-none tw-whitespace-nowrap tw-body-medium text-muted-aaa";
const SOURCE_LINK = `${SOURCE} tw-no-underline tw-underline-offset-4 hover:tw-text-primary hover:tw-underline`;

/** The name of the source a line came from, linked to its page for the word. */
function SourceLink({
  href,
  name,
  hrefLang,
  describedBy,
  children,
}: {
  href: string;
  /** Leads with the visible text, so speech input still reaches it (2.5.3). */
  name: string;
  hrefLang?: string;
  describedBy: string;
  children: string;
}) {
  return (
    <a
      href={href}
      hrefLang={hrefLang}
      target="_blank"
      rel="noopener noreferrer"
      // English inside a line marked as the target language.
      lang="en"
      aria-label={name}
      aria-describedby={describedBy}
      className={SOURCE_LINK}
    >
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

// Underlined on hover only: the line is a translation first, and six standing underlines
// would read as a row of links rather than as the meaning of the word.
const PICK =
  "tw-cursor-pointer tw-underline-offset-4 tw-decoration-dotted hover:tw-underline";

/**
 * One reading's alternatives, each trailed by its own CEFR level where the target language
 * is one we index. The separators are plain text, so the line reads as the translation.
 *
 * A badged term is wrapped so its badge can point at it — see `CefrBadge`. Only a badged
 * one: the wrapper exists to be pointed at, and a span carries no text of its own either
 * way.
 *
 * That wrapper is a button where `onPick` is given. A level is the target language's own
 * list vouching for the term, so a badged term is a word that language has — which is
 * exactly the condition for studying it, and why nothing here has to ask first.
 */
function Terms({
  terms,
  levels,
  target,
  onPick,
  pickHelp,
  trailing,
}: {
  terms: string[];
  levels: Levels;
  target: TargetLang;
  /** Study this term's language, starting from it. Absent where that language has no list. */
  onPick?: ((term: string) => void) | undefined;
  /** Id of the one element saying what picking a term does. */
  pickHelp?: string | undefined;
  /** After the last term, in the same run of text. */
  trailing?: ReactNode;
}) {
  const base = useId();
  return (
    <span lang={target} className="tw-body-large tw-text-primary" style={GLOSS_TYPE}>
      {terms.map((term, i) => {
        const level = levels[term];
        const termId = `${base}-${i}`;
        return (
          <Fragment key={`${i}:${term}`}>
            {i > 0 && ", "}
            {level ? (
              // One unbreakable run: a button is an atomic inline, which a line may break after.
              <span className="tw-whitespace-nowrap">
                {onPick ? (
                  <button
                    type="button"
                    id={termId}
                    // Named by the term itself, never by a label saying what the click does:
                    // a name would replace the word and the line would stop reading as the
                    // translation. The purpose is a description, announced on focus alone.
                    aria-describedby={pickHelp}
                    className={PICK}
                    onClick={() => onPick(term)}
                  >
                    {term}
                  </button>
                ) : (
                  <span id={termId}>{term}</span>
                )}
                <CefrBadge level={level} describedBy={termId} />
              </span>
            ) : (
              term
            )}
          </Fragment>
        );
      })}
      {trailing}
    </span>
  );
}

/** The looked-up word and its translation. */
export default function WordCard({
  word,
  level,
  forms,
  source,
  target,
  onTargetChange,
  onGloss,
  onPickTerm,
}: {
  word: string;
  /**
   * The word's own CEFR level, shown beside the heading. Passed only where the search
   * field cannot show it, so the level is never printed twice (WCAG 1.4.10).
   */
  level?: WordLevel | undefined;
  /**
   * The word's casings, or null while the lookup is still in flight — which
   * renders this exact frame with the translation pending, so the card is already
   * its settled height on first paint and the page below it never jumps.
   */
  forms: string[] | null;
  /** Source language the word is in. */
  source: SourceLang;
  /** Target language, owned by the workspace so it can ride in the URL. */
  target: TargetLang;
  onTargetChange: (l: TargetLang) => void;
  /** The translation's leading term, so a language swap can land on it. */
  onGloss?: (term: string) => void;
  /**
   * Study the target language, starting from the term that was clicked. Absent where that
   * language has no word list of ours, which is also where no term carries a level.
   */
  onPickTerm?: ((term: string) => void) | undefined;
}) {
  // No point translating a word into its own language.
  const translate = target !== source;
  const pending = forms === null;
  // A case-homograph translates each casing separately; everything else is one line.
  const casings = forms ?? [word];
  const homograph = casings.length > 1;
  const single = useGloss(word, source, target, translate && !homograph && !pending);
  const multi = useForms(casings, source, target, translate && homograph && !pending);
  // One id for the sentence every term button points at.
  const pickHelp = useId();
  const newTabHelp = useId();
  const headingId = useId();
  const wordId = `${headingId}-word`;

  // Both hooks park on "loading" until enabled, which is the pending frame's state.
  const status = homograph ? multi.status : single.status;
  // Separate readings get a line each: per casing for a homograph, else per part of speech.
  const lines: GlossLine[] = homograph
    ? multi.items
    : single.groups.length > 1
      ? single.groups.map((g) => ({ label: g.pos, terms: g.terms }))
      : [];
  const showLines = lines.length > 1;
  const levels = homograph ? multi.levels : single.levels;
  // Dictionary terms beat the plain translation, which alone can be wrong ("acqua" → "waterfall").
  const heroTerms = homograph
    ? (multi.items[0]?.terms ?? [])
    : single.groups.length === 1
      ? single.groups[0]!.terms
      : single.text
        ? [single.text]
        : [];
  // What Google's line shows, which Wiktionary's is weighed against.
  const googleTerms = showLines ? lines.flatMap((l) => l.terms) : heroTerms;
  const googleShows = status === "done" && googleTerms.length > 0;

  // @spec WIKT-1, WIKT-3
  // Wiktionary's line, for the pairs it is built for, and only where it adds a term.
  const wiktOn = translate && hasWiktionary(source, target);
  const wikt = useWiktionary(word, source, target, wiktOn && !pending);
  const onGoogle = new Set(googleTerms.map((t) => t.toLowerCase()));
  const wiktShows =
    wiktOn && wikt.status === "done" && wikt.terms.some((t) => !onGoogle.has(t.toLowerCase()));
  // The lines land together, so the card changes height once.
  const settled = status !== "loading" && !(wiktOn && wikt.status === "loading");

  // "water, aqua" -> "water": the term a swap into this language would look up.
  const heroTerm =
    (googleShows ? heroTerms[0] : wiktShows ? wikt.terms[0] : undefined)?.split(",")[0]?.trim() ?? "";
  useEffect(() => {
    if (settled && heroTerm) onGloss?.(heroTerm);
  }, [settled, heroTerm, onGloss]);

  // A picked term's own button is removed by the re-render its pick causes, so focus
  // falls to <body> (WCAG 2.4.3). Take it to the card, which is named for the word —
  // and only once that word has landed, or the name announced is the one left behind.
  const cardRef = useRef<HTMLElement>(null);
  const picked = useRef<string | null>(null);
  const pickTerm = onPickTerm
    ? (term: string) => {
        picked.current = term;
        onPickTerm(term);
      }
    : undefined;
  useEffect(() => {
    if (picked.current === null) return;
    // A lookup that never landed on the picked word leaves the move unowed, and
    // clearing here is what keeps a stale pick from taking focus later.
    const landed = picked.current.toLowerCase() === word.toLowerCase();
    picked.current = null;
    // Somewhere real already: a Tab in the meantime, or a browser that never focused
    // the button. Either way the pick is not what put focus there.
    if (landed && document.activeElement === document.body) cardRef.current?.focus();
  }, [word]);

  const googleLink = (
    <SourceLink
      href={translateHref(word, source, target)}
      // The word and the language behind it are what the link is for (2.4.9).
      name={`Google Translate: ${word} in ${englishName(target)}`}
      describedBy={newTabHelp}
    >
      Google
    </SourceLink>
  );
  const wiktLink = wikt.title ? (
    <SourceLink
      href={wiktionaryHref(wikt.title, source)}
      hrefLang={source}
      name={`Wiktionary entry for ${word}`}
      describedBy={newTabHelp}
    >
      Wiktionary
    </SourceLink>
  ) : (
    <span lang="en" className={SOURCE}>
      Wiktionary
    </span>
  );

  return (
    // The heading is the name: without it the card is an unlabelled box, and its live
    // region would announce a translation with no subject. It carries the word for the
    // same reason, and visibly so the card's row starts level with the panel facing it.
    <section
      ref={cardRef}
      aria-labelledby={headingId}
      // Focusable only as a landing place for the recovery above, never in the tab order.
      tabIndex={-1}
      className={`WordCard ${PANEL}`}
    >
      {/* The badge sits beside the heading, never inside it: the heading is the card's
          name, and the level belongs to the word rather than to the card. */}
      <div className="tw-flex tw-items-baseline tw-gap-1">
        <h2 id={headingId} className={SECTION_HEADING}>
          Meaning of{" "}
          <span id={wordId} lang={source}>
            {word}
          </span>
        </h2>
        {level && <CefrBadge level={level} describedBy={wordId} />}
      </div>
      {/* Leads the row, since it decides what the translation says, and keeps it at every
          width. */}
      <div className="tw-flex tw-items-start tw-gap-2 min-[700px]:tw-gap-4">
        <div className={PANEL_LANG}>
          <TargetSelect value={target} onChange={onTargetChange} />
        </div>
        {/* Wraps on the card's own width, not the viewport's. The lines take the width they
            need, so the etymology link drops below them only where the two do not fit. */}
        <div className="tw-flex tw-min-w-0 tw-grow tw-flex-wrap tw-items-start tw-justify-between tw-gap-x-4 tw-gap-y-2">
          {/* The card is only the meaning now — the word itself is in the search box
              and spotlighted in the cloud, so printing it a third time said nothing. */}
          {/* Padded so the first line sits level with the select's text, at any number of
              lines, and a single line is the 44px of the field facing it. */}
          <div className="tw-w-max tw-max-w-full tw-py-2.5">
            {/* Announce translation state changes to assistive tech (WCAG 4.1.3). */}
            <div aria-live="polite">
              {/* Nothing to translate, but Google's page still has the word's pronunciation. */}
              {!translate && <span style={STATUS_TYPE}>{googleLink}</span>}
              {translate && !settled && (
                // Reserves the translation's line box, so the card doesn't resize when it lands.
                // The wrapper is already the live region, so don't nest another.
                <Loading
                  size="x-small"
                  announce={false}
                  label="Translating…"
                  className="tw-min-h-[var(--typography-line-height-loose)]"
                />
              )}
              {translate && settled && (
                // @spec WIKT-2
                <div className="tw-flex tw-flex-col tw-gap-1.5">
                  {googleShows && showLines ? (
                    <ul className="tw-flex tw-flex-col tw-gap-1.5">
                      {lines.map((l, i) => (
                        <li
                          key={`${l.label}:${l.terms.join(",")}`}
                          className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-2"
                        >
                          {l.label && (
                            // A casing is source-language; a POS label comes back in the reader's.
                            <span
                              lang={homograph ? source : target}
                              className="tw-body-medium text-muted-aaa"
                            >
                              {l.label}
                            </span>
                          )}
                          <Terms
                            terms={l.terms}
                            levels={levels}
                            target={target}
                            onPick={pickTerm}
                            pickHelp={pickHelp}
                            trailing={i === lines.length - 1 ? googleLink : null}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : googleShows ? (
                    <Terms
                      terms={heroTerms}
                      levels={levels}
                      target={target}
                      onPick={pickTerm}
                      pickHelp={pickHelp}
                      trailing={googleLink}
                    />
                  ) : (
                    <span className="tw-body-medium text-muted-aaa" style={STATUS_TYPE}>
                      no translation
                      {googleLink}
                    </span>
                  )}
                  {wiktShows && (
                    <Terms
                      terms={wikt.terms}
                      levels={wikt.levels}
                      target={target}
                      onPick={pickTerm}
                      pickHelp={pickHelp}
                      trailing={wiktLink}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          {/* One description shared by every term button — the string is said once, and a
              name holding it would replace the word and stop the line reading as the
              translation. Outside the live region: it must not be announced as new text.
              aria-hidden so browse mode does not meet it again as loose content. */}
          {onPickTerm && (
            <p id={pickHelp} className="visually-hidden" aria-hidden="true">
              Look this word up in {englishName(target)}, swapping the two languages.
            </p>
          )}
          {/* The card's new-tab links share it. A description, not part of the name: what
              activating one does, announced on focus, while the name stays what it is for.
              aria-hidden for the reason the sentence above is. */}
          <p id={newTabHelp} className="visually-hidden" aria-hidden="true">
            Opens in a new tab.
          </p>
          {/* @spec ETYM-1
              A new tab, like the source links. The dictionary is written in the source
              language, which hreflang says. */}
          <a
            href={etymologyHref(word, source)}
            hrefLang={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Etymology of ${word}`}
            aria-describedby={newTabHelp}
            className={OUT_LINK}
          >
            Etymology <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
