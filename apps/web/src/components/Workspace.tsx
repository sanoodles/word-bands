"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SegmentedControl, Tooltip } from "@frontify/fondue/components";
import BandBrowser from "@/components/BandBrowser";
import CefrBadge from "@/components/CefrBadge";
import DefiningScatter from "@/components/DefiningScatter";
import LangSelect from "@/components/LangSelect";
import WordCard from "@/components/WordCard";
import WordSearchBox from "@/components/WordSearchBox";
import type { BandView, WordBands } from "@/lib/types";
import {
  DEFAULT_SOURCE,
  englishName,
  hasDefining,
  isSourceLang,
  SOURCE_LANGS,
  SOURCE_LANG_META,
  type SourceLang,
  type TargetLang,
} from "@/lib/languages";
import { sourceLang, targetLang } from "@/lib/geo";
import { baseLang } from "@/lib/translate";
import { pageTitle, readScenario, writeScenario } from "@/lib/scenario";
import { PANEL, PANEL_LANG, SECTION_HEADING } from "@/components/panel";

// Expanded forms for the abbreviations we show (WCAG 3.1.4).
const CEFR_TITLE = "Common European Framework of Reference for Languages";
const CEFRJ_TITLE = "CEFR-J — a Japanese adaptation of the CEFR for finer levelling";
const SUBTLEX_TITLE = "SUBTLEX-US — a US-English word-frequency database drawn from film subtitles";
const LEIPZIG_TITLE =
  "Leipzig Corpora Collection — sentence corpora used to measure mid-sentence capitalization";
const CC_BY_SA_TITLE = "Creative Commons Attribution-ShareAlike 4.0";
const ODBL_TITLE = "Open Database License 1.0";

// Ancillary data sources not tied to one language's frequency list.
const LEMMA_URL = "https://github.com/michmech/lemmatization-lists";
const LEIPZIG_URL = "https://wortschatz.uni-leipzig.de/en/download";
const TRANSLATE_URL = "https://translate.google.com/";
const WIKTEXTRACT_URL = "https://kaikki.org/";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";

// The works the defining levels' method follows.
const BLONDIN_MASSE_URL = "https://aclanthology.org/W08-2003/";
const VINCENT_LAMARRE_URL = "https://doi.org/10.1111/tops.12211";
const SEIDMAN_URL = "https://doi.org/10.1016/0378-8733(83)90028-X";

// Persisted picks, so a returning learner lands back where they left off. A shareable
// URL (see lib/scenario) takes precedence over these when present; where neither says
// anything, the client's country seeds the source language (see lib/geo).
const SOURCE_KEY = "word-bands:source";
const TARGET_KEY = "word-bands:target";

const browserLang = () =>
  baseLang(typeof navigator !== "undefined" ? navigator.language : "en");

// The workspace is client-only (see WorkspaceLazy), so localStorage is available at
// first render — read it in the state initializers to avoid a default-value flash.
function storedSource(): SourceLang | null {
  try {
    const s = window.localStorage.getItem(SOURCE_KEY);
    if (s && isSourceLang(s)) return s;
  } catch {
    /* storage unavailable */
  }
  return null;
}
function storedTarget(): TargetLang | null {
  try {
    const s = window.localStorage.getItem(TARGET_KEY);
    if (s) return baseLang(s);
  } catch {
    /* storage unavailable */
  }
  return null;
}

const SOURCE_OPTIONS = SOURCE_LANGS.map((code) => ({
  code,
  name: SOURCE_LANG_META[code].name,
}));

// A dropdown, not a segmented control: the language is picked once and then left
// alone, so it doesn't deserve a row of six always-visible buttons.
function SourceSelect({
  value,
  onChange,
}: {
  value: SourceLang;
  onChange: (l: SourceLang) => void;
}) {
  return (
    <LangSelect
      label="Source language"
      // A pick moves focus into the search field, which WCAG 3.2.2 allows only where the
      // move was advised beforehand. A description is read on focus, so it arrives while
      // the menu is still closed; the field itself is read after the move has happened.
      describedBy="lang-help"
      value={value}
      options={SOURCE_OPTIONS}
      onChange={onChange}
    />
  );
}

