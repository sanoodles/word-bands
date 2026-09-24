// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WordChips, { anchorOffscreen, packRows, scrollToRow } from "./WordChips";

describe("packRows", () => {
  it("packs as many chips per row as fit the width", () => {
    // widths 30 each, gap 4, container 100 -> 30,34,34 = 98 <= 100: 3 per row.
    const starts = packRows(Array(7).fill(30), 100, 4);
    expect(starts).toEqual([0, 3, 6]);
  });

  it("always places at least one chip, even if it overflows the row", () => {
    const starts = packRows([200, 10, 10], 50, 4);
    expect(starts).toEqual([0, 1]); // 200 alone, then 10 + 4 + 10 together
  });

  it("returns no rows for an empty list", () => {
    expect(packRows([], 100, 4)).toEqual([]);
  });

  it("accounts for the inter-chip gap when deciding a break", () => {
    // Two 48-wide chips: 48 + 4 + 48 = 100 fits exactly; a third breaks.
    expect(packRows([48, 48, 48], 100, 4)).toEqual([0, 2]);
  });
});

// Decides whether the cloud offers a way back to the selected word. Rows are 40px
// tall (stride) in a 200px viewport, so rows 0–4 are the ones on screen at the top.
describe("anchorOffscreen", () => {
  it("says nothing while the anchor's row is in view", () => {
    expect(anchorOffscreen(0, 40, 0, 200)).toBeNull();
    expect(anchorOffscreen(160, 40, 0, 200)).toBeNull(); // last fully visible row
  });

  it("counts a row as in view while any part of it shows", () => {
    expect(anchorOffscreen(180, 40, 0, 200)).toBeNull(); // half below the fold
    expect(anchorOffscreen(160, 40, 180, 400)).toBeNull(); // half above it
  });

  it("reports which way the anchor went once it is fully out", () => {
    expect(anchorOffscreen(0, 40, 40, 200)).toBe("above");
    expect(anchorOffscreen(400, 40, 0, 200)).toBe("below");
  });

  it("offers nothing without an anchor, or before the cloud is measured", () => {
    expect(anchorOffscreen(null, 40, 500, 200)).toBeNull();
    expect(anchorOffscreen(400, 0, 0, 200)).toBeNull(); // rows not measured yet
    expect(anchorOffscreen(400, 40, 0, 0)).toBeNull(); // no viewport (SSR/jsdom)
  });
});

describe("scrollToRow", () => {
  // 200px of viewport, 40px rows, a 56px button strip. The anchor sits at the top,
  // so it is out of view — and the button showing — from scrollTop 40 on.
  const to = (top: number, scrollTop: number, anchorTop: number | null = 0) =>
    scrollToRow(top, 40, scrollTop, 200, anchorTop, 56);

  it("leaves a row that is already clear alone", () => {
    expect(to(0, 0)).toBeNull();
    expect(to(40, 0)).toBeNull();
  });

  it("scrolls a row above the fold to the top", () => {
    expect(to(40, 200)).toBe(40);
  });

  it("lands a row below the fold flush with the bottom while no button shows", () => {
    // An anchor at 80 is still in view at the 40 this lands on, so nothing floats
    // over the chip and it takes the whole viewport.
    expect(to(200, 0, 80)).toBe(40);
  });

  it("insets the step that scrolls the anchor out from under the reader", () => {
    // Landing flush at 40 is exactly where an anchor at 0 stops being visible, so the
    // button arrives over the chip that just landed. It has to clear it in the same move.
    expect(to(200, 0)).toBe(240 - (200 - 56));
  });

  it("keeps the row clear of the button once the anchor is gone", () => {
    // Landing flush would put scrollTop at 240, where the anchor is long out of view.
    expect(to(400, 100)).toBe(440 - (200 - 56));
  });

  it("moves a row that is in view but under the button", () => {
    // Row 400 with scrollTop 240 is fully visible — and sitting in the bottom strip.
    expect(to(400, 240)).toBe(440 - (200 - 56));
  });

  it("insets nothing when there is no anchor to lose", () => {
    expect(to(400, 100, null)).toBe(240);
  });

  it("never insets so far that the row stops fitting", () => {
    // A 60px viewport is shorter than the 56px strip: the row still lands flush.
    expect(scrollToRow(400, 40, 100, 60, 0, 56)).toBe(400);
  });

  it("does nothing before the cloud is measured", () => {
    expect(scrollToRow(400, 0, 0, 200, 0, 56)).toBeNull();
    expect(scrollToRow(400, 40, 0, 0, 0, 56)).toBeNull();
  });
});

// jsdom has no layout, so WordChips renders in its fallback (all-chips) mode —
// keyboard moves still flow through the same debounced-select path.
const WORDS = ["the", "be", "water", "mountain", "engine"];

function setup() {
  const onPick = vi.fn();
  render(
    <WordChips
      words={WORDS}
      anchor={null}
      chipClass="chip"
      anchorClass="anchor"
      onPick={onPick}
      label="Words"
    />,
  );
  return { onPick, group: screen.getByRole("listbox", { name: "Words" }) };
}

afterEach(cleanup);

// Only the rows near the viewport are in the DOM, so a chip's place in the band is
// stated rather than countable.
describe("set semantics", () => {
  it("gives every chip the band's size and its own position", () => {
    setup();
    const opts = screen.getAllByRole("option");
    expect(opts[0]).toHaveAttribute("aria-setsize", String(opts.length));
    expect(opts.map((o) => o.getAttribute("aria-posinset"))).toEqual(
      opts.map((_, i) => String(i + 1)),
    );
  });
});

describe("keyboard selection", () => {
  it("looks the focused word up after a 300ms debounce", () => {
    vi.useFakeTimers();
    try {
      const { onPick, group } = setup();
      fireEvent.keyDown(group, { key: "ArrowRight" }); // active 0 -> 1 ("be")
      vi.advanceTimersByTime(299);
      expect(onPick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith("be");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires once for the settled word when arrows sweep several chips", () => {
    vi.useFakeTimers();
    try {
      const { onPick, group } = setup();
      fireEvent.keyDown(group, { key: "ArrowRight" }); // -> "be"
      vi.advanceTimersByTime(200);
      fireEvent.keyDown(group, { key: "ArrowRight" }); // -> "water", debounce resets
      vi.advanceTimersByTime(200);
      fireEvent.keyDown(group, { key: "ArrowRight" }); // -> "mountain", resets again
      vi.advanceTimersByTime(200);
      expect(onPick).not.toHaveBeenCalled(); // never settled long enough
      vi.advanceTimersByTime(100);
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith("mountain");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending keyboard select when a chip is clicked", () => {
    vi.useFakeTimers();
    try {
      const { onPick, group } = setup();
      fireEvent.keyDown(group, { key: "ArrowRight" }); // queues "be"
      fireEvent.click(screen.getByRole("option", { name: "water" }));
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith("water");
      vi.advanceTimersByTime(300); // the queued "be" must not fire
      expect(onPick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
