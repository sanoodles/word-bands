"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeToggle } from "@/app/providers";
import Loading from "@/components/Loading";
import { DEFINING_EXAMPLE, type SourceLang } from "@/lib/languages";

/**
 * The defining view's figure: every levelled word as a point, frequency across, defining
 * level up. The tabs below are the browse surface and the accessible one; this says the
 * thing the tabs cannot, which is that the two axes come apart. Read one vertical slice —
 * one CEFR stripe, words of near-equal frequency — and the points still spread over every
 * level. That separation is the whole claim the view rests on.
 *
 * Deliberately not zoomable. The prototype's pan, box-zoom and full-screen exist to hunt
 * individual words; here the tabs below do that better, with a keyboard and a screen
 * reader, so the figure stays one static picture and one click target.
 */

/**
 * The CEFR bands as `cefrBands` cuts them, each with the rank it tops out at; C2 runs to
 * the end of whatever the language ranks, so it has none. Marked by the vertical lines
 * and named under them, because a band nobody can name is just a gap between two lines.
 */
const CEFR_BANDS: { key: string; max: number | null }[] = [
  { key: "A1", max: 1000 },
  { key: "A2", max: 3000 },
  { key: "B1", max: 6000 },
  { key: "B2", max: 12000 },
  { key: "C1", max: 25000 },
  { key: "C2", max: null },
];
const LEVELS = 7;
// Two label rows sit under the plot: the ranks the stripes break at, then the band names.
const PAD = { top: 10, right: 12, bottom: 40, left: 38 };
/** Point radius, and the hit radius around the pointer, in CSS pixels. */
const DOT = 1.6;
/**
 * Ink alphas, per theme. A point is the one thing here that cannot simply be darkened to
 * 3:1 (1.4.11): the cloud is the message, and at full ink the dense rows fill in solid.
 * These are the darkest that leave the spread readable, checked by eye in both themes.
 * `p3-states.mjs figure` recomputes its numbers from them — change both together.
 */
const ALPHA = {
  point: { dark: 0.5, light: 0.72 },
  edge: { dark: 0.55, light: 0.72 },
};
const HIT = { mouse: 7, finger: 22 };
/** Whether the reader has folded the caption away. Absent until they touch it. */
const CAPTION_KEY = "word-bands:defining-caption";

function readCaptionPref(): boolean | null {
  try {
    const v = localStorage.getItem(CAPTION_KEY);
    return v === "open" ? true : v === "closed" ? false : null;
  } catch {
    return null;
  }
}

const wideEnoughForCaption = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 700px)").matches;

/** Rough height of the pointer cursor's glyph, and of the hover label. */
const CURSOR = 22;
const TIP_H = 26;

interface Points {
  /** One char per ranked word: "1"-"7", or "-" for a word with no level. */
  levels: string;
  words: string[];
}

/** The plot's size in CSS pixels, which is all the scales below need. */
interface Plot {
  w: number;
  h: number;
}

function xOf(rank: number, w: number, total: number): number {
  // Square root, not log: log gives ranks 1-1,000 two thirds of the width. Sqrt gives
  // each CEFR band a roughly equal share of it, which is what makes a stripe readable.
  const t = Math.sqrt(rank) / Math.sqrt(total);
  return PAD.left + t * (w - PAD.left - PAD.right);
}

function yOf(level: number, off: number, h: number): number {
  const band = (h - PAD.top - PAD.bottom) / LEVELS;
  return PAD.top + (level - 0.5) * band + off * band * 0.7;
}

/**
 * Stable per-word vertical offset inside its level band. The level is 7 discrete values,
 * so without this every point stacks on seven straight lines and the density is invisible.
 * Hashed from the word rather than random, so points never move between repaints.
 */
