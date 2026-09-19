// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BandBrowser from "./BandBrowser";

const SUMMARY = {
  freq: [
    { key: "1", label: "Top 1,000", count: 1000 },
    { key: "2", label: "1,001–2,000", count: 1000 },
  ],
  cefr: [
    { key: "A1", label: "A1 · Beginner", count: 1000 },
    { key: "B1", label: "B1 · Intermediate", count: 3000 },
  ],
};
const WORDS: Record<string, string[]> = {
  "freq:1": ["the", "be", "water"],
  "freq:2": ["mountain", "engine"],
  "cefr:A1": ["the", "be", "water"],
  "cefr:B1": ["govern", "signal"],
};

function mockFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    let m = u.match(/\/api\/bands\/(\w+)/);
    if (m) return new Response(JSON.stringify(SUMMARY[m[1] as "freq" | "cefr"]), { status: 200 });
    m = u.match(/\/api\/band\/(\w+)\/([^/?]+)/);
    if (m) {
      const key = `${m[1]}:${decodeURIComponent(m[2]!)}`;
      const words = WORDS[key];
      if (!words) return new Response("unknown band", { status: 404 }); // as the real API does
      const label = [...SUMMARY.freq, ...SUMMARY.cefr].find((b) => b.key === m![2])?.label ?? key;
      return new Response(JSON.stringify({ key: m[2], label, words }), { status: 200 });
    }
    return new Response("no", { status: 404 });
  });
}

beforeEach(() => vi.stubGlobal("fetch", mockFetch()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BandBrowser", () => {
  it("renders the active view's band tabs with counts and shows the first band", async () => {
    render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
    expect(await screen.findByRole("tab", { name: /Top 1,000/ })).toBeInTheDocument();
    // First band opens by default; its words render as chips.
    expect(await screen.findByRole("option", { name: "water" })).toBeInTheDocument();
  });

  // The role promises a screen reader one stop with arrow keys inside it, and a panel
  // the tabs open. Both halves were announced long before either was true.
  describe("the tabs are a real tablist", () => {
    const tabs = () => screen.getAllByRole("tab");

    it("is one tab stop, on the selected tab", async () => {
      render(<BandBrowser view="cefr" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
      await screen.findByRole("tab", { name: /A1/ });
      expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1]);
      expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    });

    it("moves between tabs on arrow keys, and wraps", async () => {
      render(<BandBrowser view="cefr" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
      (await screen.findByRole("tab", { name: /A1/ })).focus();

      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() => expect(tabs()[1]).toHaveAttribute("aria-selected", "true"));
      expect(tabs()[1]).toHaveFocus();
      expect(await screen.findByRole("option", { name: "govern" })).toBeInTheDocument();

      await userEvent.keyboard("{ArrowRight}"); // past the end, back to the first
      await waitFor(() => expect(tabs()[0]).toHaveAttribute("aria-selected", "true"));
      await userEvent.keyboard("{End}");
      await waitFor(() => expect(tabs()[1]).toHaveAttribute("aria-selected", "true"));
    });

    it("names the panel the words sit in, and points each tab at it", async () => {
      render(<BandBrowser view="cefr" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
      const panel = await screen.findByRole("tabpanel");
      for (const tab of tabs()) expect(tab).toHaveAttribute("aria-controls", panel.id);
      expect(panel).toHaveAccessibleName("A1 · Beginner, 1,000 words");
    });

    // The two lines join with no separator of their own ("A1 · Beginner1,000 words").
    it("spells the count out in the tab's name", async () => {
      render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
      expect(await screen.findByRole("tab", { name: "Top 1,000, 1,000 words" })).toBeInTheDocument();
    });
  });

  // Neither control announces its own wait; the spinner covers both.
  it("stands one spinner in for both band controls until they load", async () => {
    render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
    expect(screen.getByText("Loading bands…")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await screen.findByRole("tab", { name: /Top 1,000/ });
    expect(screen.getByRole("combobox", { name: /frequency bands/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading bands…")).not.toBeInTheDocument();
  });

  it("opens the anchor's band and looks a chip up when picked", async () => {
    const onSelect = vi.fn();
    render(
      <BandBrowser view="cefr" source="en" anchorWord="water" anchorBandKey="A1" onSelect={onSelect} />,
    );
    await screen.findByRole("option", { name: "water" });
    await userEvent.click(screen.getByRole("option", { name: "be" }));
    expect(onSelect).toHaveBeenCalledWith("be");
  });

  it("switches bands when another tab is selected", async () => {
    render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
    await screen.findByRole("option", { name: "water" });
    await userEvent.click(await screen.findByRole("tab", { name: /1,001/ }));
    expect(await screen.findByRole("option", { name: "engine" })).toBeInTheDocument();
  });

  // The narrow-viewport dropdown. Both it and the tablist are always in the DOM —
  // a media query picks one — so jsdom, which applies no CSS, can drive either.
  it("switches bands from the band dropdown too", async () => {
    render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
    await screen.findByRole("option", { name: "water" });
    await userEvent.click(screen.getByRole("combobox", { name: /frequency bands/i }));
    await userEvent.click(await screen.findByRole("option", { name: /1,001/ }));
    expect(await screen.findByRole("option", { name: "engine" })).toBeInTheDocument();
  });

  // Mobile-only prev/next. Like the dropdown, always in the DOM — CSS alone hides it.
  it("steps to the word either side of the current one", async () => {
    const onSelect = vi.fn();
    render(
      <BandBrowser view="freq" source="en" anchorWord="be" anchorBandKey="1" onSelect={onSelect} />,
    );
    await screen.findByRole("option", { name: "water" }); // words: the, be, water
    await userEvent.click(screen.getByRole("button", { name: /next word/i }));
    expect(onSelect).toHaveBeenCalledWith("water");
    await userEvent.click(screen.getByRole("button", { name: /previous word/i }));
    expect(onSelect).toHaveBeenCalledWith("the");
  });

  // aria-disabled, so the button keeps its focus rather than dropping it to the body
  // under a finger that is already on it (WCAG 2.4.3).
  it("marks the step past each end of the band disabled, and leaves it focusable", async () => {
    const onSelect = vi.fn();
    render(
      <BandBrowser view="freq" source="en" anchorWord="the" anchorBandKey="1" onSelect={onSelect} />,
    );
    await screen.findByRole("option", { name: "water" }); // "the" is the band's first word
    const prev = screen.getByRole("button", { name: /previous word/i });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(prev).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /next word/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await userEvent.click(prev);
    expect(onSelect).not.toHaveBeenCalled();
    prev.focus();
    expect(prev).toHaveFocus();
  });

  // A hand-picked band holds no anchor, so there is nothing to step back from.
  it("enters at the first word when the band holds no current word", async () => {
    const onSelect = vi.fn();
    render(<BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={onSelect} />);
    await screen.findByRole("option", { name: "water" });
    expect(screen.getByRole("button", { name: /previous word/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: /next word/i }));
    expect(onSelect).toHaveBeenCalledWith("the");
  });

  it("reloads the summary and words when the view changes", async () => {
    const { rerender } = render(
      <BandBrowser view="freq" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />,
    );
    await screen.findByRole("tab", { name: /Top 1,000/ });
    rerender(<BandBrowser view="cefr" source="en" anchorWord={null} anchorBandKey={null} onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /A1/ })).toBeInTheDocument(),
    );
  });
});
