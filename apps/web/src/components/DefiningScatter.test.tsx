// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DefiningScatter, {
  MAX_ZOOM,
  WHOLE,
  layoutOf,
  nearestWord,
  panView,
  rankTicks,
  tipStyle,
  zoomView,
} from "./DefiningScatter";
import { getDefiningPoints } from "@/lib/bands";
import { DEFINING_LANGS, type SourceLang } from "@/lib/languages";

// `paint` bails on the zero-size wrap that jsdom reports, before it reaches the context
// stub in test/setup.ts. That is the point: everything outside the canvas — the label, the
// caption, the fold — is what a screen reader and a text browser get, and it has to stand
// up without anything ever being drawn.
const points = {
  levels: "11-3" + "7".repeat(6),
  levelCount: 7,
  words: ["o", "que", "john", "água", "olá", "uau", "a", "b", "c", "d"],
};

/** Fourteen levels, as French peels into: past D9 a level is a base-36 digit. */
const fourteen = {
  levels: "1e-3" + "e".repeat(6),
  levelCount: 14,
  words: ["il", "le", "new", "eau", "allô", "ouais", "a", "b", "c", "d"],
};

/** jsdom has no layout, so the caption's width test has to be told the answer. */
const screenWidth = (wide: boolean) =>
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: wide,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));

beforeEach(() => {
  localStorage.clear();
  screenWidth(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(points), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DefiningScatter", () => {
  it("names itself with the claim the picture makes, not just its axes", async () => {
    render(<DefiningScatter source="pt" anchorWord="água" onSelect={() => {}} />);
    const img = await screen.findByRole("img");
    const name = img.getAttribute("aria-label") ?? "";
    // 9 of the 10 fixture words carry a level; "john" is the "-".
    expect(name).toContain("9 words plotted");
    expect(name).toContain("spread across every level");
  });

  it("keeps the axes and the misreading out of the fold", async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    const fig = await screen.findByRole("figure");
    // Whatever else folds away, a reader must not be left thinking height is difficulty.
    const summary = fig.querySelector("summary")!;
    expect(summary.textContent).toContain("Commonest words at the left, defining level up");
    expect(summary.textContent).toContain("not a difficulty scale");
    expect(fig.textContent).toContain("D1 at the top");
  });

  it("names the caption's example in the active language", async () => {
    render(<DefiningScatter source="it" anchorWord={null} onSelect={() => {}} />);
    const fig = await screen.findByRole("figure");
    const example = fig.querySelector("figcaption [lang]")!;
    expect(example.textContent).toBe("ciao");
    expect(example).toHaveAttribute("lang", "it");
    expect(fig.textContent).toContain("ciao is A1 vocabulary sitting at D7");
  });

  // @spec BAND-15
  it("names the language's own bottom level", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fourteen), { status: 200 })),
    );
    render(<DefiningScatter source="fr" anchorWord={null} onSelect={() => {}} />);
    const fig = await screen.findByRole("figure");
    expect(fig.textContent).toContain("D14 at the bottom is never used to define a word outside D14");
    expect(fig.textContent).toContain("allô is A1 vocabulary sitting at D14");
  });

  it("asks only the active language for its points", async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    await screen.findByRole("img");
    expect(fetch).toHaveBeenCalledWith("/api/defining?source=pt");
  });
});

