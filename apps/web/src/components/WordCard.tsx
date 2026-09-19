"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import CefrBadge from "@/components/CefrBadge";
import LangSelect from "@/components/LangSelect";
import Loading from "@/components/Loading";
import { PANEL, PANEL_LANG } from "@/components/panel";
import { englishName, type TargetLang } from "@/lib/languages";
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

// x-large, the next step up the type scale, but at body weight — Fondue has no
// body-x-large, and its typography utilities are emitted last, so a class can't
// override them. Line height comes along or 20px text sits in a 20px box.
// `block` pins the line to its own line-height; inline, it unions with the parent strut.
const GLOSS_TYPE = {
  display: "block",
  fontSize: "var(--typography-font-size-x-large)",
  lineHeight: "var(--typography-line-height-loose)",
};

// Smaller type, but the translation's line box — else each translation resizes the card.
const STATUS_TYPE = { display: GLOSS_TYPE.display, lineHeight: GLOSS_TYPE.lineHeight };

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
}: {
  terms: string[];
  levels: Levels;
  target: TargetLang;
  /** Study this term's language, starting from it. Absent where that language has no list. */
  onPick?: ((term: string) => void) | undefined;
  /** Id of the one element saying what picking a term does. */
  pickHelp?: string | undefined;
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
            {level && onPick ? (
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
            ) : level ? (
              <span id={termId}>{term}</span>
            ) : (
              term
            )}
            {level && <CefrBadge level={level} describedBy={termId} />}
          </Fragment>
        );
      })}
    </span>
  );
}

/** The looked-up word and its translation. */
export default function WordCard({
  word,
  forms,
  source,
  target,
  onTargetChange,
  onGloss,
  onPickTerm,
}: {
  word: string;
  /**
   * The word's casings, or null while the lookup is still in flight — which
   * renders this exact frame with the translation pending, so the card is already
   * its settled height on first paint and the page below it never jumps.
   */
  forms: string[] | null;
  /** Source language the word is in. */
  source: string;
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
  const missing = status === "error" || (status === "done" && !showLines && !heroTerms.length);

  // "water, aqua" -> "water": the term a swap into this language would look up.
  const heroTerm = heroTerms[0]?.split(",")[0]?.trim() ?? "";
  useEffect(() => {
    if (status === "done" && heroTerm) onGloss?.(heroTerm);
  }, [status, heroTerm, onGloss]);

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

  return (
    // Named for AT: without the heading the card is an unlabelled box, and its live
    // region would announce a translation with no subject.
    <section
      ref={cardRef}
      aria-label={`Meaning of ${word}`}
      // Focusable only as a landing place for the recovery above, never in the tab order.
      tabIndex={-1}
      className={`WordCard ${PANEL}`}
    >
      {/* Wraps on the card's own width, not the viewport's — it is also cramped in the
          two-column layout just past 860px. Alone on a wrapped row, justify-between
          leaves the link at the start. */}
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2 min-[700px]:tw-gap-4">
        {/* Leads the row, since it decides what the translation says. */}
        <div className={PANEL_LANG}>
          <TargetSelect value={target} onChange={onTargetChange} />
        </div>
        {/* The card is only the meaning now — the word itself is in the search box
            and spotlighted in the cloud, so printing it a third time said nothing. */}
        {/* 44px, centred: the translation sits on the same line as the search field facing
            it, and level with the link beside it. Basis is short by the width the
            select takes from the row, so the link still drops at the same card width. */}
        <div className="tw-flex tw-min-h-[44px] tw-min-w-0 tw-grow tw-basis-[11rem] tw-items-center">
          {/* Announce translation state changes to assistive tech (WCAG 4.1.3). */}
          <div aria-live="polite">
            {translate && status === "loading" && (
              // Reserves the translation's line box, so the card doesn't resize when it lands.
              // The wrapper is already the live region, so don't nest another.
              <Loading
                size="x-small"
                announce={false}
                label="Translating…"
                className="tw-min-h-[var(--typography-line-height-loose)]"
              />
            )}
            {translate && status === "done" && showLines && (
              <ul className="tw-flex tw-flex-col tw-gap-1.5">
                {lines.map((l) => (
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
                    />
                  </li>
                ))}
              </ul>
            )}
            {translate && status === "done" && !showLines && heroTerms.length > 0 && (
              <Terms
                terms={heroTerms}
                levels={levels}
                target={target}
                onPick={pickTerm}
                pickHelp={pickHelp}
              />
            )}
            {translate && missing && (
              <span className="tw-body-small text-muted-aaa" style={STATUS_TYPE}>
                no translation
              </span>
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
        {/* 44px target (WCAG 2.5.5). */}
        <a
          href={translateHref(word, source, target)}
          // Opens a fresh tab every time (named-tab reuse can't survive Google
          // clearing window.name) — accepted, for its pronunciation audio.
          target="_blank"
          rel="noopener noreferrer"
          className="tw-inline-flex tw-min-h-[44px] tw-shrink-0 tw-items-center tw-justify-center tw-gap-1 tw-rounded-full tw-border tw-border-line-subtle tw-px-4 tw-py-1.5 tw-body-large tw-text-secondary tw-no-underline hover:tw-border-line hover:tw-text-primary"
        >
          Google Translate <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
