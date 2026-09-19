// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WordCard from "./WordCard";

// The workspace owns the target language now; a tiny stateful host stands in for it so
// picking a language in the card re-renders with the new value, as it does in the app.
function Host({
  word,
  source,
  target: initial,
}: {
  word: string;
  source: string;
  target: string;
}) {
  const [target, setTarget] = useState(initial);
  return (
    <WordCard
      word={word}
      forms={[word]}
      source={source}
      target={target}
      onTargetChange={setTarget}
    />
  );
}

// Translate stub: returns a per-language translation so we can assert re-translation.
const GLOSS: Record<string, string> = { es: "agua", fr: "eau" };
function mockFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/api/translate/")) {
      const tl = new URL(u, "http://localhost").searchParams.get("target") ?? "";
      return new Response(JSON.stringify({ word: "water", tl, translation: GLOSS[tl] ?? "" }));
    }
    return new Response("no", { status: 404 });
  });
}

const selector = () => screen.getByRole("combobox", { name: /target language/i });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", mockFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WordCard language selector", () => {
  it("shows the target language and skips translating a word into its own language", () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="en" onTargetChange={() => {}} />);
    // Fondue's Select shows the picked language's endonym in its trigger, not a value.
    expect(selector()).toHaveTextContent("English");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("always offers a Google Translate link opening in a new tab, even for English", () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="en" onTargetChange={() => {}} />);
    const link = screen.getByRole("link", { name: /google translate/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("translate.google.com");
  });

  it("translates the word into the target language", async () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="es" onTargetChange={() => {}} />);
    expect(selector()).toHaveTextContent(/español/i);
    expect(await screen.findByText("agua")).toBeInTheDocument();
  });

  it("translates from a non-English source language, tagging the request with sl", async () => {
    render(<WordCard word="water" forms={["water"]} source="es" target="fr" onTargetChange={() => {}} />);
    expect(await screen.findByText("eau")).toBeInTheDocument();
    const call = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.find(([u]) =>
      String(u).includes("/api/translate/"),
    );
    expect(String(call![0])).toContain("source=es");
  });

  it("re-translates and reports the pick when the language changes", async () => {
    const onTargetChange = vi.fn();
    render(<WordCard word="water" forms={["water"]} source="en" target="es" onTargetChange={onTargetChange} />);
    await screen.findByText("agua");

    // Open the Fondue Select and pick French from the listbox.
    await userEvent.click(selector());
    await userEvent.click(await screen.findByRole("option", { name: /français/i }));

    expect(onTargetChange).toHaveBeenCalledWith("fr");
  });

  it("re-translates through a stateful host when the language changes", async () => {
    render(<Host word="water" source="en" target="es" />);
    await screen.findByText("agua");

    await userEvent.click(selector());
    await userEvent.click(await screen.findByRole("option", { name: /français/i }));

    expect(await screen.findByText("eau")).toBeInTheDocument();
  });
});

// A dt=1 fetch stub that translates each casing from a lookup table of senses.
function mockDict(senses: Record<string, string[]>) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url), "http://localhost");
    const form = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
    const s = senses[form] ?? [];
    return new Response(JSON.stringify({ word: form, target: "en", translation: form, senses: s }));
  });
}

// The workspace renders this frame before the lookup lands, so the hero row is
// already its settled height and the browser below it never gets shoved down.
describe("WordCard pending", () => {
  it("holds the whole frame, translating nothing, until the forms arrive", () => {
    const { rerender } = render(
      <WordCard word="water" forms={null} source="es" target="en" onTargetChange={() => {}} />,
    );
    expect(screen.getByRole("region", { name: /meaning of water/i })).toBeInTheDocument();
    expect(selector()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /google translate/i })).toBeInTheDocument();
    expect(screen.getByText("Translating…")).toBeInTheDocument();
    // Nothing is known to be translatable yet — the word may not even be a word.
    expect(fetch).not.toHaveBeenCalled();

    rerender(<WordCard word="water" forms={["water"]} source="es" target="en" onTargetChange={() => {}} />);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/translate/water"), expect.anything());
  });
});

describe("WordCard case-homographs", () => {
  it("shows a distinct translation for each casing", async () => {
    vi.stubGlobal("fetch", mockDict({ Essen: ["food", "meal"], essen: ["to eat", "dine"] }));
    render(<WordCard word="Essen" forms={["Essen", "essen"]} source="de" target="en" onTargetChange={() => {}} />);
    // Both lines and the lowercase casing label appear (the noun label doubles the hero).
    expect(await screen.findByText("food, meal")).toBeInTheDocument();
    expect(await screen.findByText("to eat, dine")).toBeInTheDocument();
    expect(screen.getByText("essen")).toBeInTheDocument();
  });

  it("collapses to one line when the casings mean the same thing", async () => {
    // "wer"/"Wer" both translate to "who" — no distinct sense, so only one line shows.
    vi.stubGlobal("fetch", mockDict({ Wer: ["who"], wer: ["who"] }));
    render(<WordCard word="Wer" forms={["Wer", "wer"]} source="de" target="en" onTargetChange={() => {}} />);
    expect(await screen.findByText("who")).toBeInTheDocument();
    expect(screen.getAllByText("who")).toHaveLength(1);
    expect(screen.queryByText("wer")).not.toBeInTheDocument();
  });
});

