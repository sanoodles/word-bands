"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Select } from "@frontify/fondue/components";
import Loading from "@/components/Loading";
import WordChips from "@/components/WordChips";
import type { Band, BandSummary, BandView } from "@/lib/types";

// Word pills, painted with Fondue tokens; the anchor variant marks the looked-up word.
// Sized for comfortable scanning of dozens of words at a time (bigger hit target
// and readable type, not the minimal 24px pill).
const CHIP_BASE =
  "tw-inline-flex tw-items-center tw-min-h-[40px] tw-rounded-full tw-border tw-px-4 tw-py-2 " +
  "tw-body-large tw-transition-colors";
const CHIP =
  `${CHIP_BASE} tw-border-line-subtle tw-bg-surface-hover tw-text-secondary ` +
  "hover:tw-bg-surface-active hover:tw-text-primary";
// The accent fill separates it from the other chips by only 1.42:1 in light, so the
// border rather than the fill is what marks it there (1.4.1, 1.4.11).
const CHIP_ANCHOR =
  `${CHIP_BASE} tw-border-[color:var(--cue-line)] tw-bg-[color:var(--accent-focus)] ` +
  "tw-font-medium tw-text-[#0b1220]";

const STEP =
  "tw-flex tw-min-h-[44px] tw-flex-1 tw-items-center tw-justify-center tw-gap-1 tw-rounded-full " +
  "tw-border tw-border-line-subtle tw-px-4 tw-body-large tw-text-secondary tw-transition-colors " +
  "hover:tw-border-line hover:tw-text-primary " +
  "aria-disabled:tw-cursor-not-allowed aria-disabled:tw-opacity-40 " +
  "aria-disabled:hover:tw-border-line-subtle aria-disabled:hover:tw-text-secondary";

/**
 * Walk the band one word at a time, for phones — where reaching the next word
 * otherwise means hunting for its chip in the cloud. Mobile-only; on a desktop
 * the cloud is fully visible and the chips are the faster route.
 *
 * With no current word (the band was picked by hand, so it holds no anchor),
 * Next enters at the band's first word.
 */