// The Breeze hand at size 48 reaches 41px below its hotspot and 3px above it, so the only
// side a cursor of any size leaves clear is up.
describe("the hover label's placement", () => {
  const W = 900;
  const GLYPH_UP = 3;

  it("sits above the cursor's glyph at every height, the top row included", () => {
    for (const y of [4, 200]) {
      const st = tipStyle({ x: 100, y }, W, 60);
      // translateY(-100%) makes `top` the label's bottom edge.
      expect(st.transform).toContain("translateY(-100%)");
      expect(Number(st.top)).toBeLessThan(y - GLYPH_UP);
    }
  });

  it("takes the side of the pointer it fits on, right first, and centres where neither fits", () => {
    expect(tipStyle({ x: 100, y: 200 }, W, 60).left).toBe(108);
    expect(tipStyle({ x: 880, y: 200 }, W, 60).left).toBe(812);
    expect(tipStyle({ x: 148, y: 200 }, 296, 188).left).toBe(54);
  });

  // @spec FIG-9
  it("stays inside the figure on a 320px screen, for any label the figure can hold", () => {
    // 320px less the page's 12px gutter either side, the least the figure gets.
    const FRAME = 296;
    const out: string[] = [];
    for (let tip = 1; tip <= FRAME; tip++) {
      for (let x = 0; x <= FRAME; x++) {
        const left = Number(tipStyle({ x, y: 200 }, FRAME, tip).left);
        if (left < 0 || left + tip > FRAME) out.push(`${tip}px at x=${x}`);
      }
    }
    expect(out).toEqual([]);
  });
});

// The caption is what teaches the figure, and dead weight once it has. It starts open
// where there is room, starts folded on a phone, and remembers either way.
describe("the caption's fold", () => {
  const openState = async () => (await screen.findByRole("figure")).querySelector("details")!;

  it("starts open on a wide screen", async () => {
    screenWidth(true);
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    expect((await openState()).open).toBe(true);
  });

  it("starts folded on a phone", async () => {
    screenWidth(false);
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    expect((await openState()).open).toBe(false);
  });

  it("lets a remembered choice beat the screen width", async () => {
    screenWidth(false);
    localStorage.setItem("word-bands:defining-caption", "open");
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    expect((await openState()).open).toBe(true);
  });

  it("writes nothing until the reader touches it", async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    await openState();
    expect(localStorage.getItem("word-bands:defining-caption")).toBeNull();
  });

  it("remembers a fold", async () => {
    const details = await (async () => {
      render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
      return openState();
    })();
    details.open = false;
    fireEvent(details, new Event("toggle"));
    await waitFor(() =>
      expect(localStorage.getItem("word-bands:defining-caption")).toBe("closed"),
    );
  });
});

// A tap picked the word the *previous* tap had hovered. The click handler read the `hover`
// state, and a tap fires its synthetic mousemove and its click in one burst — the move's
// setState has not rendered by the time the click reads it. So the pick is hit-tested from
// its own coordinates now, and these say so by moving to one point and clicking another.
const W = 800;
const H = 400;
/** Where two of the fixture's words land in an 800x400 plot, and what a pick there gets. */
const FIRST = { x: 275, y: 21, word: "o" };
const LAST = { x: 788, y: 321, word: "d" };
const placed = layoutOf(points);

describe("the hit-test", () => {
  const plot = { w: W, h: H };

  it("finds the word under the pointer", () => {
    expect(nearestWord(points, placed, plot, FIRST.x, FIRST.y, 7)).toBe(FIRST.word);
    expect(nearestWord(points, placed, plot, LAST.x, LAST.y, 7)).toBe(LAST.word);
  });

  it("finds nothing out in the white", () => {
    expect(nearestWord(points, placed, plot, FIRST.x, LAST.y, 7)).toBeNull();
  });

  it("never returns a word with no level", () => {
    // "john" is the fixture's "-". Nothing is plotted for it, so no radius can reach it.
    for (let x = 0; x <= W; x += 4)
      for (let y = 0; y <= H; y += 4)
        expect(nearestWord(points, placed, plot, x, y, 22)).not.toBe("john");
  });

  it("reaches further for a finger than for a cursor", () => {
    const off = { x: FIRST.x + 14, y: FIRST.y };
    expect(nearestWord(points, placed, plot, off.x, off.y, 7)).toBeNull();
    expect(nearestWord(points, placed, plot, off.x, off.y, 22)).toBe(FIRST.word);
  });
});