// A dict-mode stub returning Google's part-of-speech groups for a single-casing word.
function mockGroups(
  groups: { pos: string; terms: string[] }[],
  translation: string,
  levels: Record<string, { key: string; label: string; rank: number }> = {},
) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url), "http://localhost");
    const word = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
    return new Response(
      JSON.stringify({ word, target: "en", translation, senses: [], groups, levels }),
    );
  });
}

describe("WordCard multi-sense words", () => {
  // Italian "solo": adjective "only/alone" and adverb "just" — one word, two readings.
  it("lists a line per part of speech when a word reads as more than one", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups(
        [
          { pos: "adjective", terms: ["only", "alone"] },
          { pos: "adverb", terms: ["just"] },
        ],
        "Alone",
      ),
    );
    render(<WordCard word="solo" forms={["solo"]} source="it" target="en" onTargetChange={() => {}} />);
    expect(await screen.findByText("only, alone")).toBeInTheDocument();
    expect(screen.getByText("just")).toBeInTheDocument();
    expect(screen.getByText("adjective")).toBeInTheDocument();
    expect(screen.getByText("adverb")).toBeInTheDocument();
  });

  it("keeps a single reading as one unlabelled line", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["water"] }], "water"));
    render(
      <WordCard word="acqua" forms={["acqua"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("water")).toBeInTheDocument();
    expect(screen.queryByText("noun")).not.toBeInTheDocument();
  });

  it("prefers the dictionary terms over a poor plain translation", async () => {
    // Real case: "acqua" plainly translates to "waterfall", but the dictionary is right.
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "waterfall"));
    render(
      <WordCard word="acquario" forms={["acquario"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("water, aqua")).toBeInTheDocument();
    expect(screen.queryByText("waterfall")).not.toBeInTheDocument();
  });

  it("falls back to the plain translation when there is no dictionary entry", async () => {
    vi.stubGlobal("fetch", mockGroups([], "Milan"));
    render(
      <WordCard word="Milano" forms={["Milano"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("Milan")).toBeInTheDocument();
  });

  // The spinner row is shorter than the translation it stands in for.
  it("reserves the translation's line box while translating", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["sky"] }], "sky"));
    render(
      <WordCard word="cielo" forms={["cielo"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    const spinner = screen.getByText("Translating…").closest("div.Loading");
    expect(spinner).toHaveClass("tw-min-h-[var(--typography-line-height-loose)]");
    // Not a nested live region: the card's own wrapper announces this already.
    expect(spinner).not.toHaveAttribute("role");
    expect((await screen.findByText("sky")).style.lineHeight).toBe(
      "var(--typography-line-height-loose)",
    );
  });

  it("asks for the dictionary block, which is what carries the readings", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["need"] }], "need"));
    // A word no other test looks up — `glossCache` is module-level, by design.
    render(
      <WordCard word="bisogno" forms={["bisogno"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    await screen.findByText("need");
    const call = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(String(call[0])).toContain("dict=1");
  });
});

const A1 = { key: "A1", label: "A1 · Beginner", rank: 391 };
const B2 = { key: "B2", label: "B2 · Upper-intermediate", rank: 9002 };

// Google orders the alternatives by confidence, not by difficulty, so "water" and
// "aqua" arrive as equals. The level is what tells a learner which one is theirs.

/** The line as it reads: the badges annotate it, they are not part of it. */
function reading(): string {
  const line = document.querySelector("[aria-live] span[lang]");
  if (!line) throw new Error("no translation line");
  return [...line.querySelectorAll('[role="img"]')].reduce(
    (text, badge) => text.replace(badge.textContent ?? "", ""),
    line.textContent ?? "",
  );
}

