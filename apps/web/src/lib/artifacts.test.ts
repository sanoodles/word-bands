import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getWord, resolveForm } from "@/lib/bands";
import formsEn from "../../data/forms.en.json";
import formsEs from "../../data/forms.es.json";
import formsFr from "../../data/forms.fr.json";
import formsDe from "../../data/forms.de.json";
import formsPt from "../../data/forms.pt.json";
import formsIt from "../../data/forms.it.json";
import rankedPt from "../../data/word-bands.pt.json";
import rankedIt from "../../data/word-bands.it.json";
import definingPt from "../../data/defining.pt.json";
import definingIt from "../../data/defining.it.json";

// The committed data/word-bands.<code>.json files are the build's output and the app's
// only corpus, so these hold whether or not anyone re-runs the build. Nothing else looks
// at what the filters in scripts/build-bands.ts actually did.

const held = (lang: Parameters<typeof getWord>[0], word: string) => getWord(lang, word) !== null;
const cased = (lang: Parameters<typeof getWord>[0], word: string) => getWord(lang, word)?.word;

// pt and fr hyphenate pronouns onto verbs, so every verb x pronoun pair spells its own
// surface form. None of them is vocabulary.
// @spec FILTER-1
describe("clitics", () => {
  it("holds no clitic surface form in Portuguese", () => {
    for (const w of ["deixa-me", "fazê-lo", "contar-te-ia"]) expect(held("pt", w), w).toBe(false);
  });

  it("holds no clitic surface form in French", () => {
    for (const w of ["donne-moi", "a-t-il", "avez-vous", "dis-moi"]) expect(held("fr", w), w).toBe(false);
  });
});

// The load-bearing detail is that segments match whole: "guarda-chuva" ends in "chuva",
// not "a", and "arc-en-ciel" in "ciel", not "en".
// @spec FILTER-2
describe("hyphenated vocabulary", () => {
  it("keeps a compound whose last segment merely ends in a clitic", () => {
    expect(held("pt", "guarda-chuva")).toBe(true);
    expect(held("fr", "arc-en-ciel")).toBe(true);
  });

  it("keeps the hyphenated words that are not clitic forms at all", () => {
    for (const w of ["rendez-vous", "garde-à-vous", "peut-être", "celui-là", "là-bas"]) {
      expect(held("fr", w), w).toBe(true);
    }
  });
});

// The lists are lemma-sorted, so first-wins hands a shared surface form to whichever
// lemma is alphabetically first — which deletes common words and floats the absorber
// into the beginner bands.
// @spec FILTER-3
describe("own-entry", () => {
  it("keeps a word that heads its own lemma entry, alongside the lemma that claims it", () => {
    expect(held("it", "governo")).toBe(true);
    expect(held("it", "governare")).toBe(true);
    expect(held("fr", "tu")).toBe(true);
    expect(held("fr", "il")).toBe(true);
  });
});

// A word is dropped as a name only when the gazetteer, the lemma list, mid-sentence
// casing and the determiner test all agree. These are what the last two tests spare.
// @spec FILTER-5
describe("personal names", () => {
  it("keeps a surname that is also an ordinary German noun", () => {
    for (const w of ["Koch", "Berg", "Kuss", "Fass", "Geduld"]) expect(cased("de", w), w).toBe(w);
  });
});

// Measured, not ruled: no per-language list of what is a proper noun is involved.
// @spec FILTER-6
describe("display casing", () => {
  it("capitalizes German nouns and proper nouns anywhere", () => {
    expect(cased("de", "wasser")).toBe("Wasser");
    expect(cased("es", "dios")).toBe("Dios");
    expect(cased("pt", "lisboa")).toBe("Lisboa");
  });

  it("leaves weekdays and months lowercase, which is where a rule would get it wrong", () => {
    expect(cased("es", "lunes")).toBe("lunes");
    expect(cased("es", "enero")).toBe("enero");
    expect(cased("es", "español")).toBe("español");
    expect(cased("it", "lunedì")).toBe("lunedì");
    expect(cased("it", "gennaio")).toBe("gennaio");
  });
});

// michmech headwords German determiners and adjectives on a bare stem, and the own-entry
// rule then hands every inflection to it — which put "jed" at rank 107 with no "jeder"
// in the list at all.
// @spec FILTER-8
describe("truncated lemma stems", () => {
  it("holds the word that is written, not the stem that heads its lemma entry", () => {
    for (const [stem, word] of [
      ["jed", "jeder"], ["beid", "beiden"], ["mehrer", "mehrere"],
      ["jeglich", "jegliche"], ["etlich", "etliche"], ["wochenend", "Wochenende"],
    ]) {
      expect(held("de", stem!), stem).toBe(false);
      expect(held("de", word!), word).toBe(true);
    }
  });
});

