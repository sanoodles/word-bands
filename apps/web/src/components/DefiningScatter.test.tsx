// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DefiningScatter, { nearestWord, tipStyle } from "./DefiningScatter";

// `paint` bails on the zero-size wrap that jsdom reports, before it reaches the context
// stub in test/setup.ts. That is the point: everything outside the canvas — the label, the
// caption, the fold — is what a screen reader and a text browser get, and it has to stand
// up without anything ever being drawn.
const points = {
  levels: "11-3" + "7".repeat(6),
  words: ["o", "que", "john", "água", "olá", "uau", "a", "b", "c", "d"],
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

  it("asks only the active language for its points", async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    await screen.findByRole("img");
    expect(fetch).toHaveBeenCalledWith("/api/defining?source=pt");
  });
});

// The label sat below-right of the cursor and the cursor covered it — a cursor's hotspot
// is its top-left corner, so the glyph occupies exactly the space below and right of the
// point it reports. Above by default, and only below where there is no room above.
describe("the hover label's placement", () => {
  const W = 900;

  it("sits above the cursor, clear of the glyph", () => {
    const st = tipStyle({ x: 100, y: 200 }, W);
    expect(st.transform).toContain("translateY(-100%)");
    expect(Number(st.top)).toBeLessThan(200);
  });

  it("flips below only in the top strip", () => {
    const st = tipStyle({ x: 100, y: 4 }, W);
    expect(st.transform ?? "").not.toContain("translateY");
    // Below the cursor's glyph, not overlapping it.
    expect(Number(st.top)).toBeGreaterThanOrEqual(4 + 22);
  });

  it("flips left near the right edge so it cannot run off", () => {
    expect(tipStyle({ x: 880, y: 200 }, W).transform).toContain("translateX(-100%)");
    expect(tipStyle({ x: 100, y: 200 }, W).transform ?? "").not.toContain("translateX");
  });

  it("can flip on both axes at once", () => {
    const st = tipStyle({ x: 880, y: 4 }, W);
    expect(st.transform).toContain("translateX(-100%)");
    expect(st.transform).not.toContain("translateY");
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

describe("the hit-test", () => {
  const plot = { w: W, h: H };

  it("finds the word under the pointer", () => {
    expect(nearestWord(points, plot, FIRST.x, FIRST.y, 7)).toBe(FIRST.word);
    expect(nearestWord(points, plot, LAST.x, LAST.y, 7)).toBe(LAST.word);
  });

  it("finds nothing out in the white", () => {
    expect(nearestWord(points, plot, FIRST.x, LAST.y, 7)).toBeNull();
  });

  it("never returns a word with no level", () => {
    // "john" is the fixture's "-". Nothing is plotted for it, so no radius can reach it.
    for (let x = 0; x <= W; x += 4)
      for (let y = 0; y <= H; y += 4) expect(nearestWord(points, plot, x, y, 22)).not.toBe("john");
  });

  it("reaches further for a finger than for a cursor", () => {
    const off = { x: FIRST.x + 14, y: FIRST.y };
    expect(nearestWord(points, plot, off.x, off.y, 7)).toBeNull();
    expect(nearestWord(points, plot, off.x, off.y, 22)).toBe(FIRST.word);
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
    words: Array.from({ length: 30_000 }, (_, i) => `w${i}`),
  };
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => wide })));
  });

  const axis = async () => {
    render(<DefiningScatter source="pt" anchorWord={null} onSelect={() => {}} />);
    await screen.findByRole("img");
    // The label layer, not the hover label, which is the wrapper's other aria-hidden child.
    const labels = [...document.querySelectorAll<HTMLElement>("figure div[aria-hidden] span")];
    return {
      written: labels.map((el) => el.textContent ?? ""),
      at: (text: string) =>
        parseFloat(labels.find((el) => el.textContent === text)?.style.left ?? "NaN"),
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