/**
 * jsdom has no layout and no canvas, so the figure never paints: nothing can be picked
 * and nothing is drawn. Give it just enough of both — and only inside the block that
 * calls this, since the tests above are the ones proving the figure stands up with
 * nothing ever drawn. Returns every string the figure writes and where it wrote it.
 */
function paints() {
  const drawn: { text: string; x: number }[] = [];
  const realGetContext = window.HTMLCanvasElement.prototype.getContext;
  const realBox = ["clientWidth", "clientHeight"].map(
    (k) => [k, Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, k)] as const,
  );

  beforeEach(() => {
    drawn.length = 0;
    Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
      get: () => W,
      configurable: true,
    });
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
      get: () => H,
      configurable: true,
    });
    const pen = {
      fillText: (text: string, x: number) => drawn.push({ text, x }),
    } as unknown as CanvasRenderingContext2D;
    window.HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy(pen, {
        get: (t, k) => (k in t ? Reflect.get(t, k) : () => {}),
        set: () => true,
      })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => {
    window.HTMLCanvasElement.prototype.getContext = realGetContext;
    for (const [k, d] of realBox)
      d
        ? Object.defineProperty(window.HTMLElement.prototype, k, d)
        : Reflect.deleteProperty(window.HTMLElement.prototype, k);
  });
  return drawn;
}

// The caption calls the stripes the CEFR bands, and for a while the figure never named
// one: a reader got six shades of grey and five bare numbers that read as counts of
// words. Both rows are labelled now, and the labels are HTML over the canvas, so this
// lays the figure out and reads them back off the DOM.
describe("the axis under the plot", () => {
  paints();
  // The ten-word fixture has no axis to speak of: every band edge falls past the end of
  // it. This one is long enough to carry all six bands, and is handed over without a
  // Response — serializing 30,000 words to JSON and back costs more than the test does.
  const wide = {
    levels: "1".repeat(30_000),
    levelCount: 7,
    words: Array.from({ length: 30_000 }, (_, i) => `w${i}`),
  };
  const serve = (p: typeof wide) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => p })));
  beforeEach(() => serve(wide));

  const axis = async (source: SourceLang = "pt") => {
    render(<DefiningScatter source={source} anchorWord={null} onSelect={() => {}} />);
    await screen.findByRole("img");
    // The label layer, not the hover label, which is the wrapper's other aria-hidden child.
    const labels = [...document.querySelectorAll<HTMLElement>("figure div[aria-hidden] span")];
    const find = (text: string) => labels.find((el) => el.textContent === text)?.style;
    return {
      written: labels.map((el) => el.textContent ?? ""),
      at: (text: string) => parseFloat(find(text)?.left ?? "NaN"),
      top: (text: string) => parseFloat(find(text)?.top ?? "NaN"),
    };
  };

  it("names every band, and says what the numbers along the bottom are", async () => {
    const { written } = await axis();
    for (const t of ["A1", "A2", "B1", "B2", "C1", "C2", "rank", "CEFR"])
      expect(written).toContain(t);
  });

  it("puts each band's name inside its own stripe", async () => {
    const { at } = await axis();
    const ticks = ["1k", "3k", "6k", "12k", "25k"].map(at);
    // Right of the rank that opens the band, left of the one that closes it — which is
    // also what says the axis runs commonest to rarest, A1 first and C2 last.
    ["A1", "A2", "B1", "B2", "C1", "C2"].map(at).forEach((x, i) => {
      if (i > 0) expect(x).toBeGreaterThan(ticks[i - 1]!);
      if (i < ticks.length) expect(x).toBeLessThan(ticks[i]!);
    });
  });

  it("stops the ticks at the last band's edge, not the end of the list", async () => {
    const { written } = await axis();
    // `total` is where the ranking happens to stop, not a boundary anything falls on.
    expect(written.filter((t) => /^\d/.test(t))).toEqual(["1k", "3k", "6k", "12k", "25k"]);
  });

  // The levels are the other axis, and they were canvas pixels too.
  it("names every defining level down the gutter", async () => {
    const { written } = await axis();
    for (const l of ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]) expect(written).toContain(l);
  });

  // @spec BAND-15
  it("draws a row for each of the language's own levels", async () => {
    serve({ ...wide, levelCount: 14 });
    const { written, top } = await axis("fr");
    const rows = written.filter((t) => /^D\d+$/.test(t));
    expect(rows).toEqual(Array.from({ length: 14 }, (_, i) => `D${i + 1}`));
    // Evenly spaced from the top down, so D14 sits below D13 and not off the plot.
    expect(top("D14")).toBeGreaterThan(top("D13"));
    expect(top("D14")).toBeLessThan(H);
  });
});