// Sits between the two panels: a vertical divider control on a wide screen, a
// horizontal one where they stack — hence the arrow turning with the breakpoint.
const SWAP =
  "tw-flex tw-h-11 tw-w-11 tw-items-center tw-justify-center tw-rounded-full tw-border " +
  "tw-border-line-subtle tw-bg-surface tw-text-large tw-text-secondary tw-transition-colors " +
  "hover:tw-border-line hover:tw-text-primary " +
  "aria-disabled:tw-cursor-not-allowed aria-disabled:tw-opacity-40 " +
  "aria-disabled:hover:tw-border-line-subtle aria-disabled:hover:tw-text-secondary";

const SOURCE_NAMES = SOURCE_LANGS.map((c) => SOURCE_LANG_META[c].name).join(", ");

/**
 * Study what you were translating into. Only the six indexed languages can be a source,
 * so a target outside them leaves this inert rather than absent — a control that vanishes
 * as the target changes is harder to understand than one that explains.
 */
function SwapButton({ enabled, onSwap }: { enabled: boolean; onSwap: () => void }) {
  const reason = `Only ${SOURCE_NAMES} can be a source language`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {/* aria-disabled, not disabled: it stays focusable, so the reason is reachable. */}
        <button
          type="button"
          aria-disabled={!enabled}
          // The reason rides in the name, the one channel that survives browse mode —
          // the same trade CefrBadge makes. Radix would otherwise point aria-describedby
          // at a tooltip that only says the label again; this empties it.
          aria-label={
            enabled ? "Swap the source and target languages" : `Swap languages — ${reason}`
          }
          aria-describedby=""
          className={SWAP}
          onClick={() => enabled && onSwap()}
        >
          <span aria-hidden="true" className="tw-rotate-90 min-[860px]:tw-rotate-0">
            ⇄
          </span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>{enabled ? "Swap languages" : reason}</Tooltip.Content>
    </Tooltip.Root>
  );
}