// The head of the list and its tail need different judges. Past the gate a spell checker
// rejects the colloquial tail wholesale, but below it the corpus's junk is untranslated
// English and the personal names the gazetteer's four-way test spared.
// @spec FILTER-9
describe("spell gate", () => {
  it("holds no untranslated English, and no name the gazetteer spared", () => {
    for (const w of ["the", "you", "dad", "mom", "night", "up", "squad", "scouts",
      "elizabeth", "janet", "beverly", "mccarthy"]) expect(held("de", w), w).toBe(false);
  });

  it("keeps the ordinary German that sits at the same ranks", () => {
    for (const w of ["Wasser", "Regierung", "Dach", "denken", "Brot", "Liebe"]) {
      expect(held("de", w), w).toBe(true);
    }
  });
});

// German spells compounding inside one word, and compounding is productive, so no lemma
// list will ever hold "Gletscherspalte". The gate asked the list to vouch and German lost
// most by it; re-deriving the rule is what buys those words back.
// @spec FILTER-10
describe("morphology past the gate", () => {
  it("keeps a compound or derivation the lemma list does not hold", () => {
    for (const w of ["Vergabe", "Blutspritzer", "Gletscherspalte", "Schneemaschine",
      "Appetitlosigkeit", "Nobelpreisträger", "Geiselrettung"]) expect(held("de", w), w).toBe(true);
  });

  it("still drops what the deep tail is actually made of", () => {
    for (const w of ["ryûji", "rrr", "lslam", "blabla", "connaughton", "gosheven"]) {
      expect(held("de", w), w).toBe(false);
    }
  });
});

// The merge folds every inflection onto its lemma, so "branched" is not an entry — though
// the build knew it was "branch" all along.
// @spec FORM-1
describe("inflected forms", () => {
  it("resolves a form to the word it was merged into", async () => {
    for (const [lang, form, base] of [
      ["en", "branched", "branch"], ["en", "went", "go"], ["en", "mice", "mouse"],
      ["de", "häuser", "haus"], ["de", "ging", "gehen"],
      ["fr", "maisons", "maison"], ["es", "casas", "casa"], ["pt", "falamos", "falar"],
    ] as const) {
      expect(await resolveForm(lang, form), form).toBe(base);
    }
  });

  it("chases a lemma the build dropped down to the form that survived", async () => {
    // michmech heads jede/jeden/jedes on the bare stem "jed", which FILTER-8 removes.
    // Pointing at the headword would name a word no longer in the list.
    for (const f of ["jede", "jeden", "jedes", "jedem"]) {
      expect(await resolveForm("de", f), f).toBe("jeder");
    }
  });

  it("does not answer for a word that is already an entry", async () => {
    for (const [lang, w] of [["en", "branch"], ["de", "wasser"], ["es", "casa"]] as const) {
      expect(await resolveForm(lang, w), w).toBe(null);
    }
  });
});

// A redirect that names a word the build dropped is worse than no redirect: the card
// would open on nothing. This is the whole map, not a sample.
// @spec FORM-2
describe("redirect targets", () => {
  it("names a word that is in the list, in every language", () => {
    for (const [lang, map] of [
      ["en", formsEn], ["es", formsEs], ["fr", formsFr],
      ["de", formsDe], ["pt", formsPt], ["it", formsIt],
    ] as const) {
      const dangling = Object.entries(map).filter(([, base]) => getWord(lang, base) === null);
      expect(dangling.slice(0, 5), lang).toEqual([]);
    }
  });
});

// The defining levels are one character per ranked word, positional. A rebuild of a
// word-bands.<code>.json that dropped or reordered a single word would slide every level onto
// its neighbour and break nothing loudly, so the artifact carries a digest of the ranking
// it was cut against. Regenerate both together with pipeline/emit_artifact.py in the
// defining-vocabulary repo.
describe("defining levels", () => {
  it("is keyed to the ranking it was built against", () => {
    for (const [ranked, defining] of [
      [rankedPt, definingPt], [rankedIt, definingIt],
    ] as const) {
      const digest = createHash("sha256").update(ranked.ranked.join("\n")).digest("hex").slice(0, 16);
      expect(defining.digest, defining.lang).toBe(digest);
      expect(defining.count, defining.lang).toBe(ranked.ranked.length);
      expect(defining.levels, defining.lang).toHaveLength(ranked.ranked.length);
    }
  });
});
