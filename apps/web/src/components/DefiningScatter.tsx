"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import {
  IconArrowExpand,
  IconArrowMinimize,
  IconArrowRoundAntiClockwise,
  IconCaretDown,
  IconCaretLeft,
  IconCaretRight,
  IconCaretUp,
  IconMagnifierMinus,
  IconMagnifierPlus,
} from "@frontify/fondue/icons";
import { useThemeToggle } from "@/app/providers";
import Loading from "@/components/Loading";
import { DEFINING_EXAMPLE, definingLevel, type SourceLang } from "@/lib/languages";

/**
 * The defining view's figure: every levelled word as a point, frequency across, defining
 * level up. The tabs below are the browse surface and the accessible one; this says the
 * thing the tabs cannot, which is that the two axes come apart. Read one vertical slice —
 * one CEFR stripe, words of near-equal frequency — and the points still spread over every
 * level. That separation is the whole claim the view rests on.
 *
 * In the page it is one static picture, because the wheel and a finger there scroll the
 * page. Full screen it zooms and pans, which is where one word in the crowd can be found.
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

// @spec FIG-3, FIG-8
/** The first doubling at which the densest row fits its words 10mm apart on a phone. */
export const MAX_ZOOM = 512;
/**
 * How far apart two points stand at full zoom, at the least: room for a large or a shaking
 * fingertip. Measured on the least plot full screen leaves a phone — 320px wide in portrait,
 * 340px tall in landscape — at Android's 160px an inch.
 */
const CLEARANCE = { mm: 10, pxPerMm: 160 / 25.4, plot: { w: 254, h: 183 } };
/** How many further offsets a crowded word tries before it settles for the farthest. */
const TRIES = 16;
/** One press of a zoom button or key. */
const ZOOM_STEP = 2;
/** How far a press moves the view, as a share of what is in view. A held key repeats. */
const PAN = { key: 0.2, button: 0.5 };
/** Zoom per pixel of wheel. */
const WHEEL = 0.0016;
/** How far a press may wander and still be a pick rather than a drag. */
const SLOP = 6;
/** How far off the plot a mark can still reach into it: the anchor dot and its ring. */
const REACH = 5;
/** The least room between two rank labels, and how far one keeps from either end of the row. */
const TICK = { gap: 56, inset: 16 };
/** What a rank label may count in, finest first. */
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
/** How much of a clipped row or stripe has to show to carry its name. */
const NAME_ROOM = { row: 16, band: 28 };

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

interface Points {
  /** One char per ranked word: its level as a base-36 digit, or "-" for a word with no level. */
  levels: string;
  /** How many levels the language's dictionary peels into, one row of the plot each. */
  levelCount: number;
  words: string[];
}

/** The plot's size in CSS pixels, which is all the scales below need. */
interface Plot {
  w: number;
  h: number;
}

/** What is in view: the zoom, and the window's top-left corner as a share of the whole figure. */
export interface View {
  k: number;
  u: number;
  v: number;
}

export const WHOLE: View = { k: 1, u: 0, v: 0 };

/** The view held to the figure: between whole and `MAX_ZOOM`, and never past an edge. */
// @spec FIG-3
export function clampView({ k, u, v }: View): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, k));
  const room = 1 - 1 / z;
  return { k: z, u: Math.min(room, Math.max(0, u)), v: Math.min(room, Math.max(0, v)) };
}

/**
 * `start` zoomed by `f`, with the figure point at window fraction `from` carried to `to`.
 * A wheel or a button zooms in place; a pinch also follows the fingers.
 */
export function zoomView(
  start: View,
  f: number,
  from: [number, number] = [0.5, 0.5],
  to: [number, number] = from,
): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, start.k * f));
  return clampView({
    k,
    u: start.u + from[0] / start.k - to[0] / k,
    v: start.v + from[1] / start.k - to[1] / k,
  });
}

/** The window moved by a share of itself. */
export function panView(view: View, du: number, dv: number): View {
  return clampView({ k: view.k, u: view.u + du / view.k, v: view.v + dv / view.k });
}

/**
 * Where a rank falls across the figure, 0 to 1. Square root, not log: log gives ranks
 * 1-1,000 two thirds of the width. Sqrt gives each CEFR band a roughly equal share of it,
 * which is what makes a stripe readable.
 */
function uOf(rank: number, total: number): number {
  return Math.sqrt(rank) / Math.sqrt(total);
}

// @spec BAND-15
/** Where a word falls down the figure, 0 to 1: its level's row, and its offset inside it. */
function vOf(level: number, off: number, levelCount: number): number {
  return (level - 0.5 + off * 0.7) / levelCount;
}

/** Screen position of a figure fraction, in a plot `w` by `h` showing `view`. */
const sx = (u: number, view: View, w: number) =>
  PAD.left + (u - view.u) * view.k * (w - PAD.left - PAD.right);