function jitter(word: string): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (Math.imul(h, 31) + word.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/**
 * Every label the figure carries, as HTML over the canvas: the levels down the gutter, and
 * under the plot the ranks the bands break at and the band names. Drawn into the canvas
 * these were images of text — 2.29:1 in light, blind to a text-spacing override, and gone
 * at any zoom the browser does in text alone.
 *
 * Positioned from the same geometry the points are, so a label sits on its own row or
 * column whatever the figure is resized to.
 */
function Labels({ size, total }: { size: Plot; total: number }) {
  const { w, h } = size;
  const edges = [0, ...CEFR_BANDS.map((b) => b.max ?? total)];
  const xAt = (rank: number) => xOf(rank, w, total);
  // Everything in the gutter ends on the same line, 6px off the plot, so the corner reads
  // as one column of labels rather than three things that happen to be on the left.
  const gutter = PAD.left - 6;
  const rankRow = h - PAD.bottom + 5;
  const bandRow = rankRow + 14;
  const label = "tw-absolute tw-whitespace-nowrap tw-body-x-small text-muted-aaa";
  const atRight = { transform: "translateX(-100%)" };
  return (
    // Names the rows it is made of; the canvas beside it carries the whole claim.
    <div aria-hidden="true" className="tw-pointer-events-none tw-absolute tw-inset-0">
      {Array.from({ length: LEVELS }, (_, i) => i + 1).map((l) => (
        <span
          key={l}
          className={label}
          style={{ left: gutter, top: yOf(l, 0, h), transform: "translate(-100%, -50%)" }}
        >
          D{l}
        </span>
      ))}
      {/* Every break but the last: the right edge is wherever the list ends, not a
          boundary. The gutter names the row, because "6k" alone reads as a quantity of
          something — it is a place in the order, which is the whole of what the axis says. */}
      <span className={label} style={{ left: gutter, top: rankRow, ...atRight }}>
        rank
      </span>
      {edges.slice(1, -1).map((r) => (
        <span
          key={r}
          className={label}
          style={{ left: xAt(r), top: rankRow, transform: "translateX(-50%)" }}
        >
          {r >= 1000 ? `${r / 1000}k` : r}
        </span>
      ))}
      <span className={label} style={{ left: gutter, top: bandRow, ...atRight }}>
        CEFR
      </span>
      {/* Heavier than the row above, which is the pair's order: the band name is what ties
          a stripe to the CEFR tab. Weight rather than a second colour, so both rows can
          hold 7:1 (1.4.6). */}
      {CEFR_BANDS.map((b, i) => (
        <span
          key={b.key}
          className={`${label} tw-font-medium`}
          style={{
            left: (xAt(edges[i]!) + xAt(edges[i + 1]!)) / 2,
            top: bandRow,
            transform: "translateX(-50%)",
          }}
        >
          {b.key}
        </span>
      ))}
    </div>
  );
}

/**
 * The plotted word nearest a point, within `r` px, or null. Pure and exported for the
 * same reason `tipStyle` is: jsdom has no layout, so the figure never paints in a test and
 * this is the only way to prove what a pointer lands on.
 */
export function nearestWord(
  points: Points,
  plot: Plot,
  px: number,
  py: number,
  r: number,
): string | null {
  const total = points.words.length;
  let best: { word: string; d: number } | null = null;
  for (let i = 0; i < total; i++) {
    const c = points.levels[i]!;
    if (c === "-") continue;
    const dx = xOf(i + 1, plot.w, total) - px;
    if (dx > r || dx < -r) continue;
    const word = points.words[i]!;
    const dy = yOf(+c, jitter(word), plot.h) - py;
    const d = dx * dx + dy * dy;
    if (d <= r * r && (!best || d < best.d)) best = { word, d };
  }
  return best?.word ?? null;
}

/**
 * Where the hover label sits relative to the cursor. Above it, not below: a cursor's
 * hotspot is its top-left corner and the glyph hangs down and to the right of that, so
 * anything placed below-right is drawn under the cursor itself. The pointer cursor this
 * canvas switches to is the bigger of the two, about 22px tall, which is what CURSOR
 * clears. Flips below only in the top strip, where there is no room above.
 */
export function tipStyle(hover: { x: number; y: number }, wrapWidth: number): React.CSSProperties {
  const flipX = hover.x > wrapWidth * 0.66;
  const flipY = hover.y < CURSOR + TIP_H;
  return {
    left: hover.x + (flipX ? -8 : 8),
    top: hover.y + (flipY ? CURSOR : -8),
    transform: `${flipX ? "translateX(-100%)" : ""} ${flipY ? "" : "translateY(-100%)"}`.trim(),
  };
}

export default function DefiningScatter({
  source,
  anchorWord,
  onSelect,
}: {
  source: SourceLang;
  /** The looked-up word, drawn in the accent colour so it can be found in the cloud. */
  anchorWord: string | null;
  onSelect: (word: string) => void;
}) {
  const { resolvedTheme } = useThemeToggle();
  // Read once, on the first client render, so the fold never flashes open then shut.
  // A stored choice wins; failing that, a wide screen has room to start open and a phone
  // does not — which is the whole reason this folds.
  const [captionOpen, setCaptionOpen] = useState(() => {
    const stored = readCaptionPref();
    return stored ?? wideEnoughForCaption();
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [points, setPoints] = useState<Points | null>(null);
  const [hover, setHover] = useState<{ word: string; x: number; y: number } | null>(null);
  // Plot geometry, kept from the last paint so hit-testing measures against what is drawn.
  const plot = useRef<Plot | null>(null);
  // The same geometry as state, because the labels are HTML and render from it.
  const [size, setSize] = useState<Plot | null>(null);
  // How close a pointer has to land, set on pointerdown: the click event itself is a plain
  // MouseEvent in some browsers, with no pointer type left on it to read.
  const reach = useRef(HIT.mouse);

  // ~165KB gzipped, so it is fetched when the view is opened and not before. Nothing else
  // in the app needs the whole ranking client-side.
  useEffect(() => {
    let live = true;
    setPoints(null);
    void fetch(`/api/defining?source=${source}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => live && p && setPoints(p as Points));
    return () => {
      live = false;
    };
  }, [source]);

  const firstCaptionRender = useRef(true);
  useEffect(() => {
    if (firstCaptionRender.current) {
      firstCaptionRender.current = false;
      return;
    }
    try {
      localStorage.setItem(CAPTION_KEY, captionOpen ? "open" : "closed");
    } catch {
      // A private window can refuse storage. The fold still works, it just forgets.
    }
  }, [captionOpen]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !points) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ink = getComputedStyle(canvas).color;
    const dark = resolvedTheme === "dark";
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--accent-focus").trim() ||
      "#f5c542";
    const total = points.words.length;

    // CEFR bands, drawn as the line between one and the next rather than as alternating
    // fills: the fill was a 1.10:1 shade, and what it was for is the boundary.
    const edges = [0, ...CEFR_BANDS.map((b) => b.max ?? total)];
    const xAt = (rank: number) => xOf(rank, w, total);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = dark ? ALPHA.edge.dark : ALPHA.edge.light;
    ctx.lineWidth = 1;
    for (let i = 1; i < edges.length - 1; i++) {
      // Half-pixel, or a 1px line straddles two columns and renders as a 2px grey smear.
      const x = Math.round(xAt(edges[i]!)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, h - PAD.bottom);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Every label is HTML over the canvas (see `Labels`): drawn here they were images of
    // text — 2.29:1 in light, ignoring a text-spacing override, and unscalable.

    // The points. One ink colour, not a ramp per level: the y position already encodes the
    // level, and the pale end of a ramp disappears against the ground.
    const anchor = anchorWord?.toLowerCase() ?? null;
    let anchorAt: [number, number] | null = null;
    ctx.fillStyle = ink;
    ctx.globalAlpha = dark ? ALPHA.point.dark : ALPHA.point.light;
    for (let i = 0; i < total; i++) {
      const c = points.levels[i]!;
      if (c === "-") continue;
      const word = points.words[i]!;
      const x = xOf(i + 1, w, total);
      const y = yOf(+c, jitter(word), h);
      if (anchor && word.toLowerCase() === anchor) {
        anchorAt = [x, y];
        continue;
      }
      ctx.fillRect(x - DOT / 2, y - DOT / 2, DOT, DOT);
    }
    ctx.globalAlpha = 1;
    if (anchorAt) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(anchorAt[0], anchorAt[1], 4, 0, Math.PI * 2);
      ctx.fill();
      // The accent is 1.62:1 on the light ground, so the edge is what finds it there.
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    plot.current = { w, h };
    // The labels are laid out from the same geometry, in HTML.
    setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, [points, resolvedTheme, anchorWord]);

  useEffect(() => {
    paint();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  // Escape dismisses the label without moving the pointer, which WCAG 1.4.13 asks of
  // anything that covers other content — and this one covers the points around it.
  const showing = hover !== null;
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHover(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing]);

  /** Where in the plot an event landed. */
  const at = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTest = (x: number, y: number, r: number) =>
    points && plot.current ? nearestWord(points, plot.current, x, y, r) : null;

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = at(e);
    const word = hitTest(x, y, HIT.mouse);
    setHover(word ? { word, x, y } : null);
  };

  /**
   * Hit-tested from the pick's own coordinates, never from `hover`. A tap fires its
   * synthetic mousemove and its click in one burst, and the state that move sets has not
   * rendered by the time the click handler would read it — so reading `hover` here picked
   * whatever the *previous* tap had left in it.
   */
  const onPick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = at(e);
    const word = hitTest(x, y, reach.current);
    // A finger leaves no cursor behind, so on touch the label is the only thing that says
    // what was picked; a mouse already put it there on the way in.
    setHover(word ? { word, x, y } : null);
    if (word) onSelect(word);
  };

  const levelled = points ? [...points.levels].filter((c) => c !== "-").length : 0;
  const example = DEFINING_EXAMPLE[source];

  if (!points) {
    return <Loading className="tw-min-h-[220px] tw-justify-center" label="Loading the figure…" />;
  }

  return (
    <figure className="tw-m-0">
      <div
        ref={wrapRef}
        // Taller as it gets wider, or the plot flattens: seven bands across 1,700px at a
        // fixed 420 is a 4:1 letterbox, and the jitter inside each band stops reading.
        className={
          "tw-relative tw-h-[min(52svh,360px)] tw-w-full tw-text-secondary " +
          "min-[700px]:tw-h-[420px] min-[1200px]:tw-h-[480px] min-[1600px]:tw-h-[540px]"
        }
        // On the wrapper, not the canvas: the label is inside it, so moving the pointer
        // onto the label is not leaving the figure (WCAG 1.4.13).
        onMouseLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          role="img"
          // The picture states a shape, and the shape is the caption. A screen reader gets
          // the claim in words; the tabs below are where it reads the words themselves.
          aria-label={`Frequency against defining level: ${levelled.toLocaleString()} words plotted, commonest at the left, D1 at the top. The vertical lines divide the CEFR bands, A1 at the left through C2 at the right. Within any one frequency range the words still spread across every level.`}
          className="tw-block tw-h-full tw-w-full"
          onMouseMove={onMove}
          // A fingertip covers about 40px of glass and hides what is under it, so it gets
          // a target that size; a mouse keeps the small one, so what the label names stays
          // what the click takes.
          onPointerDown={(e) => {
            reach.current = e.pointerType === "touch" ? HIT.finger : HIT.mouse;
          }}
          onClick={onPick}
          style={{ cursor: hover ? "pointer" : "default" }}
        />
        {size && points && <Labels size={size} total={points.words.length} />}
        {hover && (
          <span
            aria-hidden
            // Takes the pointer rather than passing it through: hit-testing the canvas
            // under the label renamed it to whichever point it covered (WCAG 1.4.13).
            className="tw-absolute tw-z-10 tw-rounded tw-border tw-border-line-subtle tw-bg-surface tw-px-2 tw-py-1 tw-body-x-small tw-text-primary tw-shadow"
            style={tipStyle(hover, wrapRef.current?.clientWidth ?? 0)}
            lang={source}
          >
            {hover.word}
          </span>
        )}
      </div>
      {/* 60ch and a 1.5 line height for a block of prose (WCAG 1.4.8): the caption ran the
          panel's full width, 247 characters a line. `ch` is the width of "0", so it
          measures wider than the prose it caps — 65ch still came out at 85 characters.
          The line height is inline, because Fondue's type token sets 1.33 and a utility
          class loses to it. */}
      <figcaption
        className="tw-mt-1 tw-max-w-[60ch] tw-px-1 tw-body-x-small text-muted-aaa"
        style={{ lineHeight: 1.5 }}
      >
        <details
          open={captionOpen}
          onToggle={(e) => setCaptionOpen(e.currentTarget.open)}
          className="[&[open]_summary]:tw-mb-1"
        >
          {/* The axes and the one thing a reader gets wrong stay out of the fold: a figure
              that silently reads as easy-to-hard is worse than one nobody expands. */}
          <summary className="tw-cursor-pointer tw-py-1.5 marker:tw-text-current">
            Commonest words at the left, defining level up — not a difficulty scale
          </summary>
          {levelled.toLocaleString()} words. D1 at the top is the core the dictionary defines
          everything else with; D7 at the bottom is never used in a definition at all. That makes
          D1 a defining vocabulary in the Longman sense — one the dictionary&rsquo;s usage reveals,
          rather than one an editor fixes in advance. The numbers across the bottom are ranks, not
          counts: 6k is the 6,000th commonest word, so the further right a point sits, the rarer
          it is. The vertical lines divide the CEFR bands, named in the row beneath — A1 the
          first thousand words, C2 the rarest.{" "}
          {example && (
            <>
              <span lang={source}>{example}</span> is A1 vocabulary sitting at D7, which is what
              &ldquo;not a difficulty scale&rdquo; means.{" "}
            </>
          )}
          Pick a point to look it up.
        </details>
      </figcaption>
    </figure>
  );
}