function ViewToggle({
  view,
  onChange,
  defining,
}: {
  view: BandView;
  onChange: (v: BandView) => void;
  /** Whether the active language offers the defining view at all. */
  defining: boolean;
}) {
  return (
    <div>
      <SegmentedControl.Root aria-label="Band view" value={view} onValueChange={(v) => onChange(v as BandView)}>
        {/* Tooltip wraps the item itself — nesting a focusable inside the radio would
            be invalid, so we follow Fondue's SegmentedControl + Tooltip pattern.
            `aria-label` is not on Item's typed surface but is spread onto the button;
            without it the name doubles, since Fondue stacks an active and an inactive
            copy of the label to reserve the bold width and hides neither from AT. */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <SegmentedControl.Item value="cefr" {...({ "aria-label": "CEFR" } as object)}>
              CEFR
            </SegmentedControl.Item>
          </Tooltip.Trigger>
          <Tooltip.Content>{`${CEFR_TITLE} (CEFR) level`}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <SegmentedControl.Item value="freq" {...({ "aria-label": "Frequency" } as object)}>
              Frequency
            </SegmentedControl.Item>
          </Tooltip.Trigger>
          <Tooltip.Content>Rank by how often the word appears in film and TV subtitles</Tooltip.Content>
        </Tooltip.Root>
        {defining && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <SegmentedControl.Item value="defining" {...({ "aria-label": "Defining level" } as object)}>
                Defining level
              </SegmentedControl.Item>
            </Tooltip.Trigger>
            <Tooltip.Content>
              How heavily the dictionary leans on the word to define others — its own defining
              vocabulary
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </SegmentedControl.Root>
    </div>
  );
}

// Data sources credited beneath the browser. All of them, in full, so the attribution
// stays complete regardless of the active view — the ranking (frequency +
// lemmatization), the CEFR calibration, display casing, the defining levels with
// the works their method follows, and the word translations.
const CORPUS_LINK = "tw-underline hover:tw-text-primary";

/**
 * An abbreviation that is also a link — which every one of ours is. `title` on the
 * <abbr> is the whole mechanism: it draws the browser's own tooltip on hover, and it
 * sits in the accessibility tree whether or not anything is open or focused.
 *
 * No Fondue tooltip here, unlike elsewhere. One needs its own focusable trigger, which
 * made each credit two tab stops carrying the same name, and it would paint a second
 * tooltip over the native one saying the same words.
 */
function AbbrLink({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <a className={CORPUS_LINK} href={href} target="_blank" rel="noreferrer">
      <abbr title={title} className="tw-cursor-help tw-decoration-dotted">
        {children}
      </abbr>
    </a>
  );
}

function CorpusCredit({ source }: { source: SourceLang }) {
  const { corpus } = SOURCE_LANG_META[source];
  const name = englishName(source);
  return (
    <>
      Word frequencies from{" "}
      {source === "en" ? (
        <AbbrLink title={SUBTLEX_TITLE} href={corpus.url}>
          SUBTLEX-US
        </AbbrLink>
      ) : (
        <a className={CORPUS_LINK} href={corpus.url} target="_blank" rel="noreferrer">
          {corpus.name}
        </a>
      )}
      {source === "en" ? " (Brysbaert & New, 2009)" : null}, with inflections merged onto
      their base form via a{" "}
      {/* @spec CREDIT-4 */}
      <a className={CORPUS_LINK} href={LEMMA_URL} target="_blank" rel="noreferrer">
        lemmatization list
      </a>{" "}
      (
      <AbbrLink title={ODBL_TITLE} href={ODBL_URL}>
        ODbL 1.0
      </AbbrLink>
      )
      {/* Spelled out, not an Abbr: a tooltip expansion is unreachable by touch, and CEFR
          is the one abbreviation the UI labels words with. */}
      . CEFR ({CEFR_TITLE}) levels are estimated from frequency. The band boundaries are
      calibrated to the{" "}
      <AbbrLink title={CEFRJ_TITLE} href="https://www.cefr-j.org/">
        CEFR-J
      </AbbrLink>{" "}
      wordlist up to B2 and extrapolated above it
      {source !== "en" ? <> — an English-derived heuristic reused for {name}</> : null}.{" "}
      {/* @spec CREDIT-3 */}
      Display casing is measured from the{" "}
      <AbbrLink title={LEIPZIG_TITLE} href={LEIPZIG_URL}>
        Leipzig Corpora
      </AbbrLink>
      .{" "}
      {/* @spec CREDIT-1, CREDIT-2 */}
      {hasDefining(source) ? (
        <>
          Defining levels are computed from the{" "}
          <a
            className={CORPUS_LINK}
            href={`https://${source}.wiktionary.org/`}
            target="_blank"
            rel="noreferrer"
          >
            {name} Wiktionary
          </a>{" "}
          (
          <AbbrLink title={CC_BY_SA_TITLE} href={CC_BY_SA_URL}>
            CC BY-SA 4.0
          </AbbrLink>
          ), extracted by{" "}
          <a className={CORPUS_LINK} href={WIKTEXTRACT_URL} target="_blank" rel="noreferrer">
            Wiktextract
          </a>{" "}
          (Ylonen, 2022). The definitions are read as a graph of which word defines which, as
          in{" "}
          <a className={CORPUS_LINK} href={BLONDIN_MASSE_URL} target="_blank" rel="noreferrer">
            Blondin Massé et al. (2008)
          </a>{" "}
          and{" "}
          <a className={CORPUS_LINK} href={VINCENT_LAMARRE_URL} target="_blank" rel="noreferrer">
            Vincent-Lamarre et al. (2016)
          </a>
          . The levels come from that graph&rsquo;s k-core decomposition (
          <a className={CORPUS_LINK} href={SEIDMAN_URL} target="_blank" rel="noreferrer">
            Seidman, 1983
          </a>
          ). Restricted defining vocabularies go back to West &amp; Endicott (1935) and the{" "}
          <cite>Longman Dictionary of Contemporary English</cite> (1978).{" "}
        </>
      ) : null}
      Word translations come from{" "}
      <a className={CORPUS_LINK} href={TRANSLATE_URL} target="_blank" rel="noreferrer">
        Google Translate
      </a>
      .
    </>
  );
}

export default function Workspace({ country }: { country?: string | null }) {
  // A scenario carried in the URL wins over stored/default picks, so a shared deeplink
  // restores exactly what the sender saw. Read once, on mount.
  // @spec URL-5
  const initial = useRef(readScenario()).current;
  const browser = browserLang();

  const [source, setSourceState] = useState<SourceLang>(
    () => initial.source ?? storedSource() ?? sourceLang(country, browser) ?? DEFAULT_SOURCE,
  );
  const setSource = (l: SourceLang) => {
    setSourceState(l);
    try {
      window.localStorage.setItem(SOURCE_KEY, l);
    } catch {
      /* private mode / storage disabled — selection still applies for the session */
    }
  };

  // Target language, lifted out of the word card so it too rides in the URL. Only the
  // derived value steps aside from the source — an explicit pick is honoured as given.
  // Reading `source` here is safe: the initializer runs on the first render only.
  const [target, setTargetState] = useState<TargetLang>(
    () => initial.target ?? storedTarget() ?? targetLang(source, browser),
  );
  const setTarget = (l: TargetLang) => {
    setTargetState(l);
    try {
      window.localStorage.setItem(TARGET_KEY, l);
    } catch {
      /* private mode / storage disabled — selection still applies for the session */
    }
  };

  // The searched word drives the whole view, so its lookup lives here, above it.
  const [query, setQuery] = useState(() => initial.word ?? SOURCE_LANG_META[source].defaultWord);
  const [info, setInfo] = useState<WordBands | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starts true: the effect below looks the initial word up on mount straight away.
  const [loading, setLoading] = useState(true);
  // CEFR by default: a level is what a learner acts on, frequency the detail behind it.
  const [view, setView] = useState<BandView>(() => initial.view ?? "cefr");
  // The band tab the user explicitly picked; null follows the looked-up word's band.
  const [band, setBand] = useState<string | null>(() => initial.band ?? null);
  // Bumped whenever a language switch drops a word into the field that nobody asked for.
  // That tells the field to focus itself and select the word — see WordSearchBox.
  const [reseeded, setReseeded] = useState(0);

  // The source is passed explicitly so a language switch looks up the right dictionary
  // without waiting for the state update to settle — hence the shadowing. `bandOverride`
  // restores a pinned band from a shared link; a normal lookup follows the word's own (null).
  const lookup = useCallback(
    async (raw: string, source: SourceLang, bandOverride: string | null = null) => {
      const term = raw.trim().toLowerCase();
      // Nothing to look up is not a wait: `?word=%20` would otherwise leave the
      // card pending and the button disabled for good.
      if (!term) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/word/${encodeURIComponent(term)}?source=${source}`);
        if (!res.ok) {
          setError(`"${term}" is not in this dictionary`);
          return;
        }
        setError(null);
        const found = (await res.json()) as WordBands;
        setInfo(found);
        // Echo the corpus's display casing ("Plädoyer"), not the lowercased lookup key
        // — but only onto the word that was asked for. Typing carries on while a
        // lookup is in flight, and the field is the one thing the user is holding.
        setQuery((q) => (q.trim().toLowerCase() === term ? found.word : q));
        setBand(bandOverride);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial lookup, once, honouring the word + pinned band restored from the URL.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void lookup(query, source, initial.band ?? null);
  }, [lookup, source, query, initial.band]);

  // Mirror the scenario into the URL so learners can exchange deeplinks. Keyed on the
  // looked-up word (not the in-progress query), and only pins a band when it differs
  // from the word's own — an unchanged band is already implied by the word + view.
  useEffect(() => {
    if (!info) return;
    const anchor = info[view]?.key ?? null;
    writeScenario({
      source,
      word: info.word,
      target,
      view,
      band: band && band !== anchor ? band : null,
    });
  }, [source, target, view, band, info]);

  // Name the word in the tab title too, so a pinned tab or a bookmark says which one.
  useEffect(() => {
    document.title = pageTitle(info?.word);
  }, [info]);

  const chooseSource = (l: SourceLang) => {
    if (l === source) return;
    // Studying what you were translating into: the target takes the language just left,
    // rather than translating the new source language into itself.
    if (l === target) setTarget(source);
    setSource(l);
    const word = SOURCE_LANG_META[l].defaultWord;
    setQuery(word);
    // The switch is a prelude to looking a word up in the new language, and the word it
    // lands on is only a place to land: focus the field and select it, so the next
    // keystroke replaces it.
    setReseeded((n) => n + 1);
    void lookup(word, l);
  };

  // The translation's leading term, reported by the card — what a swap lands on.
  const [glossTerm, setGlossTerm] = useState<string | null>(null);
  // Whether the search field has room for the word's level beside it. Where it has not,
  // the card shows the level instead, so a narrow screen never loses it (WCAG 1.4.10).
  const [badgeFits, setBadgeFits] = useState(true);
  const canSwap = isSourceLang(target) && target !== source;

  // Study `to`, translating back into the language just left. Both languages move with
  // the word, so no render shows a word beside the wrong pair.
  const study = async (to: SourceLang, from: TargetLang, word: string) => {
    setSource(to);
    setTarget(from);
    setQuery(word);
    await lookup(word, to);
  };

  // Study the target language, translating back into the one just left. The word carries
  // over as its own translation where that is a word in the new language — a translation
  // can be a phrase ("to eat"), and phrases are not in the dictionary.
  const swap = async () => {
    if (!canSwap || !isSourceLang(target)) return;
    const to = target;
    const from = source;
    setLoading(true);
    let word = SOURCE_LANG_META[to].defaultWord;
    const seed = glossTerm?.trim().toLowerCase();
    if (seed && !seed.includes(" ")) {
      try {
        const res = await fetch(`/api/word/${encodeURIComponent(seed)}?source=${to}`);
        if (res.ok) word = seed;
      } catch {
        /* offline: the default word still gives a valid landing place */
      }
    }
    await study(to, from, word);
  };

  // The same move, aimed: the alternative that was clicked becomes the word being studied.
  // Unlike the swap above this needs no probe — the card only offers a term the target
  // language's own list vouched for, which is what gave it a level to show.
  const pickTerm = (term: string) => {
    if (!canSwap || !isSourceLang(target)) return;
    void study(target, source, term);
  };

  // Switching view shows the word's band in the new view — drop any pinned tab.
  const chooseView = (v: BandView) => {
    setView(v);
    setBand(null);
  };

  const sourceName = englishName(source);

  return (
    <div className="Workspace">
      {/* Hero: the word you ask for on the left, what it means on the right — two
          matching panels, each opening with its language. Stretched, not start-aligned,
          so the pair squares off. */}
      {/* Tighter above and below the card on a phone, where it is stacked, not beside. */}
      <div className="tw-mb-6 tw-grid tw-grid-cols-1 tw-gap-x-4 tw-gap-y-3 min-[700px]:tw-mb-12 min-[700px]:tw-gap-y-4 min-[860px]:tw-grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)]">
        <div className={PANEL}>
          {/* Language and word share one row at every width — the select is only wide
              enough for a code, and a phone has no line to spare for it alone. */}
          <div className="tw-flex tw-items-start tw-gap-2 min-[700px]:tw-gap-3">
            {/* Section headings (WCAG 2.4.10, 3.3.2). One heading over each control, so
                the heading is also the control's visible label — the selects show a
                code, which is their value, not their name. */}
            <section aria-labelledby="lang-heading">
              <h2 id="lang-heading" className={SECTION_HEADING}>
                Language
              </h2>
              <div className={PANEL_LANG}>
                <SourceSelect value={source} onChange={chooseSource} />
              </div>
              {/* aria-hidden, like the search help below: read once as the select's
                  description, rather than again as loose text in the section. */}
              <p id="lang-help" className="visually-hidden" aria-hidden="true">
                Choosing a language looks up an example word in it. The search box takes
                focus with that word selected, so typing replaces it.
              </p>
            </section>

            {/* Whatever the select leaves, which the field then shrinks into. */}
            <section aria-labelledby="search-heading" className="tw-min-w-0 tw-grow tw-basis-0">
              <h2 id="search-heading" className={SECTION_HEADING}>
                Look up a word
              </h2>
              <WordSearchBox
                value={query}
                onValueChange={setQuery}
                onSubmit={(w) => void lookup(w, source)}
                source={source}
                // Named by the heading above it rather than by a second copy of the same
                // string, which would then be free to drift from it.
                labelledBy="search-heading"
                describedBy="search-help"
                placeholder="look up a word…"
                busy={loading}
                // The one thing the page is for: it opens ready to be typed into.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                reseeded={reseeded}
                // Only while the field still holds the word this level belongs to.
                // Sitting against the text, it would otherwise read as a claim about
                // whatever is being typed over it.
                badge={
                  info && query.trim().toLowerCase() === info.word.toLowerCase()
                    ? (describedBy) => (
                        <CefrBadge
                          level={{ ...info.cefr, rank: info.rank }}
                          describedBy={describedBy}
                        />
                      )
                    : undefined
                }
                onBadgeFit={setBadgeFits}
              />
              {/* Context-sensitive help for the field (WCAG 3.3.5). aria-hidden so it is
                  read once, as the field's description — a hidden paragraph referenced by
                  aria-describedby still contributes its text, but stops being page content
                  a browse-mode reader meets a second time on the way past. */}
              <p id="search-help" className="visually-hidden" aria-hidden="true">
                Type a {sourceName} word to see its frequency and CEFR level. It is looked
                up as soon as you stop typing; press Enter or choose a suggestion to look
                one up at once.
              </p>
            </section>
          </div>

          {error && (
            <p className="tw-mt-3 tw-body-medium tw-text-error" role="alert">
              {error}
            </p>
          )}
          {/* @spec FORM-5, FORM-6
              The field is rewritten to the word that was found, so without this the
              typed word would simply vanish. It also keeps a wrong redirect legible as
              a redirect: the lemma lists lump some pronouns, so es "para" answers
              "parar", and that is worth showing rather than presenting as the answer.

              Always rendered, empty or not. A live region inserted in the same commit as
              its text is announced by some screen readers and not others, so the region
              has to be sitting there before the redirect happens. Preflight zeroes `p`
              margins, so the empty one takes no space, and the margin rides on the text.

              `status`, not `alert`: the card beside it is about to be read out anyway,
              and the word was found — there is nothing here to interrupt for. */}
          <p role="status">
            {!error && info?.from && (
              <span className="tw-mt-3 tw-block tw-body-medium tw-text-weak">
                {/* The two words are the source language inside an English sentence. */}
                Showing <b lang={source}>{info.word}</b>, the base form of{" "}
                “<span lang={source}>{info.from}</span>”.
              </span>
            )}
          </p>
        </div>

        <div className="tw-self-center tw-justify-self-center">
          <SwapButton enabled={canSwap} onSwap={() => void swap()} />
        </div>

        {/* Pending from the first paint, so the hero row is already its settled
            height; a failed lookup drops the frame and leaves the error alert. */}
        {(info || loading) && (
          <WordCard
            word={info?.word ?? query}
            // Only where the field has no room for it, and only while it is this word's
            // level: the same condition the field's own badge is given under.
            level={
              info && !badgeFits && query.trim().toLowerCase() === info.word.toLowerCase()
                ? { ...info.cefr, rank: info.rank }
                : undefined
            }
            forms={info?.forms ?? null}
            source={source}
            target={target}
            onTargetChange={setTarget}
            onGloss={setGlossTerm}
            // Only the six indexed languages can be studied, so only they are offered.
            onPickTerm={canSwap ? pickTerm : undefined}
          />
        )}
      </div>

      <section aria-labelledby="browse-heading">
        <h2 id="browse-heading" className={SECTION_HEADING}>
          Browse the vocabulary
        </h2>
        <BandBrowser
          view={view}
          source={source}
          anchorWord={info?.word ?? null}
          anchorBandKey={info?.[view]?.key ?? null}
          bandKey={band}
          onBandChange={setBand}
          // Into the field first, as every other way of picking a word does — the
          // lookup only corrects the casing on top of it.
          onSelect={(w) => {
            setQuery(w);
            void lookup(w, source);
          }}
          viewControl={<ViewToggle view={view} onChange={chooseView} defining={hasDefining(source)} />}
          // The figure only the defining view has: what the tabs below cannot show, which
          // is that frequency and defining level come apart.
          figure={
            view === "defining" ? (
              <DefiningScatter
                source={source}
                anchorWord={info?.word ?? null}
                onSelect={(w) => {
                  setQuery(w);
                  void lookup(w, source);
                }}
              />
            ) : undefined
          }
        />

        {/* Data-source credits / CEFR disclaimer, under the data they describe.
            line-height 1.5 for blocks of text (WCAG 1.4.8), capped at 80ch line length. */}
        <p
          className="tw-mt-3 tw-max-w-[80ch] tw-body-x-small text-muted-aaa"
          style={{ lineHeight: 1.5 }}
        >
          Sources: <CorpusCredit source={source} />
        </p>
      </section>
    </div>
  );
}
