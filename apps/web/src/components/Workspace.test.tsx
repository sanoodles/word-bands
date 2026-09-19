// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import {
  DEFINING_LANGS,
  englishName,
  hasDefining,
  SOURCE_LANGS,
  type SourceLang,
} from "@/lib/languages";
import Workspace from "./Workspace";

// Isolate the search box + lookup wiring from the data-fetching band browser, but
// still render the view toggle it hosts (Workspace owns it, via the viewControl slot).
// The "pick word" button stands in for the browser's chips and prev/next steppers.
vi.mock("./BandBrowser", () => ({
  default: ({
    viewControl,
    onSelect,
  }: {
    viewControl?: ReactNode;
    onSelect: (word: string) => void;
  }) => (
    <div>
      band browser{viewControl}
      <button type="button" onClick={() => onSelect("Plädoyer")}>
        pick word
      </button>
    </div>
  ),
}));

// Words the corpus stores capitalized — the API answers with that casing, not the
// lowercased lookup key.
const DISPLAY: Record<string, string> = { plädoyer: "Plädoyer", wasser: "Wasser" };

type Level = { key: string; label: string; rank: number };

function mockFetch(levels?: Record<string, Level>) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/api/word/")) {
      const path = new URL(u, "http://localhost").pathname;
      const word = decodeURIComponent(path.split("/api/word/")[1]!);
      // "cordon" is the accentless spelling: the typeahead reaches "cordón", Enter does not.
      if (word === "missing" || word === "cordon") return new Response("no", { status: 404 });
      // An inflected form answers with its base word, and says which form was asked for.
      const redirect = word === "branched";
      const display = redirect ? "branch" : DISPLAY[word] ?? word;
      return new Response(
        JSON.stringify({
          word: display,
          forms: [display],
          rank: 1,
          freq: { key: "1", label: "Top 1,000" },
          cefr: { key: "A1", label: "A1 · Beginner" },
          ...(redirect ? { from: word } : {}),
        }),
        { status: 200 },
      );
    }
    // The card's translation; its leading term is what a language swap carries over.
    // `levels` is what makes an alternative clickable, so only the tests about that pass any.
    if (u.includes("/api/translate/")) {
      return new Response(
        JSON.stringify({
          translation: "water",
          groups: [{ pos: "noun", terms: ["water", "aqua"] }],
          levels,
        }),
      );
    }
    if (u.includes("/api/suggest")) {
      const q = new URL(u, "http://localhost").searchParams.get("q") ?? "";
      // The real index folds diacritics off its entries, which is what lets a word
      // typed without them be found (BAND-14).
      const fold = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      const matches = ["care", "cat", "carbon", "cordón"].filter((w) =>
        fold(w).startsWith(fold(q)),
      );
      return new Response(JSON.stringify(matches), { status: 200 });
    }
    return new Response("no", { status: 404 });
  });
}