const sy = (v: number, view: View, h: number) =>
  PAD.top + (v - view.v) * view.k * (h - PAD.top - PAD.bottom);

/** A stream of offsets in [-0.5, 0.5), seeded by a word's hash: mulberry32. */
function offsets(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32 - 0.5;
  };
}

/** The words of one level placed so far, in rank order: where across, and their offset. */
interface Row {
  u: number[];
  off: number[];
}

/**
 * A word's offset inside its level's band. Hashed from the word, so it never moves between
 * repaints — but random offsets put some pairs closer than full zoom can pull apart. So an
 * offset within `CLEARANCE` of a word already in the row gives way to the first clear one of
 * `TRIES` more, or failing that the farthest.
 */
// @spec FIG-8
function offsetOf(word: string, u: number, row: Row, levelCount: number): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (Math.imul(h, 31) + word.charCodeAt(i)) | 0;
  const next = offsets(h);
  const { plot } = CLEARANCE;
  const clear = (CLEARANCE.mm * CLEARANCE.pxPerMm) / MAX_ZOOM;
  const band = (0.7 / levelCount) * plot.h;
  let best = { off: 0, d: -1 };
  for (let t = 0; t <= TRIES; t++) {
    const off = t === 0 ? ((h >>> 0) % 1000) / 1000 - 0.5 : next();
    let d = Infinity;
    // Rank order runs left to right, so only the row's last few words can be that close.
    for (let j = row.u.length - 1; j >= 0; j--) {
      const dx = (u - row.u[j]!) * plot.w;
      if (dx >= clear) break;
      const dy = (off - row.off[j]!) * band;
      d = Math.min(d, dx * dx + dy * dy);
    }
    if (d >= clear * clear) return off;
    if (d > best.d) best = { off, d };
  }
  return best.off;
}

/** Every plotted point's place in the figure, worked out once rather than on every frame. */
interface Layout {
  /** The point's index into `words`. */
  word: Int32Array;
  u: Float64Array;
  v: Float64Array;
}

/** Exported for the tests, which place the points through it. */
export function layoutOf(points: Points): Layout {
  const total = points.words.length;
  const word: number[] = [];
  const u: number[] = [];
  const v: number[] = [];
  const rows = new Map<number, Row>();
  for (let i = 0; i < total; i++) {
    const level = definingLevel(points.levels[i]!);
    if (level === null) continue;
    let row = rows.get(level);
    if (!row) rows.set(level, (row = { u: [], off: [] }));
    const at = uOf(i + 1, total);
    const off = offsetOf(points.words[i]!, at, row, points.levelCount);
    row.u.push(at);
    row.off.push(off);
    word.push(i);
    u.push(at);
    v.push(vOf(level, off, points.levelCount));
  }
  return { word: Int32Array.from(word), u: Float64Array.from(u), v: Float64Array.from(v) };
}

/**
 * The ranks labelled along the bottom: every band edge in view, and in full screen the round
 * numbers between them wherever there is room. Exported, like `nearestWord`, because jsdom
 * lays nothing out.
 */
// @spec FIG-5
export function rankTicks(
  view: View,
  w: number,
  total: number,
  fine: boolean,
): { rank: number; edge: boolean }[] {
  const x = (r: number) => sx(uOf(r, total), view, w);
  const shows = (r: number) => x(r) >= PAD.left + TICK.inset && x(r) <= w - TICK.inset;
  // Every break but the last: the right edge is wherever the list ends, not a boundary.
  const edges = CEFR_BANDS.flatMap((b) => (b.max !== null && shows(b.max) ? [b.max] : []));
  const ticks = edges.map((rank) => ({ rank, edge: true }));
  if (!fine) return ticks;
  const first = view.u ** 2 * total;
  const last = (view.u + 1 / view.k) ** 2 * total;
  // The square root crowds the ranks to the right, so the rightmost pair is the closest.
  const step =
    STEPS.find((s) => {
      const top = Math.floor(last / s) * s;
      return top - s < 1 || x(top) - x(top - s) >= TICK.gap;
    }) ?? STEPS[STEPS.length - 1]!;
  for (let r = Math.max(step, Math.ceil(first / step) * step); r <= last; r += step) {
    if (shows(r) && edges.every((e) => Math.abs(x(e) - x(r)) >= TICK.gap))
      ticks.push({ rank: r, edge: false });
  }
  return ticks.sort((a, b) => a.rank - b.rank);
}

/**
 * Where to name a row or stripe running from `a` to `b` in a window from `lo` to `hi`: its
 * middle while it is wholly in view, else the middle of the part in view. Null when that part
 * is too small to carry a name.
 */
function nameAt(a: number, b: number, lo: number, hi: number, room: number): number | null {
  if (a >= lo - 0.5 && b <= hi + 0.5) return (a + b) / 2;
  const from = Math.max(a, lo);
  const to = Math.min(b, hi);
  return to - from >= room ? (from + to) / 2 : null;
}