describe("picking a point", () => {
  paints();

  const figure = async (onSelect: (w: string) => void) => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={onSelect} />);
    return screen.findByRole("img");
  };

  it("picks the word under the pick, not the one the last move found", async () => {
    const picked = vi.fn();
    const canvas = await figure(picked);
    fireEvent.mouseMove(canvas, { clientX: FIRST.x, clientY: FIRST.y });
    fireEvent.click(canvas, { clientX: LAST.x, clientY: LAST.y });
    expect(picked).toHaveBeenCalledExactlyOnceWith(LAST.word);
  });

  it("picks nothing when the pick lands in the white", async () => {
    const picked = vi.fn();
    const canvas = await figure(picked);
    fireEvent.mouseMove(canvas, { clientX: FIRST.x, clientY: FIRST.y });
    fireEvent.click(canvas, { clientX: FIRST.x, clientY: LAST.y });
    expect(picked).not.toHaveBeenCalled();
  });

  it("gives a finger the wider target, and a mouse the narrow one", async () => {
    const picked = vi.fn();
    const canvas = await figure(picked);
    const off = { clientX: FIRST.x + 14, clientY: FIRST.y };
    fireEvent.pointerDown(canvas, { ...off, pointerType: "mouse" });
    fireEvent.click(canvas, off);
    expect(picked).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { ...off, pointerType: "touch" });
    fireEvent.click(canvas, off);
    expect(picked).toHaveBeenCalledExactlyOnceWith(FIRST.word);
  });

  it("labels what a tap picked, since a finger leaves no cursor behind", async () => {
    const canvas = await figure(() => {});
    const tap = { clientX: LAST.x, clientY: LAST.y };
    fireEvent.pointerDown(canvas, { ...tap, pointerType: "touch" });
    fireEvent.click(canvas, tap);
    expect(await screen.findByText(LAST.word)).toBeInTheDocument();
  });
});