beforeEach(() => {
  localStorage.clear();
  // The workspace mirrors state into the URL; reset it so tests don't leak scenarios.
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", mockFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Workspace", () => {
  it("puts a single search box, in a search landmark, above the view", () => {
    render(<Workspace />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /look up a word/i })).toBeInTheDocument();
    // one shared search box, not one per view
    expect(screen.getAllByRole("combobox", { name: /look up a word/i })).toHaveLength(1);
  });

  // The page opens ready to be typed into, on the one thing it is for.
  it("opens with the search box focused and its word selected", async () => {
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i }) as HTMLInputElement;
    expect(box).toHaveFocus();
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    // Selected, so the first keystroke asks for a different word rather than editing this
    // one. Typed without a click, which is the point: nothing was touched to get here.
    await userEvent.setup().keyboard("cat");
    expect(box.value).toBe("cat");
  });

  // The lookup echoes the corpus's casing back into the field, which collapses the
  // selection; without re-selecting, half the languages would open only half-ready.
  it("keeps the word selected across the lookup that recases it", async () => {
    window.history.replaceState(null, "", "/?source=de&word=plädoyer");
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i }) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("Plädoyer"));
    expect(box).toHaveFocus();
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, "Plädoyer".length]);
  });

  // Clicking in asks for a different word far more often than it edits this one.
  it("selects the whole word when the field is clicked into", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i }) as HTMLInputElement;
    box.blur();
    box.setSelectionRange(2, 2);
    await user.click(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    // Only the click that focuses it. A second one leaves the caret alone, so the word
    // is still editable.
    box.setSelectionRange(2, 2);
    await user.click(box);
    expect(box.selectionStart).toEqual(box.selectionEnd);
  });

  it("renders the band browser beneath the search box", () => {
    render(<Workspace />);
    expect(screen.getByText("band browser")).toBeInTheDocument();
  });

  // The bands still steer the browser below; the card just doesn't restate them.
  // The card carries no visible word either, so it is found by its region label.
  it("renders a card for the looked-up word, without band metadata", async () => {
    render(<Workspace />);
    const card = await screen.findByRole("region", { name: /meaning of water/i });
    expect(within(card).queryByText("Top 1,000")).not.toBeInTheDocument();
    expect(within(card).queryByText(/A1 · Beginner/)).not.toBeInTheDocument();
  });

  // The level belongs beside the word, not in the card: in Frequency view it is the only
  // place a CEFR band shows at all, and it is what the translation's badges compare against.
  it("trails the looked-up word with its CEFR level, inside the search field", async () => {
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });
    const search = screen.getByRole("search");
    expect(within(search).getByRole("img", { name: "A1 · Beginner · rank 1" })).toBeInTheDocument();
  });

  // Sitting against the text, a stale level reads as a claim about what is being typed.
  it("withholds the level the moment the field stops holding that word", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("img", { name: /A1/ });

    await user.type(screen.getByRole("combobox", { name: /look up a word/i }), "x");
    expect(screen.queryByRole("img", { name: /A1/ })).not.toBeInTheDocument();
  });

  // Enter looks a word up exactly as typed, so an accentless spelling misses where the
  // typeahead would have reached the word (BAND-14). The miss is where the spelling gets
  // offered back (WCAG 3.3.3), and the field says it holds a word the list lacks (3.3.1).
  it("offers the near match inside the error, and looks it up when pressed", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i });
    await screen.findByRole("region", { name: /meaning of water/i });
    await user.clear(box);
    await user.type(box, "cordon{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('"cordon" is not in this dictionary. Did you mean cordón?');
    await waitFor(() => expect(box).toHaveAttribute("aria-invalid", "true"));
    expect(box.getAttribute("aria-describedby")).toContain(alert.id);

    await user.click(within(alert).getByRole("button", { name: "cordón" }));
    expect(await screen.findByRole("region", { name: /meaning of cordón/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "false");
  });

  // Nothing to suggest: the message stands on its own rather than inventing a word.
  it("offers nothing where the corpus has no near match", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });
    const box = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(box);
    await user.type(box, "missing{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('"missing" is not in this dictionary');
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows no level at all when the lookup fails", async () => {
    window.history.replaceState(null, "", "/?source=en&word=missing");
    render(<Workspace />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("switches source language and looks its default word up in that dictionary", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i }); // English default settled
    await user.click(screen.getByRole("combobox", { name: /source language/i }));
    await user.click(await screen.findByRole("option", { name: /Español/ }));
    expect(await screen.findByRole("region", { name: /meaning of agua/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/agua?source=es"));
  });

  // The word a switch lands on is a place to land, not a word anyone asked for, so the
  // field ends up focused with it selected, exactly as the page opens. On a phone that is
  // the whole difference: without it the keyboard is not even up, and the word has to be
  // selected by hand before a new one can be typed over it. German, so the selection also
  // has to survive the lookup echoing the corpus's casing back into the field.
  it("focuses the field and selects the word when the source language is switched", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i }) as HTMLInputElement;
    await screen.findByRole("region", { name: /meaning of water/i }); // English default settled
    await user.click(screen.getByRole("combobox", { name: /source language/i }));
    await user.click(await screen.findByRole("option", { name: /Deutsch/ }));
    await waitFor(() => expect(box.value).toBe("Wasser"));
    await waitFor(() => expect(box).toHaveFocus());
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, "Wasser".length]);
    // Typed without a tap, which is the point.
    await user.keyboard("hund");
    expect(box.value).toBe("hund");
  });

  // The other half of the rule above: a focus move on a setting change is a change of
  // context, and WCAG 3.2.2 allows one only where the user was advised first. The advice
  // is read on focus, so it arrives before the menu opens — and the field cannot carry it,
  // since it is read once the move has already happened.
  it("says on the source select that a pick moves focus", async () => {
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });
    expect(screen.getByRole("combobox", { name: /source language/i })).toHaveAccessibleDescription(
      /search box takes focus/i,
    );
    // The target pick moves nothing, so it says nothing.
    expect(screen.getByRole("combobox", { name: /target language/i })).toHaveAccessibleDescription(
      "",
    );
  });

  // A swap turns the languages over too, but it lands on the word the learner was reading
  // in the card rather than on a default one — so the field is left as it is, and on a
  // phone no keyboard comes up over the translation.
  it("does not touch focus or the selection when the languages are swapped", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?source=de&word=plädoyer&target=en");
    render(<Workspace />);
    const box = screen.getByRole("combobox", { name: /look up a word/i }) as HTMLInputElement;
    await screen.findByRole("region", { name: /meaning of Plädoyer/i });
    await user.click(screen.getByRole("button", { name: /swap the source and target/i }));
    await waitFor(() => expect(box.value).toBe("water"));
    expect(box).not.toHaveFocus();
  });

  // jsdom's navigator.language is en-US, so the browser is a reader of English
  // throughout — which is what the corporate-laptop case looks like abroad.
  describe("the languages a first-time visitor lands on", () => {
    // The mirrored URL, not the translate fetch: the word card caches translations across
    // renders, so an earlier test having asked for the same pair spares the request.
    const settlesOn = (source: string, target: string) =>
      waitFor(() => {
        const p = new URLSearchParams(window.location.search);
        expect([p.get("source"), p.get("target")]).toEqual([source, target]);
      });

    it("studies the language of the country the client is in", async () => {
      render(<Workspace country="ES" />);
      expect(await screen.findByRole("region", { name: /meaning of agua/i })).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/agua?source=es"));
      await settlesOn("es", "en");
    });

    it("studies English where no language it indexes is spoken", async () => {
      render(<Workspace country="JP" />);
      expect(await screen.findByRole("region", { name: /meaning of water/i })).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/water?source=en"));
    });

    // The pair the app used to open on for an English browser, which translated a word
    // into its own language.
    it("never translates a word into the language being studied", async () => {
      render(<Workspace />);
      await screen.findByRole("region", { name: /meaning of water/i });
      await settlesOn("en", "es");
    });

    // @spec URL-5
    it("yields to a language the visitor picked before", async () => {
      localStorage.setItem("word-bands:source", "it");
      render(<Workspace country="ES" />);
      expect(await screen.findByRole("region", { name: /meaning of acqua/i })).toBeInTheDocument();
    });

    // @spec URL-5
    it("yields to a shared deeplink", async () => {
      window.history.replaceState(null, "", "/?source=de&word=wasser&target=en");
      render(<Workspace country="ES" />);
      expect(await screen.findByRole("region", { name: /meaning of wasser/i })).toBeInTheDocument();
      await settlesOn("de", "en");
    });
  });

  it("moves the target aside when the visitor studies the language it translated into", async () => {
    const user = userEvent.setup();
    render(<Workspace />); // opens on en → es
    await screen.findByRole("region", { name: /meaning of water/i });

    await user.click(screen.getByRole("combobox", { name: /source language/i }));
    await user.click(await screen.findByRole("option", { name: /Español/ }));

    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get("source")).toBe("es");
      expect(p.get("target")).toBe("en");
    });
  });

  it("opens on the CEFR view and lets the user switch to Frequency", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.getByRole("radio", { name: /CEFR/ })).toHaveAttribute("aria-checked", "true");

    const freq = screen.getByRole("radio", { name: /Frequency/ });
    expect(freq).toHaveAttribute("aria-checked", "false");
    await user.click(freq);
    expect(freq).toHaveAttribute("aria-checked", "true");
  });

  it("credits the active view's data source", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    expect(screen.getByRole("link", { name: "CEFR-J" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Frequency/ }));
    expect(screen.getByRole("link", { name: "SUBTLEX-US" })).toBeInTheDocument();
  });

  // The Sources line, found through a link every language carries.
  const creditsFor = (source: SourceLang) => {
    window.history.replaceState(null, "", `/?source=${source}`);
    render(<Workspace />);
    return screen.getByRole("link", { name: "CEFR-J" }).closest("p")!;
  };

  // @spec CREDIT-1, CREDIT-2
  it("credits the dictionary and the works behind a language's defining levels", () => {
    for (const source of DEFINING_LANGS) {
      const credits = creditsFor(source);
      const link = (name: string) => within(credits).getByRole("link", { name });
      expect(link(`${englishName(source)} Wiktionary`)).toHaveAttribute(
        "href",
        `https://${source}.wiktionary.org/`,
      );
      expect(link("CC BY-SA 4.0")).toHaveAttribute(
        "href",
        "https://creativecommons.org/licenses/by-sa/4.0/",
      );
      expect(link("Wiktextract")).toBeInTheDocument();
      expect(link("Blondin Massé et al. (2008)")).toBeInTheDocument();
      expect(link("Vincent-Lamarre et al. (2016)")).toBeInTheDocument();
      expect(link("Seidman, 1983")).toBeInTheDocument();
      expect(credits).toHaveTextContent("West & Endicott (1935)");
      expect(credits).toHaveTextContent("Longman Dictionary of Contemporary English (1978)");
      cleanup();
    }
  });

  // @spec CREDIT-4
  it("credits the lemmatization list under its license in every language", () => {
    for (const source of SOURCE_LANGS) {
      const credits = creditsFor(source);
      const link = (name: string) => within(credits).getByRole("link", { name });
      expect(link("lemmatization list")).toHaveAttribute(
        "href",
        "https://github.com/michmech/lemmatization-lists",
      );
      expect(link("ODbL 1.0")).toHaveAttribute(
        "href",
        "https://opendatacommons.org/licenses/odbl/1-0/",
      );
      cleanup();
    }
  });

  // @spec CREDIT-3
  it("credits the Leipzig Corpora in every language", () => {
    for (const source of SOURCE_LANGS) {
      const credits = creditsFor(source);
      expect(within(credits).getByRole("link", { name: "Leipzig Corpora" })).toBeInTheDocument();
      cleanup();
    }
  });

  // @spec CREDIT-1
  it("credits no dictionary where a language has no defining levels", () => {
    for (const source of SOURCE_LANGS.filter((l) => !hasDefining(l))) {
      const credits = creditsFor(source);
      expect(within(credits).queryByRole("link", { name: /Wiktionary|Wiktextract/ })).toBeNull();
      cleanup();
    }
  });

  it("offers a debounced typeahead that looks up the picked word", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i }); // initial lookup settled

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "ca");
    await user.click(await screen.findByRole("option", { name: "care" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/care")),
    );
  });

  it("puts the browsed word in the search box with its display casing", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i }); // initial lookup settled

    await user.click(screen.getByRole("button", { name: "pick word" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/pl%C3%A4doyer")),
    );
    expect(screen.getByRole("combobox", { name: /look up a word/i })).toHaveValue("Plädoyer");
  });

  // The frame follows `loading`, so the hero row never resizes under the browser.
  it("holds the card's frame from the first paint, before the lookup lands", () => {
    render(<Workspace />);
    expect(screen.getByRole("region", { name: /meaning of water/i })).toBeInTheDocument();
  });

  // A blank word is not a wait, or the card would spin for good. The frame follows
  // `loading`, so a wait that never ends is a frame that never goes.
  it("stops waiting when the deeplink carries nothing to look up", async () => {
    window.history.replaceState(null, "", "/?source=en&word=%20");
    render(<Workspace />);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /meaning of/i })).not.toBeInTheDocument(),
    );
  });

  it("drops the frame again when the word turns out not to exist", async () => {
    window.history.replaceState(null, "", "/?source=en&word=missing");
    render(<Workspace />);
    expect(screen.getByRole("region", { name: /meaning of missing/i })).toBeInTheDocument();

    await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: /meaning of/i })).not.toBeInTheDocument();
  });

  // There is no submit button: settling on a word is the ask.
  it("looks a word up once typing settles on one the corpus knows", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i }); // initial lookup settled

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "cat");

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/cat")));
    // The suggestions stay up — they are also the way on to a longer word.
    expect(screen.getByRole("option", { name: "cat" })).toBeInTheDocument();
  });

  // A prefix is not an ask: "ca" is no word, so nothing is looked up and nothing fails.
  it("stays quiet while the typed text is only a prefix", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "ca");
    await screen.findByRole("option", { name: "care" }); // suggestions landed

    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/word/ca?"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Fondue builds part of this markup, and each of these was wrong until it was corrected
  // by hand. None is visible in our own JSX, so nothing else would notice them coming back.
  describe("what is said once, and only once", () => {
    it("does not let Fondue's stacked label double the view switch's name", async () => {
      render(<Workspace />);
      expect(await screen.findByRole("radio", { name: "CEFR" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Frequency" })).toBeInTheDocument();
    });

    it("hides Fondue's painted placeholder, which is not the field's name", async () => {
      const { container } = render(<Workspace />);
      await screen.findByRole("combobox", { name: /look up a word/i });
      const painted = container.querySelector("form[role=search] div:has(> input) > div:first-child");
      expect(painted).toHaveTextContent("look up a word");
      expect(painted).toHaveAttribute("aria-hidden", "true");
    });

    it("names the field from its heading rather than a second copy of the string", async () => {
      render(<Workspace />);
      const box = await screen.findByRole("combobox", { name: /look up a word/i });
      expect(box).not.toHaveAttribute("aria-label");
      expect(box).toHaveAttribute("aria-labelledby", "search-heading");
    });

    // Referenced directly by aria-describedby it still describes the field; without this
    // it is also read as page content on the way past.
    it("keeps the field's help out of the reading order", async () => {
      render(<Workspace />);
      await screen.findByRole("combobox", { name: /look up a word/i });
      expect(document.getElementById("search-help")).toHaveAttribute("aria-hidden", "true");
    });

    it("names the language in English in English prose, not with its endonym", async () => {
      window.history.replaceState(null, "", "/?source=de&word=wasser");
      render(<Workspace />);
      await screen.findByRole("combobox", { name: /look up a word/i });
      expect(document.getElementById("search-help")).toHaveTextContent(/Type a German word/);
      expect(document.getElementById("search-help")).not.toHaveTextContent(/Deutsch/);
    });
  });

  const swapButton = () => screen.getByRole("button", { name: /^swap/i });

  it("swaps the pair and carries the word over as its own translation", async () => {
    window.history.replaceState(null, "", "/?source=de&word=wasser&target=en");
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByText("water, aqua"); // the translation the swap will land on

    await user.click(swapButton());

    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get("source")).toBe("en");
      expect(p.get("target")).toBe("de");
      expect(p.get("word")).toBe("water");
    });
  });

  // Only the six indexed languages have a word list to browse.
  it("refuses to swap into a language that cannot be studied", async () => {
    window.history.replaceState(null, "", "/?source=de&word=wasser&target=ja");
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of wasser/i });

    expect(swapButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(swapButton());
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("source")).toBe("de");
    });
  });

  const AQUA: Record<string, Level> = { aqua: { key: "C1", label: "C1 · Advanced", rank: 18422 } };

  // The other way the pair turns over: not the leading term the swap button takes, but
  // whichever alternative was clicked. A pair no other test looks up, since the card's
  // gloss cache is module-level by design and the one here is the only one with levels.
  it("studies the language a clicked alternative is written in", async () => {
    vi.stubGlobal("fetch", mockFetch(AQUA));
    window.history.replaceState(null, "", "/?source=fr&word=eau&target=en");
    const user = userEvent.setup();
    render(<Workspace />);

    await user.click(await screen.findByRole("button", { name: "aqua" }));

    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get("source")).toBe("en");
      expect(p.get("target")).toBe("fr");
      expect(p.get("word")).toBe("aqua");
    });
  });

  // Same gate as the swap button: there is nowhere to land in a language we hold no list for.
  it("offers no alternative to click where the target cannot be studied", async () => {
    vi.stubGlobal("fetch", mockFetch(AQUA));
    window.history.replaceState(null, "", "/?source=fr&word=eau&target=ja");
    render(<Workspace />);
    await screen.findByText("C1");
    expect(screen.queryByRole("button", { name: "aqua" })).not.toBeInTheDocument();
  });

  it("restores the source language and word from the URL", async () => {
    window.history.replaceState(null, "", "/?source=es&word=agua");
    render(<Workspace />);
    expect(await screen.findByRole("region", { name: /meaning of agua/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/word/agua?source=es"));
  });

  it("reflects the looked-up word and language in the URL", async () => {
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get("source")).toBe("en");
      expect(p.get("word")).toBe("water");
      expect(p.get("view")).toBe("cefr");
    });
  });

  it("names the looked-up word, as the corpus cases it, in the tab title", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });
    await waitFor(() => expect(document.title).toBe("word-bands: water"));

    await user.click(screen.getByRole("button", { name: "pick word" }));
    await waitFor(() => expect(document.title).toBe("word-bands: Plädoyer"));
  });

  it("announces an unknown word through an alert", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i }); // initial lookup settled

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "missing{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not in this dictionary/i);
  });

  // The field is rewritten to the word that was found, so without this the typed word
  // would just vanish — and a wrong redirect would read as the answer.
  // @spec FORM-5
  it("says which word it is showing when a form resolved to its base", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "branched{Enter}");
    await screen.findByText(/base form of/i);
    expect(screen.getByText(/base form of/i)).toHaveTextContent(/branch.*branched/);
  });

  it("says nothing of the sort for a word found as typed", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "care{Enter}");
    await screen.findByRole("region", { name: /meaning of care/i });
    expect(screen.queryByText(/base form of/i)).toBeNull();
  });

  // A live region mounted in the same commit as its text is announced by some screen
  // readers and not others, so the empty region has to precede the redirect.
  // @spec FORM-6
  it("announces the redirect from a region that was already on the page", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await screen.findByRole("region", { name: /meaning of water/i });

    // Present and empty before anything redirects, and polite rather than assertive:
    // the word was found, so there is nothing to interrupt for.
    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();
    expect(live).not.toHaveAttribute("aria-live", "assertive");

    const input = screen.getByRole("combobox", { name: /look up a word/i });
    await user.clear(input);
    await user.type(input, "branched{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/base form of/i));
    // The same node, not a replacement — that is what makes it announce.
    expect(screen.getByRole("status")).toBe(live);
  });
});

// The defining view exists only where the levels do, and the toggle is where a learner
// finds that out. Gated on the source language, so switching to a language without levels
// has to take the segment with it.
describe("the defining segment", () => {
  // Fondue stacks an active and an inactive copy of each label, so the radio's text reads
  // "DefiningDefining" and only the aria-label names it once. See ViewToggle.
  const toggle = () => screen.findByRole("radiogroup", { name: "Band view" });

  // @spec BAND-11
  it("is offered for every language with levels", async () => {
    for (const source of DEFINING_LANGS) {
      window.history.replaceState(null, "", `/?source=${source}`);
      render(<Workspace />);
      const t = await toggle();
      expect(within(t).getByRole("radio", { name: "Defining level" }), source).toBeInTheDocument();
      cleanup();
    }
  });

  // @spec BAND-11
  it("is absent for a language with no levels", async () => {
    window.history.replaceState(null, "", "/?source=en&word=water");
    render(<Workspace />);
    const t = await toggle();
    expect(within(t).getByRole("radio", { name: "CEFR" })).toBeInTheDocument();
    expect(within(t).queryByRole("radio", { name: "Defining level" })).toBeNull();
  });
});
