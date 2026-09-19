"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { LoadingCircle, TextInput } from "@frontify/fondue/components";

// A typeahead <li role="option">, painted with Fondue tokens (per the ARIA combobox
// pattern the options carry the click handlers directly, not a nested control).
const OPTION =
  "tw-flex tw-min-h-[44px] tw-w-full tw-items-center tw-px-3 tw-py-1.5 tw-text-x-large tw-text-left tw-transition-colors";
const SUGGEST_DEBOUNCE_MS = 500;

// Where the field's text begins, from the wrapper's edge: the root's 1px border plus the
// input's 12px padding. Both belong to Fondue's CSS module, whose class is a build hash,
// so the overlay mirrors the numbers rather than reading them.
const TEXT_INSET = 13;

/**
 * A word-lookup field with a debounced (500ms) typeahead dropdown backed by
 * /api/suggest. Controlled: the parent owns the text `value`; `onSubmit` fires
 * when a word is committed — a suggestion picked, Enter, the form submitted, or
 * typing that settles on a word the corpus already knows.
 */
export default function WordSearchBox({
  value,
  onValueChange,
  onSubmit,
  source,
  labelledBy,
  describedBy,
  placeholder,
  busy = false,
  autoFocus = false,
  reseeded = 0,
  badge,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (word: string) => void;
  /** Source language whose vocabulary to suggest from. */
  source: string;
  /** Id of the element naming the field — its section heading, rather than a second copy. */
  labelledBy: string;
  describedBy?: string;
  placeholder: string;
  /** Lookup in flight: shows the field's spinner. */
  busy?: boolean;
  /** Take focus on mount, with the current value selected. */
  autoFocus?: boolean;
  /**
   * Bumped by the caller when it has replaced the value with a word the user did not ask
   * for — the default word a language switch lands on. The field then focuses itself and
   * selects that word, as it does on mount. Only where `autoFocus` is on.
   */
  reseeded?: number;
  /**
   * Trailed just after the field's text, inside the box. Only pass it for something that
   * describes *this* text — it is laid out against the current value, so a caller must
   * withhold it while the two have drifted apart.
   *
   * Called with the id of the run holding the word, so a badge can point at it and say
   * what it is a badge *of* when focus lands on it alone.
   */
  badge?: ((describedBy: string) => ReactNode) | undefined;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every suggest/commit so a slow in-flight response can't clobber
  // the dropdown after the user has moved on.
  const suggestSeq = useRef(0);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;
  // The mirror below holds the word, which is what the badge beside it annotates.
  const wordId = `${listboxId}-word`;

  // The badge is laid out after a hidden copy of the text, so it lands where the text
  // ends without anything being measured — and re-flows by itself when the webfont
  // arrives. A long word can still leave it no room; `fits` is what notices.
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  // Hidden, the badge keeps its slot, so the measurement can't oscillate with the answer.
  const measure = useCallback(() => {
    const el = overlayRef.current;
    if (el) setFits(el.scrollWidth <= el.clientWidth);
  }, []);
  useLayoutEffect(measure, [measure, value, !!badge]);
  // Every glyph is wider once Diatype replaces the fallback, which can be the difference.
  useEffect(() => {
    void document.fonts?.ready.then(measure);
  }, [measure]);

  // Fondue paints the placeholder into a sibling div (see globals.css) and hides it from
  // no one, so its text was read as loose content inside the search landmark. Matched by
  // structure, like the stylesheet does — the CSS module's class is a build hash.
  useLayoutEffect(() => {
    wrapRef.current
      ?.querySelector("div:has(> input) > div:first-child")
      ?.setAttribute("aria-hidden", "true");
  });

  // The badge covers the few pixels just past the word — where a click means "put the
  // caret at the end". Do that, rather than swallowing it.
  const caretToEnd = () => {
    const input = wrapRef.current?.querySelector("input");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  // Selected, not just focused: the field lands holding a word already, so the first
  // keystroke means a new one. It re-selects while that word is still what the field
  // holds, because the lookup echoes the corpus's casing back into it ("wasser" →
  // "Wasser") and that collapses the selection. Once focus has been given away, or the
  // text is no longer that word, the field is the user's — hands off.
  const seeded = useRef(value);
  const grab = useRef<"pending" | "held" | "released">("pending");
  const reseeds = useRef(reseeded);
  useEffect(() => {
    // A language switch leaves the field on that language's default word, which nobody
    // asked for any more than the word the page opens on — so focus and the selection are
    // taken again, wherever focus had got to. It goes by the caller's bump and not by
    // `source` changing: a swap turns the languages over too, and the word that one
    // carries across is the one the learner was reading.
    if (reseeded !== reseeds.current) {
      reseeds.current = reseeded;
      grab.current = "pending";
    }
    if (!autoFocus || grab.current === "released") return;
    const input = wrapRef.current?.querySelector("input");
    if (!input) return;
    // A fresh grab takes whatever word it was handed; after that the field is only taken
    // back while it still holds that word.
    if (grab.current === "pending") seeded.current = value;
    const mine =
      value.toLowerCase() === seeded.current.toLowerCase() &&
      (grab.current === "pending" || document.activeElement === input);
    // Released for good, so retyping that word later can't select it again.
    if (!mine) {
      grab.current = "released";
      return;
    }
    grab.current = "held";
    input.focus();
    input.select();
  }, [autoFocus, value, reseeded]);

  // Clicking into the field means a new word far more often than an edit inside the one
  // it holds, so the click that focuses it takes the whole value. Armed on mousedown and
  // spent on mouseup: selecting any earlier is undone by the caret the click places.
  const takeAll = useRef(false);
  const onInputMouseDown = (e: MouseEvent<HTMLInputElement>) => {
    takeAll.current = document.activeElement !== e.currentTarget;
  };
  const onInputMouseUp = (e: MouseEvent<HTMLInputElement>) => {
    if (!takeAll.current) return;
    takeAll.current = false;
    // A drag has already picked a range, and that one was asked for by hand.
    if (e.currentTarget.selectionStart === e.currentTarget.selectionEnd) e.currentTarget.select();
  };

  const closeSuggestions = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestSeq.current++;
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
    setActiveIndex(-1);
  }, []);

  const fetchSuggestions = useCallback(
    async (raw: string) => {
      const term = raw.trim();
      if (!term) return closeSuggestions();
      const reqId = ++suggestSeq.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(term)}&source=${source}`);
        if (!res.ok || reqId !== suggestSeq.current) return;
        const words = (await res.json()) as string[];
        if (reqId !== suggestSeq.current) return; // superseded while fetching
        setSuggestions(words);
        setActiveIndex(-1);
        setOpen(words.length > 0);
        // Typing has settled on a word the corpus knows, so look it up unasked —
        // no button to press, and no failed lookup to report, since the suggestion
        // is the proof it exists (an exact match leads the list, see getSuggestions).
        // The dropdown stays up: it is also the way from "water" to "waterfall".
        if (words[0] && words[0].toLowerCase() === term.toLowerCase()) onSubmit(words[0]);
      } catch {
        /* a failed suggest fetch just leaves the dropdown as-is */
      } finally {
        // Only the latest request owns the spinner; a superseded one leaves it on.
        if (reqId === suggestSeq.current) setLoading(false);
      }
    },
    [closeSuggestions, source, onSubmit],
  );

  const onQueryChange = useCallback(
    (next: string) => {
      onValueChange(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!next.trim()) return closeSuggestions();
      debounceRef.current = setTimeout(() => void fetchSuggestions(next), SUGGEST_DEBOUNCE_MS);
    },
    [onValueChange, fetchSuggestions, closeSuggestions],
  );

  // Asking for a word outright, as opposed to the auto-lookup above: the field takes
  // the word straight away rather than waiting on the fetch, and the list is done.
  const commit = useCallback(
    (word: string) => {
      onValueChange(word);
      closeSuggestions();
      onSubmit(word);
    },
    [onValueChange, closeSuggestions, onSubmit],
  );

  const onInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        if (!open && suggestions.length > 0) setOpen(true);
        else if (open) setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        if (open) {
          setActiveIndex((i) => Math.max(i - 1, 0));
          e.preventDefault();
        }
      } else if (e.key === "Enter") {
        // Pick the highlighted suggestion; otherwise let the form submit `value`.
        if (open && activeIndex >= 0 && suggestions[activeIndex]) {
          e.preventDefault();
          commit(suggestions[activeIndex]);
        }
      } else if (e.key === "Escape" && open) {
        closeSuggestions();
      }
    },
    [open, activeIndex, suggestions, commit, closeSuggestions],
  );

  // Cancel a pending debounce if the box unmounts mid-type (e.g. a tab switch).
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // A language switch drops whatever the last keystroke asked for: those suggestions
  // come from the vocabulary just left, and the lookup they would trigger with them.
  // A no-op on mount, where there is nothing pending.
  useEffect(() => {
    closeSuggestions();
  }, [source, closeSuggestions]);

  return (
    // No submit button: typing that settles on a word looks it up, and Enter still
    // submits implicitly for the rest. `flex` so the field shrinks below its
    // 40-character intrinsic width on a narrow panel instead of overflowing.
    <form
      className="tw-flex"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      {/* Stay clear of the ≥16px that keeps iOS from zooming on focus — Fondue's
          body-small (~13px) would trigger it. The placeholder is a separate element,
          sized in globals.css. */}
      <div ref={wrapRef} className="tw-relative tw-w-fit [&_input]:tw-text-x-large">
        <TextInput.Root
          // TextInput.Root forwards unknown props to its <input> but omits the
          // combobox ARIA from its typed surface; attach them via a plain spread.
          {...({
            role: "combobox",
            "aria-autocomplete": "list",
            "aria-expanded": open,
            "aria-controls": listboxId,
            "aria-describedby": describedBy,
            "aria-activedescendant": open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
            // Size the field to hold ~40 characters (HTML `size` → intrinsic width);
            // the tw-w-fit wrapper then hugs it instead of stretching to the row.
            // `size` is forwarded to the <input> at runtime but absent from Fondue's types.
            size: 40,
            // The word in the field is the source language's, not the page's.
            lang: source,
            onMouseDown: onInputMouseDown,
            onMouseUp: onInputMouseUp,
          } as object)}
          aria-labelledby={labelledBy}
          value={value}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          autoComplete="off"
          placeholder={placeholder}
          spellCheck={false}
        />
        {/* Trails the word inside the field. Stood down whenever the spinner is up: the
            two share the same strip of the box, and mid-lookup the level is unknown
            anyway. The mirror is `invisible` rather than hidden text, so it takes the
            text's exact width while staying out of the accessibility tree. */}
        {badge && !loading && !busy && (
          <div
            ref={overlayRef}
            className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-flex tw-items-center tw-overflow-hidden tw-text-x-large"
            style={{ left: 0, right: TEXT_INSET, paddingLeft: TEXT_INSET }}
          >
            {/* One inline run, so the badge takes the word's baseline rather than being
                centred against it on its own — the flex row only centres the run. */}
            <div className="tw-whitespace-pre">
              <span id={wordId} className="tw-invisible">
                {value}
              </span>
              {/* A mouse affordance over a native input, not a control: it puts the
                  caret where a click past the word means. The keyboard has End. */}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <span
                className={`tw-pointer-events-auto ${fits ? "" : "tw-invisible"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  caretToEnd();
                }}
              >
                {badge(wordId)}
              </span>
            </div>
          </div>
        )}
        {/* One spinner for both waits — suggesting and looking up run into each other,
            and which one you are in is not a distinction worth drawing. Decorative:
            the result is what gets announced, by the card's live region. */}
        {(loading || busy) && (
          <div
            aria-hidden="true"
            className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-3 tw-flex tw-items-center"
          >
            <LoadingCircle size="x-small" />
          </div>
        )}
        {open && suggestions.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Word suggestions"
            lang={source}
            className="tw-absolute tw-inset-x-0 tw-top-full tw-z-20 tw-mt-1 tw-max-h-64 tw-overflow-auto tw-rounded-large tw-border tw-border-line-subtle tw-bg-surface tw-py-1 tw-shadow-mid"
          >
            {suggestions.map((w, i) => (
              // The combobox pattern keeps the keys on the input and points
              // aria-activedescendant here, so an option needs no listener of its own.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={w}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                // The fill alone changes by 1.14:1 in light, so the outline is what
                // carries the highlight (1.4.11). Inset, so the row keeps its size.
                className={`${OPTION} tw-cursor-pointer ${
                  i === activeIndex
                    ? "tw-bg-surface-hover tw-text-primary tw-outline tw-outline-[length:2px] " +
                      "tw-outline-offset-[-2px] tw-outline-[color:var(--cue-line)]"
                    : "tw-text-secondary hover:tw-bg-surface-hover hover:tw-text-primary"
                }`}
                // Keep focus on the input so onBlur doesn't close us before onClick.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(w)}
              >
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