// The view is plain numbers, so where it may go is proven without laying anything out.
describe("the view", () => {
  const inside = (v: { k: number; u: number; v: number }) => {
    expect(v.u).toBeGreaterThanOrEqual(0);
    expect(v.v).toBeGreaterThanOrEqual(0);
    expect(v.u + 1 / v.k).toBeLessThanOrEqual(1 + 1e-12);
    expect(v.v + 1 / v.k).toBeLessThanOrEqual(1 + 1e-12);
  };

  // @spec FIG-3
  it("zooms out no further than the whole figure, and in no further than 512 times", () => {
    expect(zoomView(WHOLE, 0.25)).toEqual(WHOLE);
    let v = WHOLE;
    for (let i = 0; i < 12; i++) v = zoomView(v, 2, [0.9, 0.1]);
    expect(MAX_ZOOM).toBe(512);
    expect(v.k).toBe(512);
    inside(v);
  });

  // @spec FIG-8
  it("stands every point 10mm from every other at full zoom on a phone", () => {
    // 320px wide in portrait and 340px tall in landscape, less the toolbar, the hint and the
    // plot's margins. 10mm at Android's 160px an inch.
    const phone = { w: 254 * MAX_ZOOM, h: 183 * MAX_ZOOM };
    const tenMm = (10 * 160) / 25.4;
    for (const source of DEFINING_LANGS) {
      const { u, v } = layoutOf(getDefiningPoints(source)!);
      // Sorted across, so the search stops once the gap across alone is too wide.
      const across = [...u.keys()].sort((a, b) => u[a]! - u[b]!);
      let closest = Infinity;
      for (let a = 0; a < across.length; a++)
        for (let b = a + 1; b < across.length; b++) {
          const [i, j] = [across[a]!, across[b]!];
          const dx = (u[j]! - u[i]!) * phone.w;
          if (dx >= closest) break;
          closest = Math.min(closest, Math.hypot(dx, (v[j]! - v[i]!) * phone.h));
        }
      expect(closest, source).toBeGreaterThanOrEqual(tenMm);
    }
  });

  // @spec FIG-3
  it("never pans past the figure's edges", () => {
    const v = zoomView(WHOLE, 4);
    for (const [du, dv] of [
      [-10, 0],
      [10, 0],
      [0, -10],
      [0, 10],
    ] as const)
      inside(panView(v, du, dv));
    // Whole, there is nowhere to go.
    expect(panView(WHOLE, 0.5, -0.5)).toEqual(WHOLE);
  });

  // @spec FIG-2
  it("keeps the point under the pointer where it is as it zooms", () => {
    const at: [number, number] = [0.3, 0.7];
    const v = zoomView(WHOLE, 3, at);
    expect(v.u + at[0] / v.k).toBeCloseTo(at[0]);
    expect(v.v + at[1] / v.k).toBeCloseTo(at[1]);
  });

  // @spec FIG-4
  it("hit-tests what the view draws, not where the whole figure would have it", () => {
    const plot = { w: W, h: H };
    // Zoomed four times in place at FIRST, which therefore stays put.
    const view = zoomView(WHOLE, 4, [(FIRST.x - 38) / (W - 50), (FIRST.y - 10) / (H - 50)]);
    expect(nearestWord(points, placed, plot, FIRST.x, FIRST.y, 7, view)).toBe(FIRST.word);
    // LAST has gone out of view, so nothing anywhere picks it.
    for (let x = 0; x <= W; x += 4)
      for (let y = 0; y <= H; y += 4)
        expect(nearestWord(points, placed, plot, x, y, 22, view)).not.toBe(LAST.word);
  });

  // @spec FIG-4
  it("finds a word where the zoom moved it, and no longer where it was", () => {
    const plot = { w: W, h: H };
    const view = zoomView(WHOLE, 2);
    // água, rank 4 of 10: at twice the zoom about the middle it lands 99px to the right.
    const u = Math.sqrt(4 / 10);
    const before = 38 + u * (W - 50);
    const after = 38 + (u - view.u) * view.k * (W - 50);
    const hit = (x: number, v: typeof view) =>
      Array.from({ length: H }, (_, y) => y).some(
        (y) => nearestWord(points, placed, plot, x, y, 1, v) === "água",
      );
    expect(hit(before, WHOLE)).toBe(true);
    expect(hit(after, view)).toBe(true);
    expect(hit(before, view)).toBe(false);
  });

  // @spec FIG-5
  it("labels the ranks wherever a zoomed view sits, band edges in it or not", () => {
    // Ranks 100 to 746 of 30,000: inside A1, where no band edge falls.
    const ranks = rankTicks({ k: 10, u: Math.sqrt(100 / 30_000), v: 0 }, W, 30_000, true);
    expect(ranks.length).toBeGreaterThanOrEqual(2);
    expect(ranks.every((t) => !t.edge)).toBe(true);
    // The page's own figure marks the band edges and nothing between them.
    expect(rankTicks(WHOLE, W, 30_000, false).map((t) => t.rank)).toEqual([
      1000, 3000, 6000, 12000, 25000,
    ]);
  });
});