function StepButtons({
  words,
  current,
  onSelect,
}: {
  words: string[];
  current: string | null;
  onSelect: (word: string) => void;
}) {
  const i = current ? words.indexOf(current) : -1;
  const prev = i > 0 ? words[i - 1] : undefined;
  const next = i < words.length - 1 ? words[i + 1] : undefined;
  return (
    <div className="tw-mb-3 tw-flex tw-gap-2 min-[700px]:tw-hidden">
      {/* aria-disabled, not disabled: the step that runs out at a band's end would
          otherwise turn unfocusable under the finger already on it, dropping focus to
          the body (WCAG 2.4.3). The same trade SwapButton makes. */}
      <button
        type="button"
        className={STEP}
        aria-disabled={!prev}
        onClick={() => prev && onSelect(prev)}
        aria-label="Previous word in this band"
      >
        <span aria-hidden="true">←</span> Previous
      </button>
      <button
        type="button"
        className={STEP}
        aria-disabled={!next}
        onClick={() => next && onSelect(next)}
        aria-label="Next word in this band"
      >
        Next <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

/**
 * Browse the whole vocabulary split into bands for the active view. The band
 * holding the looked-up word (`anchorBandKey`) opens automatically and spotlights
 * it; picking any chip looks that word up via `onSelect`.
 */
export default function BandBrowser({
  view,
  source,
  anchorWord,
  anchorBandKey,
  bandKey = null,
  onBandChange,
  onSelect,
  viewControl,
  figure,
}: {
  view: BandView;
  /** Source language whose bands to browse. */
  source: string;
  anchorWord: string | null;
  anchorBandKey: string | null;
  /** Explicitly-picked band tab (controlled); null follows the anchor, then the first. */
  bandKey?: string | null;
  /** Reports a user's tab pick, so the parent can reflect it in the URL. */
  onBandChange?: (key: string) => void;
  onSelect: (word: string) => void;
  /** The frequency/CEFR switch, hosted in this panel's header alongside the bands. */
  viewControl?: ReactNode;
  /** A view's figure, drawn above its word list. Only the defining view has one. */
  figure?: ReactNode;
}) {
  const [summary, setSummary] = useState<BandSummary[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(bandKey);
  const [band, setBand] = useState<Band | null>(null);
  // Warm-cache bands by `view:key` so re-selecting is instant.
  const cache = useRef<Record<string, Band>>({});
  // The tabs name the panel they open, so both need stable ids.
  const baseId = useId();
  const tabId = (key: string) => `${baseId}-tab-${key}`;
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Load the summary (the tabs) whenever the view or source language changes.
  useEffect(() => {
    let live = true;
    setSummary(null);
    setBand(null);
    void fetch(`/api/bands/${view}?source=${source}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => live && s && setSummary(s as BandSummary[]));
    return () => {
      live = false;
    };
  }, [view, source]);

  // Show the explicitly-picked band; else the anchor's band; else the first.
  useEffect(() => {
    if (!summary) return;
    const keys = summary.map((b) => b.key);
    setSelectedKey(
      bandKey && keys.includes(bandKey)
        ? bandKey
        : anchorBandKey && keys.includes(anchorBandKey)
          ? anchorBandKey
          : (keys[0] ?? null),
    );
  }, [summary, bandKey, anchorBandKey]);

  const pickBand = (key: string) => {
    setSelectedKey(key);
    onBandChange?.(key);
  };

  // A tablist is one tab stop with arrow keys inside it, not a row of separate stops —
  // which is what the role promises a screen reader. Activation follows focus, since the
  // band is already fetched or cached by the time the next key lands.
  const onTabsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!summary) return;
    const keys = summary.map((b) => b.key);
    const i = keys.indexOf(selectedKey ?? "");
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % keys.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + keys.length) % keys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    else return;
    e.preventDefault();
    const key = keys[next];
    if (!key) return;
    pickBand(key);
    tabRefs.current[key]?.focus();
  };

  const fetchBand = useCallback(
    async (key: string) => {
      const ck = `${source}:${view}:${key}`;
      const hit = cache.current[ck];
      if (hit) {
        setBand(hit);
        return;
      }
      const res = await fetch(`/api/band/${view}/${encodeURIComponent(key)}?source=${source}`);
      if (!res.ok) return;
      const b = (await res.json()) as Band;
      cache.current[ck] = b;
      setBand(b);
    },
    [view, source],
  );

  useEffect(() => {
    if (selectedKey) void fetchBand(selectedKey);
  }, [selectedKey, fetchBand]);

  // Spotlight the anchor only in the band it actually belongs to.
  const anchorInBand = band && band.key === anchorBandKey ? anchorWord : null;
  const bandsLabel =
    view === "cefr" ? "CEFR levels" : view === "defining" ? "Defining levels" : "Frequency bands";

  return (
    // Full-bleed on a phone: the side gutter is 12px the cloud cannot use, and this is
    // the one block that wants every pixel of width. It gives the chips 270 -> 296 at
    // 320px, which is 2.69 words a row rather than 2.46. The heading above keeps the
    // gutter, so only the panel runs to the edge.
    <div
      className={
        "BandBrowser -tw-mx-3 tw-border-y tw-border-line-subtle tw-bg-surface " +
        "min-[700px]:tw-mx-0 min-[700px]:tw-rounded-x-large min-[700px]:tw-border"
      }
    >
      {/* Controls header: the view switch over a horizontal row of band tabs. */}
      <div className="tw-flex tw-flex-col tw-gap-3 tw-border-b tw-border-line-subtle tw-p-3 min-[700px]:tw-p-4">
        {viewControl}
        {/* One spinner for both controls, reserving whichever will replace it: the
            dropdown is 44px, a band tab 46 (two lines over py-1.5, plus the gap). */}
        {summary === null ? (
          <Loading
            size="x-small"
            label="Loading bands…"
            className="tw-min-h-[44px] min-[700px]:tw-min-h-[46px]"
          />
        ) : (
          <>
            {/* Phones get a dropdown: a dozen band tabs wrap into a wall several rows deep
                that pushes the words themselves off-screen. Only one of the two renders. */}
            <div className="[&_[role=combobox]]:tw-min-h-[44px] min-[700px]:tw-hidden">
              <Select
                aria-label={bandsLabel}
                value={selectedKey ?? ""}
                onSelect={(v) => v && pickBand(v)}
                showStringValue
              >
                {summary.map((b) => (
                  <Select.Item key={b.key} value={b.key} label={b.label}>
                    <span className="tw-flex tw-items-baseline tw-gap-2">
                      <span>{b.label}</span>
                      <span className="tw-tabular-nums tw-body-x-small text-muted-aaa">
                        {b.count.toLocaleString()} words
                      </span>
                    </span>
                  </Select.Item>
                ))}
              </Select>
            </div>
            {/* The tabs carry the tabindex, not the tablist — that is what roving
                tabindex is, and the rule cannot see across to the children. */}
            {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
            <div
              role="tablist"
              aria-label={bandsLabel}
              aria-orientation="horizontal"
              onKeyDown={onTabsKeyDown}
              className="tw-hidden tw-flex-row tw-flex-wrap tw-gap-1.5 min-[700px]:tw-flex"
            >
              {summary.map((b) => {
                const active = b.key === selectedKey;
                return (
                  <button
                    key={b.key}
                    type="button"
                    role="tab"
                    id={tabId(b.key)}
                    aria-selected={active}
                    aria-controls={panelId}
                    // The two lines below join with no separator in the name computation
                    // ("A1 · Beginner1,000 words"), so the name is spelled out instead.
                    aria-label={`${b.label}, ${b.count.toLocaleString()} words`}
                    tabIndex={active ? 0 : -1}
                    ref={(node) => {
                      tabRefs.current[b.key] = node;
                    }}
                    onClick={() => pickBand(b.key)}
                    // The border is on every tab, transparent when unselected, so
                    // selecting one shifts nothing.
                    className={
                      "tw-flex tw-min-h-[44px] tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-rounded-[8px] tw-border tw-px-3 tw-py-1.5 tw-text-left tw-transition-colors " +
                      (active
                        ? "tw-border-[color:var(--cue-line)] tw-bg-surface-hover tw-text-primary"
                        : "tw-border-[color:transparent] text-muted-aaa hover:tw-bg-surface-hover hover:tw-text-primary")
                    }
                  >
                    <span className="tw-body-small tw-whitespace-nowrap">{b.label}</span>
                    {/* Count inherits the tab's text color so it stays ≥7:1 in every
                        state, active or not (WCAG 1.4.6). */}
                    <span className="tw-tabular-nums tw-body-x-small tw-opacity-90">
                      {b.count.toLocaleString()} words
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={selectedKey ? tabId(selectedKey) : undefined}
        className="tw-min-w-0 tw-px-3 tw-py-4 min-[700px]:tw-px-5"
      >
        {figure && <div className="tw-mb-4">{figure}</div>}
        {band ? (
          <>
            <StepButtons words={band.words} current={anchorInBand} onSelect={onSelect} />
            <WordChips
              words={band.words}
              anchor={anchorInBand}
              chipClass={CHIP}
              anchorClass={CHIP_ANCHOR}
              onPick={onSelect}
              label={`Words in ${band.label}, most frequent first`}
              lang={source}
            />
          </>
        ) : (
          <Loading className="tw-min-h-[200px] tw-justify-center" label="Loading band…" />
        )}
      </div>
    </div>
  );
}