describe("WordCard levels", () => {
  it("trails each alternative with its own CEFR level", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "water", { water: A1, aqua: B2 }),
    );
    render(<WordCard word="agua" forms={["agua"]} source="es" target="en" onTargetChange={() => {}} />);

    // The badges annotate the line; its text is still the translation itself.
    await screen.findByText("water");
    expect(reading()).toBe("water, aqua");
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("B2")).toBeInTheDocument();
  });

  // Tabbing lands on a badge on its own, where "A1 · Beginner" has no subject unless the
  // badge says which word it is for. Reading the line, the two are already adjacent.
  it("tells each badge which word it belongs to", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "water", { water: A1, aqua: B2 }),
    );
    render(<WordCard word="agua" forms={["agua"]} source="es" target="en" onTargetChange={() => {}} />);
    await screen.findByText("water");

    for (const [term, band] of [["water", "A1"], ["aqua", "B2"]]) {
      const badge = screen.getByText(band!);
      const described = badge.getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      expect(document.getElementById(described!)).toHaveTextContent(term!);
    }
  });

  it("names the badge with its band and rank, for hover and for AT alike", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["sea"] }], "sea", { sea: A1 }));
    render(<WordCard word="mare" forms={["mare"]} source="it" target="en" onTargetChange={() => {}} />);
    await screen.findByText("sea");
    expect(screen.getByRole("img", { name: "A1 · Beginner · rank 391" })).toBeInTheDocument();
  });

  // Only the six indexed languages have levels; the server sends none for the rest.
  it("leaves the line unbadged when the language has no levels", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["mizu"] }], "mizu"));
    render(<WordCard word="acqua" forms={["acqua"]} source="it" target="ja" onTargetChange={() => {}} />);
    await screen.findByText("mizu");
    expect(screen.queryByText("A1")).not.toBeInTheDocument();
  });

  it("badges only the terms the target language actually carries", async () => {
    vi.stubGlobal(
      "fetch",
      // "usar naja" is a phrase, so it has no rank to show.
      mockGroups([{ pos: "noun", terms: ["knife", "usar naja"] }], "knife", { knife: A1 }),
    );
    render(<WordCard word="faca" forms={["faca"]} source="pt" target="en" onTargetChange={() => {}} />);
    await screen.findByText("knife");
    expect(reading()).toBe("knife, usar naja");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("levels each casing's translation of a case-homograph", async () => {
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      const u = new URL(String(url), "http://localhost");
      const form = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
      const senses = form === "Essen" ? ["food"] : ["dine"];
      const levels = form === "Essen" ? { food: A1 } : { dine: B2 };
      return new Response(JSON.stringify({ word: form, target: "en", translation: form, senses, levels }));
    }) as typeof fetch);
    render(<WordCard word="Essen" forms={["Essen", "essen"]} source="de" target="en" onTargetChange={() => {}} />);

    expect(await screen.findByText("food")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("B2")).toBeInTheDocument();
  });
});

// A level is the target language's own list vouching for the term, so a badged term is a
// word that language has — which is exactly the condition for going and studying it.
describe("WordCard picking a translation", () => {
  it("offers each alternative the target language carries as a way into it", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["lake", "loch"] }], "lake", { lake: A1, loch: B2 }),
    );
    const picked: string[] = [];
    render(
      <WordCard
        word="lago"
        forms={["lago"]}
        source="it"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={(t) => picked.push(t)}
      />,
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "loch" }));
    expect(picked).toEqual(["loch"]);
  });

  // A phrase has no rank, so it has no entry to land on either.
  it("leaves a term the language does not carry as plain text", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["blade", "usar faca"] }], "blade", { blade: A1 }),
    );
    render(
      <WordCard
        word="lâmina"
        forms={["lâmina"]}
        source="pt"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={() => {}}
      />,
    );
    await screen.findByRole("button", { name: "blade" });
    expect(screen.queryByRole("button", { name: "usar faca" })).not.toBeInTheDocument();
    expect(reading()).toBe("blade, usar faca");
  });

  // The word is the name; what clicking does is a description, announced on focus alone.
  // A name saying it would replace the word, and the line would stop reading as the
  // translation it is.
  it("names the button with the word and describes it with what a pick does", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["book"] }], "book", { book: A1 }));
    render(
      <WordCard
        word="libro"
        forms={["libro"]}
        source="it"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={() => {}}
      />,
    );
    const button = await screen.findByRole("button", { name: "book" });
    const described = button.getAttribute("aria-describedby");
    expect(document.getElementById(described!)).toHaveTextContent(
      "Look this word up in English, swapping the two languages.",
    );
    expect(reading()).toBe("book");
  });

  // The pick turns the pair over at once and the word lands with the lookup a tick later,
  // which is the order the workspace does it in — and the order that matters, since the
  // button is gone before the new word arrives.
  function PickHost() {
    const [pair, setPair] = useState({ source: "it", target: "en" });
    const [word, setWord] = useState("lago");
    return (
      <WordCard
        word={word}
        forms={[word]}
        source={pair.source}
        target={pair.target}
        onTargetChange={() => {}}
        onPickTerm={(t) => {
          setPair({ source: "en", target: "it" });
          setTimeout(() => setWord(t), 0);
        }}
      />
    );
  }

  it("takes focus to the card when the pick removes the button holding it", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["lake", "loch"] }], "lake", { lake: A1, loch: B2 }),
    );
    render(<PickHost />);
    const button = await screen.findByRole("button", { name: "loch" });
    button.focus();
    await userEvent.setup().click(button);
    // Named for the word picked, not the one left behind.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Meaning of loch" })).toHaveFocus(),
    );
    // A landing place only: nothing puts the card in the tab order.
    expect(screen.getByRole("region", { name: "Meaning of loch" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("offers nothing to click where the workspace passes no way to pick", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["river"] }], "river", { river: A1 }));
    render(
      <WordCard word="fiume" forms={["fiume"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    await screen.findByText("river");
    expect(screen.queryByRole("button", { name: "river" })).not.toBeInTheDocument();
    // Still the badge's subject, so tabbing to the level still says which word it is for.
    const described = screen.getByText("A1").getAttribute("aria-describedby");
    expect(document.getElementById(described!)).toHaveTextContent("river");
  });
});