/** The labels a figure carries, read back off the DOM it laid them out in. */
const labelsIn = (root: Element) => {
  const spans = [...root.querySelectorAll<HTMLElement>("div[aria-hidden] > span")];
  const find = (text: string) => spans.find((el) => el.textContent === text)?.style;
  return {
    written: spans.map((el) => el.textContent ?? ""),
    at: (text: string) => parseFloat(find(text)?.left ?? "NaN"),
    top: (text: string) => parseFloat(find(text)?.top ?? "NaN"),
  };
};

/**
 * A browser with element fullscreen, for the tests that need one. jsdom has none, which is
 * iPhone Safari's case and the default here.
 */
function withBrowserFullScreen() {
  let current: Element | null = null;
  const changed = () => document.dispatchEvent(new Event("fullscreenchange"));
  const request = vi.fn(async function (this: Element) {
    current = this;
    changed();
  });
  const exit = vi.fn(async () => {
    current = null;
    changed();
  });
  beforeEach(() => {
    current = null;
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    Object.defineProperty(window.HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
  });
  afterEach(() => {
    for (const k of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"])
      Reflect.deleteProperty(document, k);
    Reflect.deleteProperty(window.HTMLElement.prototype, "requestFullscreen");
    request.mockClear();
    exit.mockClear();
  });
  // Leaving by the browser's own way out: Escape, a gesture, its own control.
  return { request, exit, leave: () => ((current = null), changed()) };
}

describe("full screen", () => {
  paints();
  const wide = {
    levels: "1".repeat(30_000),
    levelCount: 7,
    words: Array.from({ length: 30_000 }, (_, i) => `w${i}`),
  };
  const serve = (p: typeof wide | typeof points) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => p })));
  beforeEach(() => serve(wide));

  const open = async (onSelect: (w: string) => void = () => {}) => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    const dialog = await screen.findByRole("dialog", { name: "Frequency against defining level" });
    return { dialog, canvas: dialog.querySelector("canvas")!, labels: labelsIn(dialog) };
  };
  /** The distance between two rows, which is the zoom. Both have to be wholly in view. */
  const rowGap = (dialog: Element) => labelsIn(dialog).top("D5") - labelsIn(dialog).top("D4");
  const button = (name: string) => screen.getByRole("button", { name });

  // @spec FIG-1
  it("opens in a browser with no element fullscreen, as iPhone Safari is", async () => {
    const { dialog, canvas } = await open();
    expect(dialog).toHaveAttribute("open");
    expect(canvas).toHaveAccessibleName(/^Frequency against defining level/);
    // Opened by a button, so focus starts on the one that undoes it.
    expect(button("Exit full screen")).toHaveFocus();
  });

  it("gives focus back to the button that opened it", async () => {
    await open();
    fireEvent.click(button("Exit full screen"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button("Full screen")).toHaveFocus();
  });

  describe("where the browser has its own full screen", () => {
    const fs = withBrowserFullScreen();

    // @spec FIG-1
    it("takes it as well", async () => {
      const { dialog } = await open();
      expect(fs.request).toHaveBeenCalledOnce();
      expect(fs.request.mock.contexts[0]).toBe(dialog.firstElementChild);
      expect(dialog).toHaveAttribute("open");
    });

    // @spec FIG-7
    it("closes when the browser's closes, so one Escape leaves both", async () => {
      const { dialog } = await open();
      fs.leave();
      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
      expect(button("Full screen")).toHaveFocus();
    });

    it("leaves the browser's when its own button closes it", async () => {
      await open();
      fireEvent.click(button("Exit full screen"));
      expect(fs.exit).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  // @spec FIG-2
  it("zooms by wheel, around the pointer, and keeps the page from scrolling", async () => {
    const { dialog, canvas } = await open();
    expect(rowGap(dialog)).toBeCloseTo(50);
    // Not prevented means the page would have scrolled instead.
    expect(fireEvent.wheel(canvas, { deltaY: -500, clientX: 400, clientY: 200 })).toBe(false);
    expect(rowGap(dialog)).toBeCloseTo(50 * Math.exp(0.8));
  });

  // @spec FIG-2
  it("zooms by pinch, following the fingers", async () => {
    const { dialog, canvas } = await open();
    const touch = { pointerType: "touch" };
    fireEvent.pointerDown(canvas, { ...touch, pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(canvas, { ...touch, pointerId: 2, clientX: 500, clientY: 200 });
    fireEvent.pointerMove(canvas, { ...touch, pointerId: 2, clientX: 700, clientY: 200 });
    expect(rowGap(dialog)).toBeCloseTo(100);
  });

  // @spec FIG-2
  it("pans by drag", async () => {
    const { dialog, canvas } = await open();
    fireEvent.keyDown(document, { key: "+" });
    const before = labelsIn(dialog).at("6k");
    const mouse = { pointerId: 1, pointerType: "mouse" };
    fireEvent.pointerDown(canvas, { ...mouse, clientX: 400, clientY: 200 });
    fireEvent.pointerMove(canvas, { ...mouse, clientX: 500, clientY: 200 });
    fireEvent.pointerUp(canvas, { ...mouse, clientX: 500, clientY: 200 });
    expect(labelsIn(dialog).at("6k") - before).toBeCloseTo(100);
  });

  // @spec FIG-2
  it("zooms and pans by key, and leaves the browser's own zoom keys alone", async () => {
    const { dialog } = await open();
    fireEvent.keyDown(document, { key: "+" });
    expect(rowGap(dialog)).toBeCloseTo(100);
    const before = labelsIn(dialog).at("6k");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    // A fifth of the window, which is 750px wide at twice the zoom.
    expect(before - labelsIn(dialog).at("6k")).toBeCloseTo(150);
    fireEvent.keyDown(document, { key: "0" });
    expect(rowGap(dialog)).toBeCloseTo(50);
    // Ctrl and plus is the browser zooming the page.
    expect(fireEvent.keyDown(document, { key: "+", ctrlKey: true })).toBe(true);
    expect(rowGap(dialog)).toBeCloseTo(50);
  });

  // @spec FIG-2
  it("zooms and pans by buttons, so no move needs a drag", async () => {
    const { dialog } = await open();
    expect(button("Zoom out")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Move right" })).toBeNull();
    fireEvent.click(button("Zoom in"));
    expect(rowGap(dialog)).toBeCloseTo(100);
    // Centred, so there is figure on every side to move to.
    for (const side of ["left", "right", "up", "down"])
      expect(button(`Move ${side}`)).toHaveAttribute("aria-disabled", "false");
    const before = labelsIn(dialog).at("6k");
    fireEvent.click(button("Move left"));
    expect(labelsIn(dialog).at("6k") - before).toBeCloseTo(375);
    expect(button("Move left")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button("Reset zoom"));
    expect(rowGap(dialog)).toBeCloseTo(50);
    expect(screen.queryByRole("button", { name: "Move left" })).toBeNull();
  });

  // @spec FIG-5
  it("keeps the row and the band it is zoomed into named, and the ranks labelled", async () => {
    const { dialog } = await open();
    // Five doublings from the middle of the figure, deep inside D4 and B2, then down and
    // left until the middle of either one is out of view.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document, { key: "+" });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document, { key: "ArrowDown" });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document, { key: "ArrowLeft" });
    const { written, top, at } = labelsIn(dialog);
    expect(written.filter((t) => /^D\d+$/.test(t))).toEqual(["D4"]);
    expect(top("D4")).toBeGreaterThan(10);
    expect(top("D4")).toBeLessThan(H - 40);
    expect(at("B2")).toBeGreaterThan(38);
    expect(at("B2")).toBeLessThan(W - 12);
    expect(written.filter((t) => /^\d/.test(t)).length).toBeGreaterThanOrEqual(2);
  });

  describe("picking", () => {
    beforeEach(() => serve(points));
    const mouse = { pointerId: 1, pointerType: "mouse" };

    // @spec FIG-4
    it("picks the word under a press that stayed put", async () => {
      const picked = vi.fn();
      const { canvas } = await open(picked);
      fireEvent.pointerDown(canvas, { ...mouse, clientX: LAST.x, clientY: LAST.y });
      fireEvent.pointerUp(canvas, { ...mouse, clientX: LAST.x + 2, clientY: LAST.y });
      expect(picked).toHaveBeenCalledExactlyOnceWith(LAST.word);
      // Still full screen: the word is looked up behind it, and marked in it.
      expect(screen.getByRole("dialog")).toHaveAttribute("open");
    });

    // @spec FIG-4
    it("picks what the zoomed view draws under the press", async () => {
      const picked = vi.fn();
      const { canvas } = await open(picked);
      fireEvent.keyDown(document, { key: "+" });
      const view = zoomView(WHOLE, 2);
      const x = 38 + (Math.sqrt(4 / 10) - view.u) * view.k * (W - 50);
      const y = Array.from({ length: H }, (_, i) => i).find(
        (i) => nearestWord(points, placed, { w: W, h: H }, x, i, 1, view) === "água",
      )!;
      fireEvent.pointerDown(canvas, { ...mouse, clientX: x, clientY: y });
      fireEvent.pointerUp(canvas, { ...mouse, clientX: x, clientY: y });
      expect(picked).toHaveBeenCalledExactlyOnceWith("água");
    });

    // @spec FIG-4
    it("picks nothing when a pinch ends, even with a finger still on a point", async () => {
      const picked = vi.fn();
      const { canvas } = await open(picked);
      const touch = { pointerType: "touch" };
      fireEvent.pointerDown(canvas, { ...touch, pointerId: 1, clientX: FIRST.x, clientY: FIRST.y });
      fireEvent.pointerDown(canvas, { ...touch, pointerId: 2, clientX: 500, clientY: 200 });
      fireEvent.pointerMove(canvas, { ...touch, pointerId: 2, clientX: 600, clientY: 260 });
      fireEvent.pointerUp(canvas, { ...touch, pointerId: 2, clientX: 600, clientY: 260 });
      // The finger that never moved lifts last, where a tap would have picked.
      fireEvent.pointerUp(canvas, { ...touch, pointerId: 1, clientX: FIRST.x, clientY: FIRST.y });
      expect(picked).not.toHaveBeenCalled();
    });

    // @spec FIG-4
    it("picks nothing at the end of a drag, even one ending on a point", async () => {
      const picked = vi.fn();
      const { canvas } = await open(picked);
      fireEvent.pointerDown(canvas, { ...mouse, clientX: FIRST.x, clientY: FIRST.y });
      fireEvent.pointerMove(canvas, { ...mouse, clientX: LAST.x, clientY: LAST.y });
      fireEvent.pointerUp(canvas, { ...mouse, clientX: LAST.x, clientY: LAST.y });
      expect(picked).not.toHaveBeenCalled();
    });
  });
});

// @spec FIG-6
describe("the figure in the page", () => {
  paints();

  it("leaves the wheel and a finger to the page", async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    const canvas = await screen.findByRole("img");
    const fig = canvas.closest("figure")!;
    const before = labelsIn(fig).top("D4");
    expect(fireEvent.wheel(canvas, { deltaY: -500, clientX: 400, clientY: 200 })).toBe(true);
    expect(canvas.style.touchAction).not.toBe("none");
    const finger = { pointerId: 1, pointerType: "touch" };
    fireEvent.pointerDown(canvas, { ...finger, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(canvas, { ...finger, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(canvas, { ...finger, clientX: 300, clientY: 100 });
    expect(labelsIn(fig).top("D4")).toBe(before);
  });
});