/**
 * Every label the figure carries, as HTML over the canvas: the levels down the gutter, and
 * under the plot the ranks the bands break at and the band names. Drawn into the canvas
 * these were images of text — 2.29:1 in light, blind to a text-spacing override, and gone
 * at any zoom the browser does in text alone.
 *
 * Positioned from the same geometry the points are, so a label sits on its own row or
 * column whatever the figure is resized or zoomed to.
 */
// @spec FIG-5
function Labels({
  size,
  total,
  levelCount,
  view,
  fine,
}: {
  size: Plot;
  total: number;
  levelCount: number;
  view: View;
  fine: boolean;
}) {
  const { w, h } = size;
  const edges = [0, ...CEFR_BANDS.map((b) => b.max ?? total)];
  const xAt = (rank: number) => sx(uOf(rank, total), view, w);
  const yAt = (v: number) => sy(v, view, h);
  const rows = Array.from({ length: levelCount }, (_, i) => i + 1).flatMap((l) => {
    const [a, b] = [yAt((l - 1) / levelCount), yAt(l / levelCount)];
    const at = nameAt(a, b, PAD.top, h - PAD.bottom, NAME_ROOM.row);
    return at === null ? [] : [{ l, at }];
  });
  const bands = CEFR_BANDS.flatMap((b, i) => {
    const at = nameAt(xAt(edges[i]!), xAt(edges[i + 1]!), PAD.left, w - PAD.right, NAME_ROOM.band);
    return at === null ? [] : [{ key: b.key, at }];
  });
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
      {rows.map(({ l, at }) => (
        <span
          key={l}
          className={label}
          style={{ left: gutter, top: at, transform: "translate(-100%, -50%)" }}
        >
          D{l}
        </span>
      ))}
      {/* The gutter names the row, because "6k" alone reads as a quantity of something —
          it is a place in the order, which is the whole of what the axis says. */}
      <span className={label} style={{ left: gutter, top: rankRow, ...atRight }}>
        rank
      </span>
      {rankTicks(view, w, total, fine).map(({ rank }) => (
        <span
          key={rank}
          className={label}
          style={{ left: xAt(rank), top: rankRow, transform: "translateX(-50%)" }}
        >
          {rank >= 1000 ? `${rank / 1000}k` : rank}
        </span>
      ))}
      <span className={label} style={{ left: gutter, top: bandRow, ...atRight }}>
        CEFR
      </span>
      {/* Heavier than the row above, which is the pair's order: the band name is what ties
          a stripe to the CEFR tab. Weight rather than a second colour, so both rows can
          hold 7:1 (1.4.6). */}
      {bands.map(({ key, at }) => (
        <span
          key={key}
          className={`${label} tw-font-medium`}
          style={{ left: at, top: bandRow, transform: "translateX(-50%)" }}
        >
          {key}
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
// @spec FIG-4
export function nearestWord(
  points: Points,
  layout: Layout,
  plot: Plot,
  px: number,
  py: number,
  r: number,
  view: View = WHOLE,
): string | null {
  let best: { word: string; d: number } | null = null;
  for (let j = 0; j < layout.u.length; j++) {
    const x = sx(layout.u[j]!, view, plot.w);
    const dx = x - px;
    if (dx > r || dx < -r) continue;
    // Off the plot, where a zoomed view cuts it away, so not there to be picked.
    if (x < PAD.left - 0.5 || x > plot.w - PAD.right + 0.5) continue;
    const y = sy(layout.v[j]!, view, plot.h);
    if (y < PAD.top - 0.5 || y > plot.h - PAD.bottom + 0.5) continue;
    const dy = y - py;
    const d = dx * dx + dy * dy;
    if (d <= r * r && (!best || d < best.d)) best = { word: points.words[layout.word[j]!]!, d };
  }
  return best?.word ?? null;
}

/** How far the hover label keeps from the pointer, across and up. */
const TIP_GAP = 8;

/**
 * Where the hover label sits: above the cursor at every height, since a cursor hangs below
 * its hotspot by however large it is set. On the top row that runs the label past the plot.
 * Across, on whichever side of the pointer it fits, else centred inside the figure.
 */
// @spec FIG-9
export function tipStyle(
  hover: { x: number; y: number },
  wrapWidth: number,
  tipWidth: number,
): React.CSSProperties {
  const right = hover.x + TIP_GAP;
  const left = hover.x - TIP_GAP - tipWidth;
  const x =
    right + tipWidth <= wrapWidth
      ? right
      : left >= 0
        ? left
        : Math.max(0, Math.min(hover.x - tipWidth / 2, wrapWidth - tipWidth));
  return { left: x, top: hover.y - TIP_GAP, transform: "translateY(-100%)" };
}

// 44px, as every control on the page is (2.5.5). Disabled by aria, as SwapButton is, so a
// button that runs out under the finger on it keeps its focus.
const TOOL =
  "tw-inline-flex tw-h-11 tw-min-w-[44px] tw-shrink-0 tw-items-center tw-justify-center " +
  "tw-gap-1.5 tw-rounded-full tw-border tw-border-line-subtle tw-bg-surface tw-px-3 " +
  "tw-body-small tw-text-secondary tw-transition-colors " +
  "hover:tw-border-line hover:tw-text-primary " +
  "aria-disabled:tw-cursor-not-allowed aria-disabled:tw-opacity-40 " +
  "aria-disabled:hover:tw-border-line-subtle aria-disabled:hover:tw-text-secondary";

/** An icon button named by `label`, which also shows beside the icon where `wide` has room. */
function Tool({
  label,
  wide = false,
  disabled = false,
  onClick,
  className = "",
  children,
  ref,
}: {
  label: string;
  wide?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={disabled}
      onClick={() => !disabled && onClick()}
      className={`${TOOL} ${className}`}
    >
      {children}
      <span className={wide ? "tw-sr-only min-[900px]:tw-not-sr-only" : "tw-sr-only"}>
        {label}
      </span>
    </button>
  );
}

interface Point {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "press"; id: number; from: Point; start: View; moved: boolean }
  | { kind: "pinch"; start: View; span: number; from: [number, number] };

const span = (a: Point, b: Point) => Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The canvas, its labels and the hover label. Static unless given `zoom`, which full screen
 * does: there it takes the wheel, a drag and a pinch, and a pick is a press that stayed put.
 */
function Chart({
  points,
  layout,
  source,
  anchorWord,
  label,
  onSelect,
  zoom,
  className,
  children,
}: {
  points: Points;
  layout: Layout;
  source: SourceLang;
  /** The looked-up word, drawn in the accent colour so it can be found in the cloud. */
  anchorWord: string | null;
  /** The canvas's name: the claim the picture makes. */
  label: string;
  onSelect: (word: string) => void;
  zoom?: { view: View; onView: Dispatch<SetStateAction<View>> };
  className: string;
  children?: ReactNode;
}) {
  const { resolvedTheme } = useThemeToggle();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ word: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  // Read before paint, since the side of the pointer the label fits on depends on its word.
  const [tipWidth, setTipWidth] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  // Plot geometry, kept from the last paint so hit-testing measures against what is drawn.
  const plot = useRef<Plot | null>(null);
  // The same geometry as state, because the labels are HTML and render from it.
  const [size, setSize] = useState<Plot | null>(null);
  // How close a pointer has to land, set on pointerdown: the click event itself is a plain
  // MouseEvent in some browsers, with no pointer type left on it to read.
  const reach = useRef(HIT.mouse);
  const view = zoom?.view ?? WHOLE;
  // What the last paint drew, for the handlers between renders.
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const fine = zoom !== undefined;

  const anchorIndex = useMemo(() => {
    const anchor = anchorWord?.toLowerCase();
    return anchor ? points.words.findIndex((w) => w.toLowerCase() === anchor) : -1;
  }, [points, anchorWord]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    // Resizing the backing store clears it and reallocates it, so only when it changed.
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const view = viewRef.current;
    const ink = getComputedStyle(canvas).color;
    const dark = resolvedTheme === "dark";
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--accent-focus").trim() ||
      "#f5c542";
    const total = points.words.length;
    const iw = w - PAD.left - PAD.right;
    const ih = h - PAD.top - PAD.bottom;
    const bottom = h - PAD.bottom;

    // CEFR bands, drawn as the line between one and the next rather than as alternating
    // fills: the fill was a 1.10:1 shade, and what it was for is the boundary.
    ctx.strokeStyle = ink;
    ctx.globalAlpha = dark ? ALPHA.edge.dark : ALPHA.edge.light;
    ctx.lineWidth = 1;
    const line = (rank: number, from: number, to: number) => {
      // Half-pixel, or a 1px line straddles two columns and renders as a 2px grey smear.
      const x = Math.round(sx(uOf(rank, total), view, w)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, from);
      ctx.lineTo(x, to);
      ctx.stroke();
    };
    for (const { max } of CEFR_BANDS) {
      if (max === null) continue;
      const x = sx(uOf(max, total), view, w);
      if (x >= PAD.left && x <= w - PAD.right) line(max, PAD.top, bottom);
    }
    // A rank labelled between two edges gets a tick under the plot.
    for (const { rank, edge } of rankTicks(view, w, total, fine)) {
      if (!edge) line(rank, bottom, bottom + 4);
    }
    ctx.globalAlpha = 1;

    // Every label is HTML over the canvas (see `Labels`): drawn here they were images of
    // text — 2.29:1 in light, ignoring a text-spacing override, and unscalable.

    ctx.save();
    // Zoomed, the view cuts through the cloud, and the cut keeps it out of the label rows.
    // Whole, nothing lies off the plot to cut.
    if (view.k > 1) {
      ctx.beginPath();
      ctx.rect(PAD.left, PAD.top, iw, ih);
      ctx.clip();
    }
    // The points. One ink colour, not a ramp per level: the y position already encodes the
    // level, and the pale end of a ramp disappears against the ground. They grow as the
    // view zooms, so a word picked out of the crowd is big enough to see.
    const dot = Math.min(DOT * Math.sqrt(view.k), DOT * 3);
    // A square is a dot only while it is a pixel or two. By then few points are in view,
    // so drawing each one round costs little.
    const round = dot >= 3;
    let anchorAt: [number, number] | null = null;
    ctx.fillStyle = ink;
    ctx.globalAlpha = dark ? ALPHA.point.dark : ALPHA.point.light;
    for (let j = 0; j < layout.u.length; j++) {
      const x = PAD.left + (layout.u[j]! - view.u) * view.k * iw;
      if (x < PAD.left - REACH || x > w - PAD.right + REACH) continue;
      const y = PAD.top + (layout.v[j]! - view.v) * view.k * ih;
      if (y < PAD.top - REACH || y > bottom + REACH) continue;
      if (layout.word[j] === anchorIndex) {
        anchorAt = [x, y];
        continue;
      }
      if (round) {
        ctx.beginPath();
        ctx.arc(x, y, dot / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
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
    ctx.restore();
    plot.current = { w, h };
    // The labels are laid out from the same geometry, in HTML.
    setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, [points, layout, anchorIndex, resolvedTheme, fine]);

  useLayoutEffect(() => {
    viewRef.current = view;
    paint();
  }, [view, paint]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  // A label names the point under a pointer that has stopped; once the view moves, it names
  // whatever has slid under it instead.
  useEffect(() => setHover(null), [view]);

  // @spec FIG-9
  useLayoutEffect(() => {
    if (tipRef.current) setTipWidth(tipRef.current.getBoundingClientRect().width);
  }, [hover?.word]);

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
  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Where a plot position sits in the window, 0 to 1 across and down. */
  const fraction = (p: Point): [number, number] => {
    const g = plot.current;
    if (!g) return [0.5, 0.5];
    return [
      (p.x - PAD.left) / (g.w - PAD.left - PAD.right),
      (p.y - PAD.top) / (g.h - PAD.top - PAD.bottom),
    ];
  };

  const hitTest = (x: number, y: number, r: number) =>
    plot.current ? nearestWord(points, layout, plot.current, x, y, r, viewRef.current) : null;

  const hoverAt = ({ x, y }: Point) => {
    const word = hitTest(x, y, HIT.mouse);
    setHover(word ? { word, x, y } : null);
  };

  /**
   * Hit-tested from the pick's own coordinates, never from `hover`. A tap fires its
   * synthetic mousemove and its click in one burst, and the state that move sets has not
   * rendered by the time the click handler would read it — so reading `hover` here picked
   * whatever the *previous* tap had left in it.
   */
  const pick = ({ x, y }: Point) => {
    const word = hitTest(x, y, reach.current);
    // A finger leaves no cursor behind, so on touch the label is the only thing that says
    // what was picked; a mouse already put it there on the way in.
    setHover(word ? { word, x, y } : null);
    if (word) onSelect(word);
  };

  const pinch = (start: View): Gesture => {
    const [a, b] = [...pointers.current.values()] as [Point, Point];
    return { kind: "pinch", start, span: span(a, b), from: fraction(mid(a, b)) };
  };

  // @spec FIG-2, FIG-4
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A fingertip covers about 40px of glass and hides what is under it, so it gets a
    // target that size; a mouse keeps the small one, so what the label names stays what
    // the click takes.
    reach.current = e.pointerType === "touch" ? HIT.finger : HIT.mouse;
    if (!zoom || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      const start = viewRef.current;
      gesture.current = { kind: "press", id: e.pointerId, from: p, start, moved: false };
    } else if (pointers.current.size === 2) {
      gesture.current = pinch(viewRef.current);
      setHover(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zoom) return;
    const p = at(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") hoverAt(p);
      return;
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      zoom.onView(zoomView(g.start, span(a, b) / g.span, g.from, fraction(mid(a, b))));
    } else if (g?.kind === "press" && g.id === e.pointerId) {
      const dx = p.x - g.from.x;
      const dy = p.y - g.from.y;
      if (!g.moved && Math.hypot(dx, dy) < SLOP) return;
      g.moved = true;
      setGrabbing(true);
      const { w, h } = plot.current!;
      const [iw, ih] = [w - PAD.left - PAD.right, h - PAD.top - PAD.bottom];
      zoom.onView(panView(g.start, -dx / iw, -dy / ih));
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zoom || !pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    setGrabbing(false);
    if (g?.kind === "pinch") {
      // A finger lifted out of a pinch leaves the other one dragging from where it is now,
      // and that drag never ends in a pick.
      const rest = [...pointers.current.entries()];
      const start = viewRef.current;
      gesture.current =
        rest.length >= 2
          ? pinch(start)
          : rest.length === 1
            ? { kind: "press", id: rest[0]![0], from: rest[0]![1], start, moved: true }
            : null;
      return;
    }
    gesture.current = null;
    if (g?.kind === "press" && !g.moved && e.type === "pointerup") pick(at(e));
  };

  // A native listener, because React's wheel listener is passive and cannot keep the page
  // from scrolling.
  // @spec FIG-2
  const onView = zoom?.onView;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onView) return;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Firefox counts lines.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
      const to = fraction(local(e));
      onView((v) => zoomView(v, Math.exp(-e.deltaY * unit * WHEEL), to));
    };
    // Safari reports a trackpad pinch as gesture events, where other browsers send a wheel
    // with ctrl held.
    let start: { view: View; at: [number, number] } | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      start = { view: viewRef.current, at: fraction(local(e as unknown as MouseEvent)) };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      // A pinch on glass arrives as pointer events too, and those already zoom.
      if (!start || pointers.current.size > 0) return;
      const from = start;
      onView(zoomView(from.view, (e as Event & { scale: number }).scale, from.at));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
    // `fraction` reads only refs, so the first one serves.
  }, [onView]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => hoverAt(at(e));
  const onPick = (e: React.MouseEvent<HTMLCanvasElement>) => pick(at(e));

  return (
    <div
      ref={wrapRef}
      className={`tw-relative tw-text-secondary ${className}`}
      // On the wrapper, not the canvas: the label is inside it, so moving the pointer
      // onto the label is not leaving the figure (WCAG 1.4.13).
      onMouseLeave={() => setHover(null)}
    >
      <canvas
        ref={canvasRef}
        role="img"
        // The picture states a shape, and the shape is the caption. A screen reader gets
        // the claim in words; the tabs below are where it reads the words themselves.
        aria-label={label}
        className="tw-block tw-h-full tw-w-full"
        onPointerDown={onPointerDown}
        // @spec FIG-6
        // In the page a finger and the wheel are the page's, so only full screen claims them.
        {...(zoom
          ? {
              onPointerMove,
              onPointerUp: onPointerEnd,
              onPointerCancel: onPointerEnd,
              style: {
                cursor: grabbing ? "grabbing" : hover ? "pointer" : "grab",
                touchAction: "none",
              },
            }
          : {
              onMouseMove: onMove,
              onClick: onPick,
              style: { cursor: hover ? "pointer" : "default" },
            })}
      />
      {size && (
        <Labels
          size={size}
          total={points.words.length}
          levelCount={points.levelCount}
          view={view}
          fine={fine}
        />
      )}
      {hover && (
        <span
          ref={tipRef}
          aria-hidden
          // Takes the pointer rather than passing it through: hit-testing the canvas
          // under the label renamed it to whichever point it covered (WCAG 1.4.13).
          // Sized as the chips are, since full screen is read one label after another.
          className="tw-absolute tw-z-10 tw-whitespace-nowrap tw-rounded tw-border tw-border-line-subtle tw-bg-surface tw-px-2 tw-py-1 tw-body-large tw-text-primary tw-shadow"
          style={tipStyle(hover, wrapRef.current?.clientWidth ?? 0, tipWidth)}
          lang={source}
        >
          {hover.word}
        </span>
      )}
      {children}
    </div>
  );
}

/** What each key does to the view. A Map, since it is keyed on whatever key is pressed. */
const KEYS = new Map<string, (v: View) => View>([
  ["ArrowLeft", (v) => panView(v, -PAN.key, 0)],
  ["ArrowRight", (v) => panView(v, PAN.key, 0)],
  ["ArrowUp", (v) => panView(v, 0, -PAN.key)],
  ["ArrowDown", (v) => panView(v, 0, PAN.key)],
  ["+", (v) => zoomView(v, ZOOM_STEP)],
  ["=", (v) => zoomView(v, ZOOM_STEP)],
  ["-", (v) => zoomView(v, 1 / ZOOM_STEP)],
  ["_", (v) => zoomView(v, 1 / ZOOM_STEP)],
  ["0", () => WHOLE],
]);

/** Where each move button sits, in the middle of its own edge of the plot. */
const EDGE = {
  left: "tw-left-1 tw-top-1/2 -tw-translate-y-1/2",
  right: "tw-right-1 tw-top-1/2 -tw-translate-y-1/2",
  up: "tw-top-1 tw-left-1/2 -tw-translate-x-1/2",
  down: "tw-bottom-1 tw-left-1/2 -tw-translate-x-1/2",
};

/**
 * Buttons on the plot's edges that move the view, shown once it is zoomed. A drag does the
 * same, but every pan has to be possible without one (2.5.7).
 */
function Moves({ view, onView }: { view: View; onView: Dispatch<SetStateAction<View>> }) {
  const end = 1 - 1 / view.k;
  const moves = [
    { side: "left", can: view.u > 0, du: -1, dv: 0, Icon: IconCaretLeft },
    { side: "right", can: view.u < end, du: 1, dv: 0, Icon: IconCaretRight },
    { side: "up", can: view.v > 0, du: 0, dv: -1, Icon: IconCaretUp },
    { side: "down", can: view.v < end, du: 0, dv: 1, Icon: IconCaretDown },
  ] as const;
  return (
    <div
      className="tw-pointer-events-none tw-absolute"
      style={{ left: PAD.left, right: PAD.right, top: PAD.top, bottom: PAD.bottom }}
    >
      {moves.map(({ side, can, du, dv, Icon }) => (
        <Tool
          key={side}
          label={`Move ${side}`}
          disabled={!can}
          onClick={() => onView((v) => panView(v, du * PAN.button, dv * PAN.button))}
          className={`tw-pointer-events-auto tw-absolute ${EDGE[side]}`}
        >
          <Icon size={20} aria-hidden />
        </Tool>
      ))}
    </div>
  );
}

/** What full screen holds: the toolbar, the zoomable figure, and how to work it. */
function FullScreen({
  titleId,
  hintId,
  onExit,
  ...chart
}: {
  titleId: string;
  hintId: string;
  onExit: () => void;
  points: Points;
  layout: Layout;
  source: SourceLang;
  anchorWord: string | null;
  label: string;
  onSelect: (word: string) => void;
}) {
  const [view, setView] = useState<View>(WHOLE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exitRef = useRef<HTMLButtonElement | null>(null);
  const zoomInRef = useRef<HTMLButtonElement | null>(null);
  const coarse = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
  const zoomed = view.k > 1;

  // Opened by a button, so focus starts on the button that undoes it.
  useEffect(() => exitRef.current?.focus(), []);

  // The move buttons go once the view is whole again, and one of them may have had focus.
  useEffect(() => {
    if (!zoomed && !rootRef.current?.contains(document.activeElement)) zoomInRef.current?.focus();
  }, [zoomed]);

  // @spec FIG-2
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl and plus is the browser's own zoom, which has to keep working (1.4.4).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const move = KEYS.get(e.key);
      if (!move) return;
      e.preventDefault();
      setView(move);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Nothing here scrolls, and a wheel over the toolbar would scroll the page behind it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    root.addEventListener("wheel", stop, { passive: false });
    return () => root.removeEventListener("wheel", stop);
  }, []);

  return (
    <div ref={rootRef} className="tw-flex tw-h-full tw-flex-col">
      <div
        className={
          "tw-flex tw-items-center tw-gap-1.5 tw-border-b tw-border-line-subtle tw-p-2 " +
          "min-[700px]:tw-px-4"
        }
      >
        <h2
          id={titleId}
          className="tw-min-w-0 tw-flex-1 tw-body-small tw-font-medium tw-text-primary"
        >
          Frequency against defining level
        </h2>
        <Tool
          label="Zoom out"
          wide
          disabled={!zoomed}
          onClick={() => setView((v) => zoomView(v, 1 / ZOOM_STEP))}
        >
          <IconMagnifierMinus size={20} aria-hidden />
        </Tool>
        <Tool
          ref={zoomInRef}
          label="Zoom in"
          wide
          disabled={view.k >= MAX_ZOOM}
          onClick={() => setView((v) => zoomView(v, ZOOM_STEP))}
        >
          <IconMagnifierPlus size={20} aria-hidden />
        </Tool>
        <Tool label="Reset zoom" wide disabled={!zoomed} onClick={() => setView(WHOLE)}>
          <IconArrowRoundAntiClockwise size={20} aria-hidden />
        </Tool>
        <Tool ref={exitRef} label="Exit full screen" wide onClick={onExit}>
          <IconArrowMinimize size={20} aria-hidden />
        </Tool>
      </div>
      <div className="tw-min-h-0 tw-flex-1 tw-px-2 tw-pt-3 min-[700px]:tw-px-4">
        <Chart
          {...chart}
          zoom={{ view, onView: setView }}
          className="tw-h-full tw-w-full tw-select-none"
        >
          {zoomed && <Moves view={view} onView={setView} />}
        </Chart>
      </div>
      <p
        id={hintId}
        className="tw-px-3 tw-pb-3 tw-pt-1 tw-body-x-small text-muted-aaa min-[700px]:tw-px-4"
        style={{ lineHeight: 1.5 }}
      >
        {coarse
          ? "Pinch to zoom, drag to move, and tap a point to look it up."
          : "Scroll to zoom, drag to move, and click a point to look it up. " +
            "The arrow keys move too, and + and − zoom."}
      </p>
    </div>
  );
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
  // Read once, on the first client render, so the fold never flashes open then shut.
  // A stored choice wins; failing that, a wide screen has room to start open and a phone
  // does not — which is the whole reason this folds.
  const [captionOpen, setCaptionOpen] = useState(() => {
    const stored = readCaptionPref();
    return stored ?? wideEnoughForCaption();
  });
  const [points, setPoints] = useState<Points | null>(null);
  const [full, setFull] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // What the browser's own full screen is asked for: a dialog cannot be it.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const hintId = useId();

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

  const layout = useMemo(() => (points ? layoutOf(points) : null), [points]);

  // @spec FIG-1
  // The dialog is the full screen on every device, iPhone Safari included, which has no
  // element fullscreen. Where the browser has one, it takes the browser's bars away too.
  const openFull = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setFull(true);
    const stage = stageRef.current;
    if (stage?.requestFullscreen && document.fullscreenEnabled)
      stage.requestFullscreen().catch(() => {});
  };

  const closeFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    dialogRef.current?.close();
  };

  // @spec FIG-7
  // Escape in the browser's full screen is the browser's, and leaves only that. Leave this
  // one with it — and leave the browser's if it arrived after this one had already closed.
  useEffect(() => {
    const onChange = () => {
      const dialog = dialogRef.current;
      if (!document.fullscreenElement) {
        if (dialog?.open) dialog.close();
      } else if (document.fullscreenElement === stageRef.current && !dialog?.open) {
        document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // However it closed — the button, Escape, Android's back gesture — focus goes back to
  // the button that opened it, which not every browser does for a dialog.
  const onClosed = () => {
    setFull(false);
    openerRef.current?.focus();
  };

  if (!points || !layout) {
    return <Loading className="tw-min-h-[220px] tw-justify-center" label="Loading the figure…" />;
  }

  const levelled = layout.u.length;
  const example = DEFINING_EXAMPLE[source];
  const label = `Frequency against defining level: ${levelled.toLocaleString()} words plotted, commonest at the left, D1 at the top. The vertical lines divide the CEFR bands, A1 at the left through C2 at the right. Within any one frequency range the words still spread across every level.`;
  const chart = { points, layout, source, anchorWord, label, onSelect };

  return (
    <>
      <figure className="tw-m-0">
        <Chart
          {...chart}
          // Taller as it gets wider, or the plot flattens: the level bands across 1,700px at
          // a fixed 420 are a 4:1 letterbox, and the jitter inside each band stops reading.
          className={
            "tw-h-[min(52svh,360px)] tw-w-full " +
            "min-[700px]:tw-h-[420px] min-[1200px]:tw-h-[480px] min-[1600px]:tw-h-[540px]"
          }
        >
          {/* The top right is the rare end of D1, the emptiest corner of the plot. Under
              the hover label, which may need to rise over it. */}
          <Tool
            ref={openerRef}
            label="Full screen"
            wide
            onClick={openFull}
            className="tw-absolute tw-right-0 tw-top-0 tw-z-[5]"
          >
            <IconArrowExpand size={20} aria-hidden />
          </Tool>
        </Chart>
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
            {/* 13px of padding on an 18px line is 44, the target of 2.5.5 — set as padding
                rather than a height so it stays centred and a wrapped line still grows. */}
            <summary className="tw-cursor-pointer tw-py-[13px] marker:tw-text-current">
              Commonest words at the left, defining level up — not a difficulty scale
            </summary>
            {levelled.toLocaleString()} words. D1 at the top is the core the dictionary defines
            everything else with; D{points.levelCount} at the bottom is never used to define a
            word outside D{points.levelCount}. That makes D1 a defining vocabulary in the Longman sense — one the
            dictionary&rsquo;s usage reveals, rather than one an editor fixes in advance. The
            numbers across the bottom are ranks, not counts: 6k is the 6,000th commonest word, so
            the further right a point sits, the rarer it is. The vertical lines divide the CEFR
            bands, named in the row beneath — A1 the first thousand words, C2 the rarest.{" "}
            {example && (
              <>
                <span lang={source}>{example}</span> is A1 vocabulary sitting at
                D{points.levelCount}, which is what &ldquo;not a difficulty scale&rdquo; means.{" "}
              </>
            )}
            Pick a point to look it up.
          </details>
        </figcaption>
      </figure>
      {/* Not Fondue's Dialog: its full screen keeps a margin and sizes to 100vh, which on an
          iPhone runs under Safari's toolbar. A modal <dialog> brings Escape, the inert page
          and the top layer with it. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onClose={onClosed}
        className={
          "tw-fixed tw-inset-0 tw-m-0 tw-h-auto tw-max-h-none tw-w-auto tw-max-w-none " +
          "tw-overflow-hidden tw-border-0 tw-bg-surface tw-p-0 tw-text-primary"
        }
      >
        {/* No touch here is the page's to scroll or zoom. */}
        <div ref={stageRef} className="tw-h-full tw-bg-surface" style={{ touchAction: "none" }}>
          {full && <FullScreen {...chart} titleId={titleId} hintId={hintId} onExit={closeFull} />}
        </div>
      </dialog>
    </>
  );
}
