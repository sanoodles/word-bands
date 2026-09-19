# word-bands — agent notes

pnpm + turbo monorepo with one app. `apps/web` is the Next.js site and the hosted API.
It is a vocabulary learning tool. Every word gets a frequency band and a CEFR band, so a
learner can see where a word sits and browse the vocabulary in order.

## The spec

`SPEC.md` is what this app must do. This file is how to work on it.

| Says | Goes in |
| --- | --- |
| "must", "never", "always" — a fact about the running app | `SPEC.md`, under an ID |
| "how", "why", "watch out" — a command, a rationale, a trap | Here |

Every rule there carries an ID, and the test proving it names that ID in an `@spec`
comment. That comment is the only link between the two, so neither file has to restate the
other. The code a rule governs carries the same comment — a **mark**, not a proof, so that
opening a file to change it tells you which rule binds it. Code cannot witness itself, so a
mark never satisfies a rule.

| Command | Does |
| --- | --- |
| `pnpm spec:check` | Fail on a rule nothing proves, and on an annotation naming a rule that no longer exists |
| `pnpm spec:list` | Every rule by area, with its proofs and its marks |
| `pnpm spec:files` | The reverse: a file at a time, the rules it carries |

It runs in `pr.yml` and in the pre-push hook, parses text and needs no network. Where this
file needs to talk about a rule it names the ID and says why the rule is what it is; the
statement itself stays in `SPEC.md`.

## Source and target

Two languages. They are `source` and `target` everywhere — symbols, URL, storage keys,
our own API params — and in that order. `lang`, `sl` and `tl` name neither.

| | Source | Target |
| --- | --- | --- |
| What it is | The language being studied | What a word is translated into |
| Drives | The bands, the word cloud, the suggestions | The word card only |
| Type | `SourceLang`, one of the six indexed | `TargetLang`, any code Google takes |
| Seeded from | The client's country | The browser language |
| Stored under | `word-bands:source` | `word-bands:target` |
| URL and API param | `source` | `target` |

`isSourceLang` asks whether a language is one of the six, whichever role it is in. The
target passes it only when we index it too, which is what CEFR levels on a translation
and the swap button need.

Storage keys carry no older spellings: a key is read under exactly the name it is written
under, so renaming one drops whatever was stored before it. The two URL params below are the
exception and do accept an older spelling, because a deeplink someone else already shared
cannot be rewritten.

`gtxUrl` is the exception that stays: `sl`/`tl` there are Google's own param names, not
ours. `source`/`target` map onto them at that one call.

`source` never means the frequency corpus. That is `corpus`: `SourceLangMeta.corpus`,
`CorpusCredit`.

## Where things live

| Path | Holds |
| --- | --- |
| `src/lib/languages.ts` | `SOURCE_LANGS`, `SourceLang`, `TargetLang`, `SOURCE_LANG_META`, `englishName` |
| `src/lib/bands.ts` | Server registry, `getWord`, all word lookups |
| `src/lib/geo.ts` | Country table, `sourceLang`, `targetLang` |
| `src/lib/scenario.ts` | URL encode / decode, `pageTitle` |
| `src/lib/site.ts` | `SITE_URL`, `SITE_NAME`, `SITE_DESCRIPTION` — what names the site to a machine |
| `src/lib/translate.ts` | Google Translate fetching and parsing, and the relay gate |
| `src/app/api/cron/warm/route.ts` | The scheduled pass that keeps the de<->en head warm |
| `next.config.mjs` | Response headers, the CSP, `distDir` |
| `vercel.json` | The build commands, and the cron schedule behind the warm pass |
| `scripts/build-bands.ts` | Artifact build, the `LANGS` table |
| `data/word-bands.<code>.json` | Committed artifact, one per language |
| `data/forms.<code>.json` | Committed artifact: inflected form -> the indexed word it belongs to |
| `data/defining.<code>.json` | Committed artifact: one defining level per ranked word, emitted by the defining-vocabulary repo |

Paths are relative to `apps/web/`.

## URL state (deeplinks)

`Workspace` mirrors the scenario into the query string so it can be shared as a link, and
writes it back with `replaceState`. It owns all five values: the target sits there rather
than in `WordCard`, and `band` rather than in `BandBrowser`, so both ride in the URL.
`Workspace` is client-only (`WorkspaceLazy`, `ssr:false`), so this is all client-side.

`?source=<source>&word=<word>&target=<target>&view=freq|cefr&band=<key>`

| Param | Holds | Notes |
| --- | --- | --- |
| `source` | Source language | One of the six |
| `word` | The looked-up word | |
| `target` | Target language | Any language, not just the six |
| `view` | `freq` or `cefr` | `cefr` is the default, and sits first in the toggle |
| `band` | Pinned band tab | Set only when it differs from the word's own band, which the word and view already imply |

`URL-1` to `URL-7` are the rules: the older spellings, what is written and when, and the
precedence on mount — the URL wins over the stored pick, which wins over the seed below.

The tab title carries the word too: `word-bands: <word>`, in the corpus's display casing
(`word-bands: Wasser`). `generateMetadata` renders it from `?word=` server-side, so a shared
link names its word in the tab and in link previews before any client JS runs; `Workspace`
recases it to the corpus's spelling once the lookup lands. Both call `pageTitle`, which caps
the word, since a deeplink's has not been looked up.

## Which languages a first-time visitor lands on

The client's country seeds the source. The browser seeds the target.

| Step | Rule | Example |
| --- | --- | --- |
| Read the country | Vercel sets `x-vercel-ip-country`. `page.tsx` reads it and passes it to `Workspace` as a prop | |
| Pick the source | `sourceLang` maps the country to one of the six, en/es/fr/de/pt/it | DE → study German |
| Multilingual country | `CH`, `BE`, `CA` and `LU` list several. The browser locale picks; the first listed is the fallback | CH + fr browser → French |
| Unlisted country | English. `Exclude<SourceLang, "en">` on the table enforces that English has no entries | JP + ja browser → en → ja |
| Pick the target | The browser language | ES + en browser → es → en |
| Same-language clash | `targetLang` returns English instead, or Spanish when English is the source | ES + es browser → es → en; US + en browser → en → es |
| Explicit pick | Never overridden. The clash rule applies only to the derived value | A deeplink or stored pick is used as given |
| Live switch | `chooseSource` moves the target to the language just left when you pick the one it was translating into | en → es, pick Spanish → es → en |

Reading the header server-side is free, because the root layout already reads cookies for
the theme and the route is dynamic anyway. An `/api/geo` round trip would answer after the
first lookup had already gone out under the wrong language. Off Vercel the header is
absent and English is the fallback.

## Build inputs

All inputs are gitignored and live in `apps/web/data/`. The build reads them and writes
one committed artifact per language, `word-bands.<code>.json`: a pure-frequency,
lemma-merged word ranking plus the band definitions.

| Input | Languages | Source | Notes |
| --- | --- | --- | --- |
| `subtlex.csv` | en | SUBTLEX-US | Curated. Its column is per-million, not a raw count |
| `freq-<code>.txt` | es fr de pt it | hermitdave/FrequencyWords, OpenSubtitles 2018 | Take `<code>_full.txt`, not `<code>_50k.txt` |
| `lemma-<code>.txt` | all | michmech/lemmatization-lists | Also the dictionary the filters below consult |
| `casing-<code>.txt` | all | Leipzig Corpora *sentences* file, from `downloads.wortschatz-leipzig.de` | Named by `casingFile`. **Which corpus each language took is not recorded** — see below |
| `names.txt` | shared | `smashew/NameDatabases` | Personal-name gazetteer, one name a line |
| `de_DE_frami.{dic,aff}` | de | `LibreOffice/dictionaries`, `de/` — igerman98 | Hunspell spell checker. Named by `spellDict` |

Take `_full.txt` because the cut belongs in code, where it is version-controlled, not in
whichever file someone happened to download.

The casing input is the one whose provenance was never written down, and it is the one that
needs it most: the files are gitignored while the casings they produced are committed, so a
rebuild from a different Leipzig corpus moves display casing and the name filter with
nothing in the repo to compare against. All six on disk are 1M-sentence files, and the years
their sentences talk about put German at 2022 and the other five at 2023 — so
`deu_news_2022_1M` and five 2023 siblings, which is inferred and not a record. Write the
download name here when next replacing one.

The German dictionary is the one input with a **binary** behind it: `spellDict` shells out
to `hunspell`, so that language will not build without it on `PATH`. Nothing else does,
and nothing outside `build:bands` does — CI and Vercel read the committed artifact and
never run the build. It is also the one input under the GPL, which the others are not.

| Command | Does |
| --- | --- |
| `pnpm --filter @word-bands/web build:bands` | Rebuild every language |
| `pnpm --filter @word-bands/web build:bands <code>` | Rebuild one |

To add a language: drop its inputs in `data/`, add a `LANGS` entry in the build script, add
it to `SOURCE_LANG_META`, and add the registry import in `bands.ts`.

## Build filters

| Filter | Knob | Rule | Effect |
| --- | --- | --- | --- |
| Frequency floor | `minCount` | Drop words under 10 raw occurrences | Below that the OpenSubtitles tail is mostly hapax noise. Stated in occurrences, not rank, so it means the same in every language. Omitted for English, whose column is per-million |
| Clitics | `clitics`, `mesoEndings`, `cliticExceptions` | Strip pronouns hyphenated onto verbs and merge the frequency back into the verb | 24% of the pt list and 12% of fr. pt `lembrar` 333 → 177, fr `excuser` 761 → 297 |
| Own-entry | — | A surface word that heads its own lemma entry keeps it, instead of merging into whichever lemma claims it | The lists are lemma-sorted, so plain first-wins hands a shared form to the alphabetically-first claimant. That deletes common words (it `governo` into `governare`, fr `tu` into `il`; 100–160 of the top 1,000 per language) and floats the absorber into the beginner bands |
| Dictionary gate | `dictGate` | Past rank 25,000, keep a word only if the lemma list vouches for it | Drops about 80 junk words per real one. Lands the five subtitle languages at 33–40k words each, near where English's SUBTLEX ends on its own |
| Spell gate | `spellDict` | *Below* rank 25,000, drop a word the language's own spell checker rejects | −4,561 in German. The other half of the same list — see below |
| Truncated stems | `spellDict`, `STEM_MIN_FORM` | Move an entry off a lemma headword that is not a word of the language | 14 in German. `jed` → `jeder`, `mehrer` → `mehrere` |
| Morphology | `morphology` | Past `dictGate`, keep a word the language's own compounding or derivation accounts for | +17,887 in German, taking it 35.6k → 53.5k. See below |
| Personal names | `determiners`, `NAME_RANK_FLOOR` | Drop a word meeting all four tests below | See the per-language counts below |
| Display casing | `casingFile` | Measure each word's mid-sentence capitalization and store that casing | Sentence-initial position is ignored, since it capitalizes everything |
| Case-homographs | — | Keep both casings of one entry under `variants` | `"essen" -> ["Essen","essen"]`, most frequent first. `getWord` returns them as `forms` |

### Clitics

pt and fr hyphenate pronouns onto verbs, so every verb × pronoun pair spells its own
surface form: `deixa-me`, `fazê-lo`, `donne-moi`, `a-t-il`. None of them is vocabulary.

| Detail | Rule |
| --- | --- |
| Mesoclisis | pt puts the pronoun inside the verb (`contar-te-ia`), so `mesoEndings` also strips a trailing future or conditional ending |
| Stem repair | `STEM_REPAIR` restores the infinitive `-r` that pt drops before `-lo`/`-la` (`fazer` + `o` → `fazê-lo`) |
| Unknown stem | Dropped, not kept: 346 forms in pt, 400 in fr |
| Whole segments | Segments are matched whole. This is the load-bearing detail: it keeps `guarda-chuva` (ends in "chuva", not "a") and `arc-en-ciel` (ends in "ciel", not "en") |
| Why whole | No lemma list holds a single hyphenated entry, so the dictionary cannot referee it, and rank cannot either — `peut-être` and `rendez-vous` sit among `avez-vous` and `dis-moi` |
| Not clitics | `là` and `ci`, since `celui-là` and `là-bas` are vocabulary. `cliticExceptions` covers the rest (`rendez-vous`, `garde-à-vous`) |

### The tail and the dictionary gate

The subtitle tail is not rare vocabulary. Past rank 25k only about 14% of it is in the
language's own lemma list.

| Junk kind | Examples |
| --- | --- |
| Character names | `ryûji` |
| Untranslated English | `truck`, `workshop` |
| Misspellings | `gerer` for "gérer", `règler` |
| OCR debris | `lslam`, `arrãªtez` |
| Noise | `rrr`, `shhhh` |

Neither frequency nor the name gazetteer can tell that from a rare word; the gazetteer has
no entry for `ryûji` or `rrr`. The dictionary can, which is what `dictGate` uses.

| Known cost | Detail |
| --- | --- |
| Not used for English | Its source is curated and its lemma list is the smallest by far, 808KB against French's 4.9MB. Gating it would cut 11k mostly-real words |
| Real words lost | 1–3% of what the gate drops, 900–2,700 per language |
| Where they cluster | Productive morphology the lists do not headword: `-mente`/`-ment` adverbs, `-ità`/`-ité` nouns, superlatives — `logicamente`, `unanimità`, `rigoureusement`, `Geborgenheit` |
| Spot-check | Italian's list has no `entropia`, so the build's spot-check for it reports `—` |
| 12k–25k untouched | The gate starts at 25k, and 12k–25k is still about half names and English: `Nami`, `Calcutta`, `because`, `corn`, `truck` all sit near rank 13,000 |

### Measuring what the gate misses

The row above is qualitative. A second dictionary makes it countable: cross the lemma list
with a Wiktionary extract and count what neither vouches for. Measured once for Portuguese,
against the `defining-vocabulary` spike's `pt_levels.json`.

| Portuguese, 35,827 words | Count |
| --- | --- |
| Not in the lemma list | 9,658 |
| No Wiktionary entry | 11,719 |
| **Neither** | **7,565** |

Either source alone is useless as a filter. The lemma list flags `que de com se do por` —
function words it never headwords. Wiktionary flags the feminines and possessives michmech
treats as lemmas of their own: `boa`, `má`, `última`, `certa`, `meu`. Only the conjunction
isolates junk.

Where the 7,565 sit, and what runs there:

| Rank | Count | The test in force |
| --- | --- | --- |
| 1–1,000 | 20 | None. `NAME_RANK_FLOOR` exempts the head |
| 1,001–24,999 | 7,545 | The name gazetteer alone. No dictionary test: `dictGate` starts at 25,000 and only German has a `spellDict` |
| 25,000+ | 0 | `dictGate`. Nothing past it is unvouched |

So the gate holds perfectly and the whole hole is below it. It is also not the 12k–25k of
the row above — it starts at 1,001.

| The 7,565 | Count | Head of the list |
| --- | --- | --- |
| Already in `names.txt` | 2,704 | `John Jack Sam Michael Charlie Frank Mike Joe Peter George Max James Alex Bob` |
| Not in `names.txt` | 4,861 | `Mr The fbi näo Iorque Hey km Chicago voce New directamente of City srta and` |

The first group is the name filter's own miss — the gazetteer holds the word and the casing
or determiner test spared it. The second is what a surname list was never going to hold:
untranslated English (`The`, `of`, `and`, `New`, `City`), accentless and pre-reform spellings
(`näo`, `voce`, `directamente`), abbreviations (`km`, `srta`, `fbi`, `St`), exonyms
(`Iorque`, `Chicago`).

| Known cost | Detail |
| --- | --- |
| A candidate list, not a drop list | `bem-vindos`, `bem-vinda`, `directamente` and `Iorque` are ordinary Portuguese sitting in the second group |
| Portuguese only | Repeating it needs that language's Wiktionary extract — 339MB per language, which is what the spike downloads |

### Morphology, the second way past the gate

The gate asks the lemma list to vouch for a word, and German loses most by it. German
spells compounding **inside one word**, and compounding is productive: `Bananenbrotrezept`
is ordinary German that no list will ever hold, because the rule makes words faster than
anyone can enumerate them. English writes the same thing as three words and needs three
entries; German needs one per combination, forever. So the rule is re-derived rather than
looked up, and `FILTER-10` is the result — **+17,887 words, 35.6k → 53.5k**.

| Signal | Catches |
| --- | --- |
| Compound split, on `links` | `Gletscherspalte`, `Schneemaschine`, `Geiselrettung` |
| Derivational suffix | `Appetitlosigkeit`, `Beurlaubung`, `Gutherzigkeit` |
| Prefix | `Vergabe` = ver + gabe |

| Load-bearing detail | Why |
| --- | --- |
| The head of a compound and the stem of a derivation must be a **lemma**, not any known form | Otherwise inflections walk in as base words: `rettungsbooten` splits on `booten`, `bundeskanzlers` on `kanzlers` |
| A part in the gazetteer that the lemma list lacks poisons the split | German compounding licenses names freely — `carleton` is carl+ton, `paulchen` is paul+chen. Costs ~1,083 words, and cleared the sample |
| The split is a yes/no vouch and is never shown | So a wrong analysis of a real word costs nothing: `gaststube` splits as gasts+tube and is admitted anyway |
| Only German supplies `morphology` | The Romance five compound phrasally (`arc-en-ciel`), so there is nothing for them to re-derive |

**This is the one thing in the build that is not language-agnostic**, against a file whose
design is "per language this is pure data". It earns the exception by being worth 20k
German words; it is still the first place to look when the build stops generalising.

It does not touch loanwords: `Semikolon` and `polyglott` have no German morphology to grab,
and only a dictionary would admit them. That was the measured trade — the combined
hunspell variant would have taken them at roughly a third of the precision.

### The head of the list, and the spell gate

The dictionary gate answers the tail. The head has the opposite problem and needs the
opposite tool, so `spellDict` runs a Hunspell dictionary over everything *below*
`dictGate` and drops what it refuses. `FILTER-9` is the rule.

Measured against German at rank 25,000, the two sources' blind spots are mirror images:

| | Below the gate | Past the gate |
| --- | --- | --- |
| What the junk is | Untranslated English and names the gazetteer spared | OCR debris, character names, misspellings |
| Spell checker there | **~89% right** | ~84% *wrong* |
| So the judge is | The spell checker | The lemma list |

A checker is thin on exactly what the rare tail is made of — colloquial and
separable-prefix verbs, diminutives, superlatives, intensifier compounds. It rejected
`Nobelpreisträger`, `Jungfernfahrt`, `blitzsauber`, `Spätzchen` and `grabschen`, and a
40-word sample of its rejections past 25,000 held no junk at all. Run there it would be a
vandal. Run on the head it removes `elizabeth` (frequency 5,084), `up`, `janet`, `night`,
`squad` and `scouts` — and every one of its 4,561 drops is below rank 25,000 by
construction, which is the range anyone browses.

Either casing passing is enough, so a word is refused only when neither spelling is a
word. Without that, German's own capitalization decides vocabulary questions.

The cost is the ~11% it takes with them: real words the dictionary lacks (`Viech`,
`Klunker`, `rabauke`) and pre-1996 spellings (`daß`, `Haß`, `Imbiß`), which igerman98
is post-reform and does not carry.

### Truncated lemma stems

michmech headwords some German determiners and adjectives on a bare stem — `jed` for
jede/jedem/jeden/jeder, `ander`, `beid`, `mehrer`. The own-entry rule (`FILTER-3`) then
hands every inflection to it, so the stem lands high while the word itself goes missing:
`jed` sat at rank 107 with no `jeder` in the list at all, and `mehrere` and `jegliche`
were absent outright. `FILTER-8` is the rule; the entry moves to whichever form the
corpus writes.

**The corpus cannot referee this on its own**, which is the trap. A German adjective is
nearly always written declined, so bare `afrikanisch` occurs twice in a million sentences
where `jed` occurs three times — and a rule reading only corpus counts "repairs"
`afrikanisch` to `afrikanischen`, replacing a real word with an inflected one. The
dictionary is what separates them, so a headword moves only when Hunspell says it is not
a word. That is why this needs `spellDict` rather than the casing corpus alone.

| Limit | Detail |
| --- | --- |
| The repair picks the corpus-dominant form | The citation form for `jed` → `jeder`, but not for `ander` → `anderen`. Both are real words, so the wart is cosmetic |
| A headword whose forms do not all extend it is left alone | A different defect: michmech maps *both* `Dach` and the past tense of `denken` onto `dachen`, and there is no splitting that from the list. The spell gate above drops `dachen` instead |

### Personal names

Names like "Ahmed", "Moretti" and "Kendra" crowd subtitle corpora without being
vocabulary. A word is dropped only when all four tests agree.

| Test | Spares |
| --- | --- |
| In the `names.txt` gazetteer | |
| Absent from the language's lemma list | Surnames that are also words: "Koch", "Berg" |
| Capitalized mid-sentence | Lowercase function words that collide with short names: "in", "von", "man" |
| Rarely preceded by a determiner | Ordinary nouns michmech lacks, which surname lists are full of: "Kuss", "Fass", "Geduld", "Sheriff" |

The top `NAME_RANK_FLOOR` (1,000) is exempt, because a hit there is likelier a loanword
noun than a name. A language without a `casingFile` is skipped, since the gazetteer alone
would eat "que", "por", "he" and "she". Words dropped per language:

| en | es | fr | de | pt | it |
| --- | --- | --- | --- | --- | --- |
| −1,126 | −2,495 | −2,790 | −2,185 | −1,737 | −2,316 |

Known wart: a few country names sit in the surname list and go with them — `england`,
`france`, `africa`, `canada`, `india` (en), `francia` and `italia` (es), `italia` and
`inghilterra` (it). The determiner test rescues the rest, so fr and pt lose none, but
English never articles a country ("the France" is ungrammatical) so it cannot fire there.
The result looks arbitrary: `germany` stays, `france` goes.

### Display casing

Measuring mid-sentence capitalization needs no per-language rules and gets the right
answer in every language.

| Outcome | Examples |
| --- | --- |
| Capitalized | German nouns and names: `Wasser`, `Berlin`. Proper nouns anywhere: `Roma`, `Lisboa`, `London`, `Dios` |
| Lowercase | Verbs and pronouns. es `lunes`, `enero`, `español`; it `lunedì`, `gennaio` |

The lemma list is the authoritative fallback for the rare tail. The stored `ranked` words
carry display casing, and every lookup in `bands.ts` keys on lowercase, so search and
typeahead stay case-insensitive. A language without a `casingFile` stays lowercase; all
six have one.

### CEFR bands

Bands are frequency-rank thresholds calibrated against CEFR-J. They are English-derived
and reused for every language. No graph and no external dictionary is involved.

The thresholds are `BAND-1`, and `BAND-2` is that every language uses them unchanged.
Past C2 sits `rare` ("Rare · beyond C2"), open-ended at `max: null`.

| Detail | Why |
| --- | --- |
| Tops roughly double, so C2 ends at 50k | Rather than running open-ended to the end of the list |
| `rare` past it is open-ended | It is what lets `getWord` assert a band exists at every rank — keep `max: null` on whichever band is last |
| **German reaches it and the other five do not** | The morphology vouch buys back ~18k compounds, taking the list past 50k, while `dictGate` keeps the Romance five inside C2 |
| Both lists are filtered to bands that hold words | An unreached `rare` renders no empty tab, so German alone shows a seventh |

**No language has a CEFR source of its own.** The whole calibration is one English
measurement, and the rest is reuse:

| Element | Where it comes from |
| --- | --- |
| The A1 to B2 medians, A1≈635 A2≈2275 B1≈4692 B2≈8394 | The CEFR-J Wordlist, English. Which version was used at calibration time was not recorded; the medians reproduce within 8–17% against Wordlist 1.5 on the current artifact |
| The C1 and C2 tops | Nothing external. CEFR-J stops at B2, so 25k and 50k extrapolate the doubling trend |
| `rare` | Nothing. It is the open-ended band `getWord` needs |
| es, fr, de, pt, it | Nothing of their own. The English thresholds apply unchanged, which is `BAND-2` |
| CEFR itself | No vocabulary at all. The framework specifies ability, not words, so every CEFR word list is a third party's construction and there is no ground truth under the labels |

**How far the reuse holds was measured once**, against the CEFR-J Wordlist 1.5 plus the
Octanove C1/C2 profile 1.0 (`openlanguageprofiles/olp-en-cefrj`), on the 8,259 of its 8,690
single-word headwords that the English artifact holds:

| Measure | Value |
| --- | --- |
| Spearman ρ (frequency rank, profile level) | 0.71 |
| The band `BAND-1` assigns is the profile's | 38% |
| Within one band | 84% |
| Ceiling for any one-band-per-word scheme, scored per (headword, pos) sense | 92% |
| Refitting all five thresholds to the profile | 38% → 43%, and A2 and C1 collapse to slivers |

So the thresholds are leaving almost nothing on the table — the ceiling is the signal, not
the calibration. Both figures are floors, since error in either variable attenuates the
correlation, and neither variable is ground truth: the rank is exact about the artifact and
an estimate about the language. The misses are register, in both directions. The profile
calls `volleyball`, `aeroplane`, `jewellery` and `seventy` A1 where the corpus ranks them
past 7,000, and calls `corpse`, `convict` and `trauma` C1 where subtitles put them inside
3,000. A1 words carrying one of the profile's syllabus-topic tags have median rank 1,154
against 449 for the untagged, which is that difference made countable.

The profiles are not committed, so this run is not reproducible from the repo.

Comparing one language against another through the bands is the weaker reading. The six
agree almost everywhere, and where they disagree it is usually a word within 20% of a
threshold: en "green" at rank 909 against es 1,170 straddles the A1/A2 line at 1,000. The
rank in the tooltip is what tells that apart from a real difference, like it "parete" at
2,702.

## Defining levels

`BAND-11` to `BAND-13` are the rules. The levels are not built here. The defining-vocabulary
repo builds them from each language's own Wiktionary and writes `data/defining.<code>.json`.

| Detail | Why |
| --- | --- |
| Exactly seven levels | `DEFINING_BANDS`, `LEVELS` in `DefiningScatter.tsx` and the one-character level per word all assume D1–D7. The emitter refuses a language whose graph peels into any other number |
| Portuguese and Italian only | Their dictionaries are the only ones that peel into seven. On the September 2026 extracts Spanish gives 11 levels, French 14, English 20 and German 5 |
| The artifact is positional | It holds one level per word of `ranked`, in order. A rebuild of `word-bands.<code>.json` needs the levels emitted again, and `artifacts.test.ts` fails on the digest until they are |
| Each language names its own example | The figure's caption names an A1 word at D7 from `DEFINING_EXAMPLE`. `bands.test.ts` checks that the claim holds |

To add a language: emit its levels in the defining-vocabulary repo, add it to
`DEFINING_LANGS` and `DEFINING_EXAMPLE`, and import its artifact in `bands.ts` and
`artifacts.test.ts`.

## Typing a word without its diacritics

`BAND-14` is the rule. A learner often has no key for `ó` or `ñ`, so `cordo` has to reach
`cordón`. A diacritic that was typed is a choice, so it is kept.

| Detail | Why |
| --- | --- |
| One way, not both | Folding the query too throws away what was typed: `có` would list `con` and `comer` ahead of `cómo` |
| The exact match leads on its own spelling | The search box looks up the head of the list unasked. So `ano` opens `ano`, and `año` is one row down |
| `ñ`, `ç` and umlauts fold too | Folding takes off whatever Unicode splits into a letter and a mark. That is also what lets `schon` reach `schön` |
| `ß` and `œ` do not | Unicode does not split them, so `strasse` finds no `Straße` and `coeur` no `cœur` |
| The index folds only the two letters it is keyed on, and skips ASCII | Every API route loads the six lists. Folding every word there costs about 70ms of cold start, and this about 20ms. A query then folds one letter at a time, 0.2ms at worst |
| The query is composed first | A pasted decomposed `có` would otherwise carry its accent as a letter of its own |
| Enter does not fold | `/api/word` looks up the spelling as typed, so `cordon` answers 404 |
| The 404 offers the folded spelling back | "Did you mean cordón?", as a button in the error (3.3.3). The suggest index is what answers it, so the offer is whatever the typeahead was already showing — the rule above stands, and the miss is no longer a dead end |

| Known cost | Detail |
| --- | --- |
| Accent misspellings show beside the real word | They are entries of their own, below the dictionary gate (see *Measuring what the gate misses*). pt `nao` lists `não`, `näo`, `nâo`, `năo`, `náo`, `nào` |

## Looking a word up by an inflected form

The merge folds every inflection onto its lemma, so a form is not an entry: `branched` and
`jede` answered nothing, though the build knew all along that they are `branch` and
`jeder`. `forms.<code>.json` is the way back, and `FORM-1` to `FORM-5` are the rules.

| Detail | Why |
| --- | --- |
| Consulted only after an exact lookup misses | It is the rare path, and it must never shadow a real entry |
| Imported dynamically, not statically | The six maps are 12.3MB against the artifacts' 2.4MB, and a static import parses all six at module load on every route. They land in their own chunks |
| Read through a `Map`, not the parsed object | This is the one lookup keyed straight on caller input, and a plain object answers `__proto__` and `constructor` with inherited members. `hostile-input.test.ts` caught exactly that |
| Keyed on what the corpus writes | The lemma lists carry productive morphology nobody types (`abinha`, `aes`), which doubles the map for nothing |
| The card says it redirected | The field is rewritten to the word that was found, so the typed word would otherwise just vanish |

**It resolves with the merge's own `lemmaOf`** — own-entry, first-wins, stem repairs — so a
form lands on the entry its own frequency was summed into. A rank-based tiebreak for
ambiguous forms was measured and is **worse**, which is worth knowing because it sounds
obviously better: the merge sums every conjugation onto a verb, so verbs outrank the nouns
they collide with, and preferring the higher rank then trusts an inflation the merge itself
caused. It sends `traiciones` to `traicionar`, `opéras` to `opérer`, `rafles` to `rafler`
and `scapole` to `scapolo` — about two words lost for every one fixed.

The **chase** is the one thing on top of `lemmaOf`. Where the gates dropped the lemma
itself, the form follows to whichever of that entry's forms survived, because pointing at
michmech's headword would name a word no longer in the list. About 1,000–2,500 forms per
language depend on it, and it is what makes `jede` answer `jeder` rather than the stem
`FILTER-8` removed. `FORM-2` asserts the whole map against the index, not a sample.

**Known wart, inherited from the lemma lists.** Where michmech lumps distinct words under
one lemma, the redirect reports that lumping, and it is more visible than it was: es `para`
answers `parar`, de `sie` and `du` answer `ich`, fr `je` and `vous` answer `il`. These are
not new — the merge has always summed those counts together, so the words were already
absent as entries — but a miss became a confident wrong answer. `FORM-5`'s line is what
keeps it legible as a redirect rather than as the answer.

## Translating a word

Every word card fetches `dict=1`, which adds Google's `dt=bd` dictionary block.

| Rule | Why |
| --- | --- |
| Translate from the dictionary terms, not the plain translation | The plain translation of a lone word is sometimes just wrong: "acqua" → "waterfall" |
| Keep the block's part-of-speech groups (`parseSenseGroups`) | A word with more than one reading gets a labelled line each: it "solo" adj. "only" / adv. "just"; es "nada" pron./noun/adv. A single reading stays one line. `flattenSenses` collapses them for the per-casing lines |
| One line per casing of a case-homograph | `dt=bd` is casing-sensitive, unlike the plain translation: "Essen" → food/meal, "essen" → eat/dine. Lines collapse to one when the meanings do not actually differ |
| Flag a homograph only when both casings are used mid-sentence and the lemma list has a capitalized spelling | Filters surnames ("Klein") and quote-capitalized adjectives |
| Cut senses relative to their group's best (`MIN_RELATIVE_SCORE`), not at a fixed rank | Senses trail off into noise: en→de "dog" runs Hund .51, Rüde .0018, then "Schreckschraube" (battle-axe) at 3e-6 |
| Treat an unscored entry as no-confidence | It goes the same way |

### What the route agrees to relay

`/api/translate/[word]` is the one route that answers by calling someone else. Whatever
reaches it is forwarded to Google on our quota, so it checks that the request is one the
card could have made before it makes the call. Without that it is a general-purpose
translation API for anyone who finds it, and Google rate-limits by calling IP — which is
our egress IP, so an abuser's flood lands on real lookups.

| Gate | Rule | Where the bound comes from |
| --- | --- | --- |
| `isSingleWord` | `GATE-1`, `GATE-2` | The longest word in the six artifacts is 28, `antidisestablishmentarianism`, and none holds whitespace. Hyphens and apostrophes are ordinary vocabulary — fr alone has 1,145 hyphenated headwords, `arc-en-ciel`, `quelqu'un` — so only whitespace splits a word |
| `isSourceLang` | `GATE-3` | It is the language being studied, so it always is |
| `isLangCode` | `GATE-4` | The target is any language Google takes, not one of the six, so shape is all there is to check. It still separates `ja` and `haw` from a string to hand upstream |

Every refusal answers 400, not the 404 the other routes use for an unknown language: those
looked and there is no such word list, while these gate what this one will pass on. The
tests assert that Google is never called — the status is not the point.

Both predicates live in `lib/translate.ts`, next to `gtxUrl`, so the gate sits with the
call it guards.

### The rate limit in front of it

The gate is the second line of defence. The first is a Vercel firewall rule, which lives
in the dashboard and nowhere in this repo — nothing here would tell you it exists.

| Setting | Value |
| --- | --- |
| Where | `https://vercel.com/sanoodles-dev/word-bands/settings/firewall` |
| Matches | Path starts with `/api/translate` |
| Keyed by | IP |
| Limit | 100 requests per 60s, then deny |

A blocked request answers **403, not 429**: Vercel's rate-limit action is a deny, and a
deny is a 403. It carries `x-vercel-mitigated: deny`, a plain-text `Forbidden` body and
`server: Vercel`. No route here returns 403, so that header is what identifies the block
as the edge rather than the app. The window clears itself.

Exercising it costs nothing upstream, because the gate refuses a 200-character word
before calling Google. Expect 100 × `400` and then `403`:

```sh
W=$(python3 -c 'print("a"*200)')
for i in $(seq 1 130); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://word-bands.vercel.app/api/translate/$W?source=en&target=es"
done | sort | uniq -c
```

### Keeping the head warm

`WARM-1` to `WARM-5` are the rules.

| Number | Value |
| --- | --- |
| Head words | 6,114 — ranks 1-3,000 of each language, each casing counted separately |
| A full pass | 61 days |
| The entries' own TTL | 180 days |

The pass owns the head's freshness whatever the TTL says, so the TTL covers two other
things: how stale a *tail* entry may get, and how long the head survives if the pass stops.
At 180 against a 61-day pass that grace is about 119 days. The outbound rate is about one
request every fifteen minutes, which is why this does not spend the egress IP the way a
bulk backfill would; halving the daily slice would still pass inside the TTL.

| Load-bearing detail | Why |
| --- | --- |
| It calls the translate route, not `gtx` directly | The cache key is the gtx URL that route's own fetch builds, so warming any other way fills a key nothing reads. Calling its own URL over HTTP would instead run the pass into the Vercel firewall rule in front of `/api/translate`, keyed by IP at the size of one run |
| Fail-closed on the secret (`WARM-1`) | This route spends our Google quota on demand, so fail-open is a faucet for anyone who guesses the path |
| The date rather than a stored cursor (`WARM-2`) | A redeploy or a cold start must not restart the rotation, and a date needs nothing to persist it. It also makes a hand-triggered run idempotent with the scheduled one |
| Four at a time, `maxDuration = 60` | Running the slice sequentially would risk the function timeout |
| Daily, `0 18 * * *` | Hobby allows one cron run a day and nothing finer — a sub-daily expression fails the deploy rather than degrading. Its scheduling precision is per-hour, so the run lands somewhere in 18:00-18:59 UTC. The hour is chosen to be a waking one, because Hobby keeps logs for only an hour after the run; the slice comes from the UTC day, so the choice does not change which words are warmed |
| A failed lookup is never cached | Next writes to the data cache only on a 200 (`patch-fetch.js`), so a transient Google error 502s and is retried rather than sticking for the TTL. Only a 200 we cannot parse would stick |

`alreadyCached` (`WARM-4`) counts the words that answered without a round trip — free, since
the run asks for them regardless. The cycle returns to the same words, so after a full pass
it is also the share of the head still cached.

| `alreadyCached` | Reading |
| --- | --- |
| Near `asked` | The cache holds across a full pass |
| Drifting down | Eviction, and the slope is its rate |
| Near zero | Not persisting — a deploy, a purge, or a per-region cache |
| Before the first pass completes | Nothing yet. It is only how much real traffic reached those words |

The response is returned to Vercel's scheduler, which discards it, so the run logs its own
summary (`WARM-5`). That line is the only place these numbers reach anyone:

```
[warm] 2026-11-12 slice 4254-4353 asked=100 warmed=100 alreadyCached=98
```

Read it under Logs, filtered on `requestType: cron`. **Hobby keeps one hour of runtime
logs** — Pro a day, 30 days with Observability Plus — and the run lands anywhere in a
59-minute window, which is why the schedule sits at a waking hour rather than overnight.
Check within about an hour of 18:00 UTC.

The other way to read the number, needing no logs at all, is to trigger the pass yourself
earlier in the same UTC day and read the response it returns. The window comes from the date, so that run takes
the day's slice with a genuine count and the scheduled one moves on to the next. Once per
UTC day only: a second run finds its own warming and reads near 100, which means nothing.

A browsable history instead would need somewhere to keep counts, which is a dependency this
app does not have.

**The destination is the assumption underneath all of it.** The data cache is the only place
a server can write without taking one on, and its eviction and regionality are Vercel's.
`alreadyCached` is where that would show up. The alternative depending on none of it is a
committed artifact of the same head, built the way `word-bands.<code>.json` is — not what
this does, because a server cannot commit to git, so that path is a build step someone runs
and reviews rather than a schedule. It also answers a different question: an artifact never
expires, where the point here is that entries stay fresh on their own.

### English is Google's hub

Only pairs touching English have a dictionary at all.

| Pair | What Google returns | What we do |
| --- | --- | --- |
| Touches English | A scored dictionary block | Use it |
| es→de, de→es | An unscored reverse lookup that routinely omits the primary sense: "agua" gives Gänsewein/Urin/Neigung and no "Wasser"; "libro" gives only "Blättermagen" | `parseSenseGroups` drops it, because a wholly unscored response is not a dictionary |
| Any other non-English pair | An empty block | Nothing to use |

That leaves those pairs on the plain translation, which is weak for a bare word: it gets
the number wrong (es→de "mujer" → "Frauen"), the case wrong ("feliz" → "Glücklich") or the
sense wrong ("noche" → "Abend", "casa" → "heim"). So when neither side is English
(`needsPivot`) the route pivots through English. `pivotTerm` takes the best-scoring sense
of the source→en dictionary, then en→target is looked up and `alignGroup` keeps the group
matching the source word's part of speech. The two fetches run together, so a pivot costs
one extra round trip: about 150ms cold, then nothing until the entry expires.

| Load-bearing detail | Why |
| --- | --- |
| Follow Google's group order, not the top score across groups | "verde" scores adjective "green" and noun "green" identically, and the noun translates it as a lawn: Grün/Rasen/Wiese |
| Require `MIN_PIVOT_SCORE` confidence | Google's "amigo" entry tops out at .004 with no "friend" in it, and there the plain translation ("Freund") is the better answer |
| A part-of-speech miss yields nothing | Better than a translation of a different word: "escuela" is never the verb "to school" |

## CEFR levels on the translation

Google orders the alternatives by confidence, not by difficulty, so a three-to-four
band spread arrives as a flat list of equals: "agua" A1 beside "abrevar" C2, "buddy" A1
beside "cobber" C2. `/api/translate` annotates every dictionary term, and the plain
translation, with its CEFR band and rank in the target language. The card trails each with a
quiet `CefrBadge` carrying the band name and rank in its tooltip.

| Rule | Detail |
| --- | --- |
| The order stays Google's | The badge lets a learner filter; it does not re-rank |
| Annotate server-side | It happens in the route that already fetches the translation, so it costs no extra round trip |
| `levels` is keyed by the term as Google spelled it | `getLevel` keys case-insensitively underneath |
| Only the six indexed languages have levels | For the rest the map is empty and nothing renders |
| Some terms go unbadged | Phrases ("de agua") and inflected forms the lemma merge folded away ("eating"): about 4% of terms |
| The looked-up word gets the same badge inside the search field | In Frequency view that is the only place its CEFR level shows at all |

### Clicking an alternative

A badged term is also a button. Clicking it studies the language that term is written in,
starting from that word, and the pair turns over with it — so the card then translates
back into the language just left. It is `SwapButton`'s move, aimed at one alternative
instead of at the leading one.

| Rule | Why |
| --- | --- |
| Only a badged term | The level is that language's own list vouching for the term, so a badged one is a word it has. The rest are phrases and folded-away forms, which would land nowhere |
| So it needs no probe | `SwapButton` carries over a leading term nothing vouched for, which is why that one asks `/api/word` first and falls back to the language's default word |
| `Workspace` withholds the handler rather than the card refusing | Same gate as the button: only the six can be studied. A card given no way to pick renders the terms as it always did |
| Underlined on hover only | Six standing underlines read as a row of links rather than as what the word means |
| The button stays | It works where the translation is a phrase, and it is a fixed place to find the move rather than one that depends on what came back |

### Markup

| Rule | Why |
| --- | --- |
| Separators are bare text | Nothing but the badge sits between one term and the next |
| A badged term is wrapped in a `<span id>`, or in the button where it can be picked | Somewhere for its badge to point at. Only a badged one — the wrapper exists to be pointed at, and a span carries no text either way |
| The badge is `select-none` | A copied line is then the translation and nothing else. The margin keeps a space out of it; without this the letters stayed, and "water, aqua" copied as "waterA1, aquaB2" |
| No whitespace between a term and its badge | A wrap can never split the two |
| `role="img"` carries the detail as the badge's accessible name | Hidden text would say the same thing but ride along into anything copied out of the translation |
| The word the badge is for is its **description**, not part of its name | Reading the line, the word and its badge are already adjacent, so a name holding both would say the word twice. Tabbing lands on the badge alone, where the level has no subject. A description is announced on focus and not while reading, which is the split exactly |

### The badge in the search field

Nothing goes inside an `<input>`, so `WordSearchBox` overlays one: an absolutely-positioned
run holding an `invisible` copy of the value followed by the badge. Laying the same string
out in the same font puts the badge where the text ends with nothing measured, and it
re-flows on its own when Diatype replaces the fallback.

| Rule | Why |
| --- | --- |
| The run is inline, not a flex row | The badge takes the word's baseline instead of being centred against it |
| `TEXT_INSET` mirrors where Fondue starts the text | 1px root border plus 12px input padding. That CSS module's class is a build hash, so it cannot be read |
| Pass `badge` only while the field still holds the resolved word | Pressed against the text, a stale level reads as a claim about what is being typed |
| Stand down whenever the spinner is up | They share that strip of the box, and mid-lookup the level is unknown anyway |
| Hide it when the word leaves no room | 27-char German at a 250px phone field. `fits` compares the overlay's scroll and client widths, and re-measures on a resize as well as on a new value |
| Hide with `visibility`, keeping the badge in the DOM | It keeps its slot, so the measurement cannot oscillate with its own answer |
| Report `fits`, so the level lands somewhere | Hidden here it would show nowhere at all in Frequency and Defining view (1.4.10), so `Workspace` hands it to the card, which prints it beside its heading. Only then, so the level is never in both places |
| The overlay is `pointer-events-none` except the badge | Clicking the badge puts the caret at the end of the word, which is what a click just past the text means |

## Width on a phone

`GUTTER` in `page.tsx` is the page's side padding — 12px on a phone, 24 at 700, 40 at 900
— and the vertical padding beside it scales on the same breakpoint. 12px is the floor,
not slack: at zero the panels' rounded border sits on the screen edge.

The band browser is the one exception. It carries `-tw-mx-3` below 700px and drops its
side borders and radius, so it runs edge to edge while the heading above it keeps the
gutter. **The negative margin is the phone gutter**, in another file — change one and
change the other, or the panel hangs off the screen.

It is the only block that gets this because it is the only one that can use the width.
Measured at 320px, against the chip cloud:

| Lever | Cloud | Words a row |
| --- | --- | --- |
| As it was | 270px | 2.46 |
| Chip padding `tw-px-4` → `tw-px-3` | 270px | 2.46 |
| Page gutter 12px → 8px | 278px | 2.62 |
| **Browser full-bleed** | **296px** | **2.69** |

Chip padding buys nothing, because a row is bounded by whole chips and shaving 8px off
each one rarely fits another. The 8px gutter was rejected on how it looks, not on the
number: the view toggle and the section heading then sit against the screen edge.

The hero panels are left inset on purpose. They hold one row each and gain nothing from
the width, and the contrast — cards inset, the browser full width — is what marks the
browser as the page's own surface rather than a third card.

## Credits

`CREDIT-1` to `CREDIT-3` are the rules. `CorpusCredit` in `Workspace.tsx` renders every
credit, in the Sources line beneath the browser. The footer holds only the feedback link.

| Detail | Why |
| --- | --- |
| The Sources line, not the footer | It already changes with the source language. Only Portuguese and Italian have defining levels, and the footer is the same in all six |
| Wiktionary is credited with its license | The levels are computed from its definitions, and its text is CC BY-SA 4.0. Whether a computed level reuses that text is a legal question. The credit answers it either way |
| The method's works are cited, not only its data | The method is theirs: the dictionary read as a graph, its peel into k-cores, and the term "defining vocabulary" |
| The Wiktionary is named after the source language | The pipeline reads each language's own edition, `ptwiktionary` and `itwiktionary`. A language built from another edition needs its credit changed |
| Ogden's *Basic English* is not cited | The spike's README compares against it. Nothing in the method comes from it |
| Every language credits the Leipzig Corpora | Every language's `casingFile` is a Leipzig sentences file. Display casing and the name filter both read it, and its downloads are CC BY |

## What the page says to a machine

The accessibility tree is the app's other output, and it is not readable off the source —
Fondue builds part of the markup, and a name is computed rather than written. Settle a
question about it by dumping the tree from a running browser, the way a decode question is
settled against the deployed URL.

Two rules run through the whole page: **one string, one place**, and **a name has to
survive browse mode** — nothing focused, no tooltip open. That second one is why detail
lives in a name rather than in a tooltip's `aria-describedby`, which exists only while the
tooltip is open.

| Where | Rule |
| --- | --- |
| `CefrBadge` | The band and rank are the name; the word they belong to is the description. `aria-describedby` is always ours, never Radix's — the name already says what its tooltip says. In the search field the description points at the `invisible` mirror of the value, which Chrome reads because a directly-referenced node counts even when hidden |
| `SwapButton` | Same trade: disabled, the reason why is in the name, not only in the tooltip |
| A clickable alternative | Named by the word and nothing else, or the line stops reading as the translation. What clicking it does is a description — announced on focus, not while reading — and one element holds that sentence for every term on the card. The cost is two tab stops per badged term, the word and then its level, since the badge keeps its own focus for its rank |
| `AbbrLink` | `title` on the `<abbr>`, and no Fondue tooltip. A Fondue one needs its own focusable trigger, which made each credit two tab stops with the same name, and it would paint a second tooltip over the native one |
| `WordSearchBox` | Named by its section heading (`labelledBy`), not by a second copy of the same string |
| Section headings | Visible, and every one of them is also the name of the section it opens. Nothing is hidden for assistive tech alone, so a heading cannot drift from the name it gives |
| `WordCard` | Named by its own heading, "Meaning of <word>". The word is in the name because the live region beneath it would otherwise announce a translation with no subject, and the heading is visible because it is what starts the card's row level with the panel facing it. The level, where the card carries it, sits beside that heading and not inside it — it belongs to the word, not to the card |
| Search help | `aria-hidden`, so it is read once as the field's description. A hidden element still contributes its text when `aria-describedby` names it directly |
| Redirect line | `role="status"`, and the element is **always** in the DOM, empty or not. A live region inserted in the same commit as its text is announced by some readers and not others. Polite, not an alert: the word was found, and the card beside it is about to be read anyway |
| The two language selects | The heading above each is its visible label — "Language" and "Meaning of <word>". What the trigger shows is the ISO code, which is the value, not the name. The source one also carries `lang-help` as its description, the advice 3.2.2 wants before the pick |
| Prose | A language is named in English (`englishName`) inside an English sentence. `SOURCE_LANG_META.name` is the endonym, which is the picker's job |
| `lang` | On the foreign word, never on the box around it (3.1.2). A listbox's own name is English, so `lang` there marks "Words in A1 · Beginner" and "Word suggestions" as German too — it sits on each option instead. `CefrBadge` carries `lang="en"`, because its name is English prose inside a translation's `lang` span |

### The lint rule, and what it cannot see

`eslint.config.mjs` runs `jsx-a11y` over `src/**/*.tsx`. `pnpm --filter @word-bands/web lint`,
and it runs in the pre-push hook and in `pr.yml` alongside the typecheck.

| Choice | Why |
| --- | --- |
| `recommended`, not `strict` | `strict` withdraws the escape hatches this app uses on purpose — among them `<ul role="listbox">` with `<li role="option">`, which is the ARIA combobox pattern as the APG writes it |
| Two rules added on top | `control-has-associated-label` and `anchor-ambiguous-text`, both off in `recommended` and both on the subject of every control saying something |
| `<abbr>` needs a `title` | A `no-restricted-syntax` selector. There is no `jsx-a11y` rule for it, and the failure it guards already happened here: the expansion was passed to a wrapper and never reached the element |
| Unused disables are errors | An exemption that outlives its reason is a finding of its own |

Six places disable a rule inline, each with the reason above it. Four are the same two
blind spots: a composite using **roving tabindex** looks unfocusable to
`interactive-supports-focus`, because the tabindex is on the children; and an ARIA
combobox's options look inert to `click-events-have-key-events`, because the keys are on
the input. The other two are the deliberate `autoFocus` and `CefrBadge`'s focusable
`role="img"`.

**Most of what this section documents is invisible to the linter.** It reads one element
at a time, so it cannot see a name computed from two elements, a tablist with no panel, a
string said twice in different components, or anything Fondue renders. The tests hold some
of those; the transcript below holds the rest.

### The transcript

`scripts/a11y-transcript.txt` is the deployed page written down as what a screen reader
would say: the outline, the tab order, the two composite widgets under their arrow keys,
how the translation reads against how it copies, and what a lookup that redirects says it
did. That last one is a second scenario (`FORM_SCENARIO`, `?word=jede`) rather than a
section of the first, because a redirect is a different page state — `?word=Wasser` is a
direct hit and never renders the line at all. It also reaches its base word through the
chase past a dropped lemma, so the part likeliest to break quietly is the part transcribed.

| Command | Does |
| --- | --- |
| `pnpm a11y:check [url]` | Transcribe the page and diff it against the file. Exits 1 on any difference |
| `pnpm a11y:update [url]` | Rewrite the file |

Both take a target, and `pnpm a11y:check http://localhost:3000` against a running `pnpm
dev` reads the same as production — so a change of ours can be seen before it is pushed.
Unlike `decode:check`, the two targets are not expected to differ: nothing here is a
property of the edge. It stays out of the pre-push hook all the same, since it needs a
browser and a server and takes about forty seconds against the hook's ten.

It **asserts nothing**, which is the point. The three layers divide like this:

| Layer | Reads | Catches |
| --- | --- | --- |
| `jsx-a11y` | One element, statically | A malformed element — a role missing its required props, an invalid `aria-*` |
| The suite | One component, in jsdom | A named fact someone thought to assert |
| The transcript | The whole deployed page | A change in what is heard, including in what nobody thought to assert |

That third row is where both real findings came from. The doubled `CEFRCEFR` name, six tab
stops for one tablist, a credit reachable twice under the same name, and six CEFR badges
announcing a level with no word attached — none of those is a property of one element or
one component, and none of them was on anyone's list.

| Detail | Why |
| --- | --- |
| It runs against the deployed page | Fondue builds part of the markup and CSS decides what is in the tree at all. jsdom has neither |
| `/api/translate` is stubbed | Google can reword a translation any afternoon, and the subject here is our markup, not today's dictionary |
| Each section that presses a key reloads first | Arrowing the cloud queues a lookup that lands 300ms later and opens that word's band — mid-way through the next section, reverting the tab it had just moved |
| Every wait is keyed on the page, never on a number of seconds | A tab takes focus in its key handler and its `aria-selected` a render later, and its panel is a fetch after that. Reading straight away catches it selected on some runs and not others |
| Post-deploy and weekly, not on a PR | It reads a deployed page, and a preview sits behind Deployment Protection, which answers a 302 to a Vercel login |
| Names and descriptions come from Chrome; **roles and states do not** | A name is computed, and half the markup is Fondue's, so there is no reading it off the source. A role is authored — and Chrome renames them between versions (`img` became `image`), which would make this a transcript of whichever Chrome the runner shipped that week |
| The browser's locale is pinned to `en-US` | The page formats ranks and counts with `toLocaleString()`. Unpinned, the same page reads `rank 18,422` on one machine and `18 422` on another |
| The tab walk starts past the first three stops | Blurring the autofocused field leaves Chrome's sequential-focus starting point on it, so the first Tab lands on what follows the field — the skip link, the source select and the field itself are never walked. The source select is focused directly in a section of its own, since its description is what WCAG 3.2.2 rests on |
| Next's dev-tools overlay is skipped in the tab walk | `next dev` serves it as a focusable custom element (`nextjs-portal`) that production never has. Without skipping it a local run differs from the deployed page by one stop, which is the whole local workflow gone. Skipped rather than stopped on, and it does not consume a stop number |
| The desktop shape is asserted before transcribing | Below 700px the band tabs are a dropdown. A window that came up the wrong size would otherwise arrive as a pile of unexplained differences rather than as the environment being wrong |

Its honest limit is that it catches **change, not badness**. The first read is what finds a
problem; after that it only guards. An intended change makes it fail, and the fix is to
re-run with `--update` and let the diff be reviewed — that reading is the whole check.

### Where Fondue has to be corrected

All are internals. The first four are matched by structure, because the CSS module's
class is a build hash; the last has a literal class to name.

| Component | What it does | What we do |
| --- | --- | --- |
| `SegmentedControl.Item` | Stacks an active and an inactive copy of the label to reserve the bold width, hiding neither | Pass `aria-label` — spread through, since it is not on Item's typed surface. Without it the name reads "CEFRCEFR" |
| `TextInput.Root` | Paints the placeholder into a sibling div and leaves the native one transparent | A layout effect marks that div `aria-hidden`, or its text is read as loose content inside the search landmark |
| `TextInput.Root` | Draws its border at half alpha, 1.77:1 on the light panel | Solid `--color-neutral-60` in `globals.css`, 3.61:1 light and 5.23:1 dark from one value |
| `Select` options | Marks the option under the keyboard by fill alone, 1.14:1 in light | Outline it in `globals.css`. **`data-highlighted` is on every option**, downshift-style, so the selector needs `="true"` or the whole menu is outlined |
| `ThemeProvider` | Sets `--color-focus-default` on its own element, so the same token set on `<html>` reaches nothing inside it | Set it on `.fondue-theme-provider` as well — a literal class in Fondue's markup beside the hashed theme one, so this is the one correction here matched by name |

The Tailwind preset replaces the outline scales with a single `DEFAULT` — 4px wide, 2px
offset — so `tw-outline-2` and `-tw-outline-offset-2` generate nothing and the width
silently lands on 4px. Arbitrary values are the way out:
`tw-outline-[length:2px] tw-outline-offset-[-2px]`.

### The focus ring

`--cue-line` draws it, and `--color-focus-default` is redefined to that so Fondue's own
rings take it too. The blue those shipped with read 3.01:1 on a white panel and 2.83:1 on
the light page, under the 3:1 of 1.4.11 and 2.4.13; the grey clears 3:1 on every surface
of its own theme, because it is the same theme-split line the selected tab and the
highlighted option are drawn in.

| Detail | Why |
| --- | --- |
| Two lines, the surface inside and the focus colour outside | The shape Fondue already draws. It is what makes the ring visible over a filled control — the fill cannot swallow both lines at once |
| The token, not the rules | Every ring in Fondue's stylesheet reads `--color-focus-default`, in 44 places, all of them an outline or a box-shadow. Overriding rules instead meant chasing one component at a time, and the segmented control was still blue after the first pass |
| `#main` silences both | It takes programmatic focus from the skip link, and a ring around the whole page is not what that means |
| Measured by `p2-focus.mjs` | Its `ringContrast` read the outline only, so a Fondue ring drawn as a box-shadow reported `null`. It reads both now, plus `ringSelfContrast`, the two lines against each other |

### Focus and selection in the search field

| Rule | Why |
| --- | --- |
| The page opens with the field focused and its word selected | It lands holding a word nobody asked for, so the first keystroke means a new one |
| A click into it selects the whole value, on the click that focuses it and on no other | Clicking in asks for a different word far more often than it edits this one, and a second click has to leave the caret where it was put |
| Switching the source language refocuses the field and selects the default word it lands on | That word is no more asked for than the one the page opens on. On a phone this is the difference between typing and first tapping the field to raise the keyboard |
| The source select says so first, in a description | A focus move on a setting change is a change of context, which WCAG 3.2.2 allows only where it was advised beforehand. A description is read on focus, before the menu opens; the field is read after the move has already happened. It sits on the source select alone — picking a target moves nothing |
| A swap, a clicked alternative and a chip never take the field | Each lands on a word the learner picked, and on a phone a keyboard would come up over the card that just answered |
| A clicked alternative lands on the card instead, and only where it dropped focus | Its own button is removed by the re-render the pick causes, so focus falls to `<body>`. The card is `tabIndex={-1}` for that one purpose, and it waits for the new word: the name says "Meaning of" whichever word is there, so moving early would announce the one just left |
| The selection is re-applied after the lookup recases the word | "wasser" comes back "Wasser", which collapses the selection. Without this, half the languages open only half-ready |
| `Workspace` bumps `reseeded`, rather than the box watching `source` for a change | A swap turns the languages over too, and that one must not take the field |
| Fondue's `Select` anchors Radix's popover instead of triggering it | Closing the menu therefore restores focus nowhere — Radix's `triggerRef` is empty — so the field can take focus as the switch commits, with nothing to race. Settled in a browser: jsdom shows no fight either way |

### The band tabs and the word cloud

| Widget | Contract |
| --- | --- |
| Band tabs | A real tablist: one tab stop, arrow keys and Home/End inside it, `aria-controls` on each tab and `role="tabpanel"` on the words below. Activation follows focus, since the band is fetched or cached by then |
| Previous and Next | `aria-disabled`, not `disabled`, the same trade `SwapButton` makes. At a band's end the step runs out under the finger already on it, and a `disabled` button loses focus to the body as it turns |
| Tab name | Spelled out with `aria-label`. The label and the count are separate elements and join with no separator, which read as "A1 · Beginner1,000 words" |
| Word cloud | A `listbox` of `option`s, not a group — that is what says the arrow keys are there. The row wrappers are `role="presentation"` so the options stay owned by it |
| `aria-setsize` / `aria-posinset` | Stated, not counted. Only the rows near the viewport are in the DOM, so a chip's place in the band cannot be inferred from it |
| The chips' widths | Measured on a canvas from a hidden probe chip, never from the DOM, since the rows are packed before they are rendered. A `ResizeObserver` watches the probe as well as the container, so a text-spacing override (1.4.12) or a late font re-measures rather than clipping the last chip of every row |

### Crawlers and link previews

`lib/site.ts` holds the three values, and `layout.tsx`, `page.tsx`, `robots.ts`,
`sitemap.ts` and `manifest.ts` read them. `app/icon.svg` is the favicon.

Next merges metadata **shallowly**: a child naming `openGraph` replaces the parent's whole
object rather than adding to it. So `page.tsx` restates the Open Graph and Twitter fields
around the word-specific title. Setting only `title` there leaves a shared deeplink
previewing as "word-bands" while its tab says the word.

The sitemap lists one URL. Every word is query state on the same page.

## API route params

Next percent-decodes a route param before the handler sees it, so a `decodeURIComponent` in
a handler is a second pass. `ROUTE-7` is the rule: take the param as given, lowercase it
where the lookup wants that, and nothing else.

| Where it runs | Decodes | So |
| --- | --- | --- |
| `next start` | Next's, once | |
| Vercel | The edge's, then Next's | A word needs one more `%25` layer than it does locally |

The count is a property of where the code runs, not of the code, which is why `ROUTE-1` to
`ROUTE-6` state both columns.

| Trap | Detail |
| --- | --- |
| A second decode in a handler | On a param still holding a literal `%` it throws a `URIError` nothing catches, and the route answers an empty 500 where it should answer 404 |
| That 500 is Next's, not ours | Every dynamic param does it — `/api/bands/%`, `/api/band/%/%`, `/api/translate/%` — while `/api/suggest?q=%` answers 200 and the static `/%` answers 404 |
| It never ships | Where the extra decode would leave a bare `%`, the edge answers 400 or 404 first |
| No test sees any of it | `hostile-input.test.ts` and `routes.test.ts` call handlers directly with params already decoded, which is the right thing to test — `routes.test.ts`'s `%` param 500s under a second decode and 404s without one. Both guard the handler; neither guards what sits above it |

So settle a decode question against the deployed URL, never against `next start`.
`pnpm decode:check` is what does that: it probes the Vercel column and exits 1 on any row
that moved, naming it.

| Detail | Why |
| --- | --- |
| It reads the rows out of `SPEC.md` | The table is the source and cannot drift from what is asserted. The cost is that reformatting it breaks the check, which it reports as `parsed 0 rows` rather than quietly passing |
| Post-deploy and weekly, in `deployed-decodes.yml` | The edge is Vercel's, so the column can move with no commit of ours to trigger on |
| It takes a target | `pnpm decode:check http://localhost:3111` flags the `%` and `%2577ater` rows — the check discriminating between the two columns, not failing |

## Response headers

`next.config.mjs` sends the same set on every path. `poweredByHeader: false` drops the
framework name; Vercel adds HSTS on its own, so we do not.

`HEAD-1` names the five. Two are worth knowing the reason for: `X-Frame-Options` says what
`frame-ancestors` already says, for browsers that do not read it, and `Permissions-Policy`
turns off camera, microphone, geolocation and payment because the page asks for none of
them.

**The policy is `'self'` and nothing else.** Everything the page loads is same-origin —
no CDN, no webfont host, no analytics. That is what makes a tight CSP possible, and it is
also the thing to remember: a Google Font link, a CDN script or an outbound beacon is
blocked, and blocked quietly. Add the host to the matching directive in the same change,
or the resource simply never arrives.

| Concession | Why |
| --- | --- |
| `script-src 'unsafe-inline'` | Next streams the RSC payload through inline `<script>` tags. Nonces would need middleware, which is a larger surface than this buys on a page with no HTML sink |
| `style-src 'unsafe-inline'` | Fondue and the `style={{…}}` props |
| Dev only: `'unsafe-eval'`, `connect-src ws:` | HMR evals and opens a socket back. Keyed off `NODE_ENV`, so production runs the stricter policy — check a CSP change against a production build, not just `pnpm dev` |

The theme cookie takes `; secure` only over https. Unconditional would break a dev server
reached over plain http on the LAN, where the browser drops a Secure cookie and the theme
stops persisting between loads.

## Verifying a build while the web dev server is running

`next dev` and `next build` both default to `apps/web/.next`. Building into it while a dev
server is live overwrites that directory and breaks the running server; its API routes
start returning 500s.

| Command | Safe while `pnpm dev` is up |
| --- | --- |
| `pnpm test`, `pnpm typecheck` | Yes |
| `pnpm --filter @word-bands/web build:check` | Yes — builds into `.next-build` |
| `pnpm build`, `turbo run build`, `next build` | No — stop the dev server first |

`.githooks/pre-push` runs the typecheck and the suite before a push, which is why it runs
neither of the bottom row: a hook that built would corrupt whatever dev server is up. It
needs `git config core.hooksPath .githooks` once per clone, and `--no-verify` skips it.

Because both of those make the hook opt-in, `pr.yml` also runs on pushes to `main`. That
reports after the deploy rather than before it, which is the weaker half of the trade —
branch protection's required `check` only reports from a `pull_request` event, so a direct
push is bypassed with a warning and would otherwise get no run at all. On a PR it still
reports before the merge, which is where it is worth the most.

Two test files are nets rather than cases, and are worth extending rather than working
around:

| File | Holds |
| --- | --- |
| `src/app/api/hostile-input.test.ts` | Every route crossed with junk input, asserting no 5xx. A new route or param means a new row in `POSITIONS` |
| `src/app/next-config.test.ts` | That the response headers are still sent, and that the CSP still names no host |

`build:check` leaves one tracked file dirty: Next rewrites `next-env.d.ts` to import
`./.next-build/types/routes.d.ts`. Check it out again afterwards, or the committed file
points at a directory only that command builds.

## Dependency updates

`.github/dependabot.yml` runs weekly, groups minor and patch, and leaves every major a PR
of its own. Two things about it are load-bearing.

| Detail | Why |
| --- | --- |
| One directory, and it is the root | pnpm workspace: the lockfile is at the root, and an update from there rewrites `apps/web/package.json` and `pnpm-lock.yaml` together. Listing `/apps/web` as a second directory opens a duplicate PR per dependency that edits the manifest alone — there is no lockfile in that directory — and every one fails `pnpm install --frozen-lockfile`, in CI and on Vercel alike |
| The limit is per directory | `open-pull-requests-limit: 8`, counted per directory rather than across the config |

Two majors are ignored, because a peer range in a package we do not control forbids them:

| Ignored | Blocked by |
| --- | --- |
| `tailwindcss` ≥ 4 | `@frontify/fondue-tokens` peers `^3.4.17` |
| `typescript` ≥ 6 | `@typescript-eslint/parser` peers `>=4.8.4 <6.1.0` |

An ignore is a decision to stop hearing about something, and nothing pulls on it — so each
entry states its reason as a `# blocked-by:` line, and `pnpm ignores:check` reads that
claim out of the file and compares it against `pnpm-lock.yaml`. It fails when a blocker
stops peering the way the entry says, which is the moment the major may be takeable. It
runs in `pr.yml` and the pre-push hook.

Reading the installed lockfile is the whole scope on purpose: an upstream release we have
not taken cannot unblock anything, so this fires on the commit that upgrades the blocker
and needs no schedule of its own.

## Vendored skills

`.claude/skills/` holds four skills and none of them is ours. They come from two
upstreams, and nothing in the repo pulls on them, so nothing would notice them rotting.

| Skill | Upstream | Refreshed by |
| --- | --- | --- |
| `next-cache-components-adoption` | `vercel/next.js@canary`, `skills/` | `scripts/sync-next-skills.mjs` |
| `next-cache-components-optimizer` | same | same |
| `next-dev-loop` | same | same |
| `fondue` | `Frontify/fondue@main`, `packages/sdk/skills/fondue/` | `npx skills update`, Vercel's skills CLI |

| Command | Does |
| --- | --- |
| `pnpm skills:check` | Verify the fondue install, then report drift in the Next.js three. Writes nothing, exits 1 on either |
| `pnpm skills:sync` | Write both upstreams over ours |

`skills:check` reports *drift* only for the Next.js three, because the skills CLI has no
dry run: its `update` either changes fondue or does not. What it checks for fondue is that
the install is intact, which is the half a clone can get wrong.

Which of the Next.js skills are vendored is read off the disk: any directory in
`.claude/skills/` that also exists upstream is synced, and upstream skills absent here are
listed as `not vendored`. The directory name is the whole declaration, so vendoring a
fourth is a `mkdir` plus `pnpm skills:sync`, with no edit to the script.

### How fondue is laid out

`skills-lock.json` at the repo root is what makes `npx skills update` able to find the
skill at all. Without it nothing knows fondue is installed.

| Path | Holds |
| --- | --- |
| `.agents/skills/fondue/` | The real files. The CLI treats this as the canonical copy |
| `.claude/skills/fondue` | A relative symlink to it, which is where Claude Code looks |
| `skills-lock.json` | Source, path and a content hash. No commit sha, so it pins nothing |

The files are committed rather than left to the lock to restore. `experimental_install`
rebuilds only `.agents/skills/`, never the agent directory, so a clone carrying just the
lock would give Claude Code no skill at all.

The skill names the `@frontify/fondue` version it was written against, while the SDK it
queries is whichever version `apps/web` has installed. The two drift apart on their own,
and the skill says so itself: trust what the SDK returns over what the skill says.

### What a fresh clone needs

Nothing. The files, the lock and the symlink are all committed, and the weekly workflow
runs on GitHub rather than on anyone's laptop, so the skills keep updating across a new
machine or a reformatted disk. `pnpm skills:check` is the command that says so.

`scripts/check-fondue-install.mjs` reads the lock, then reads `SKILL.md` through
`.claude/skills/` rather than through `.agents/`. That path is the one an agent uses, so
the single read covers every way a clone can be wrong: no lock, no `.agents/`, or a
checkout that wrote the symlink as text because `core.symlinks` was off.

### The weekly workflow

`.github/workflows/skills-freshness.yml` runs both syncs weekly and opens a PR on the
`chore/skills-sync` branch when either upstream has moved. Keeping copies rather than
installing Vercel's Next.js plugin is a deliberate trade: the plugin would track `canary`
on its own, but it clones a 2.42GB monorepo for three markdown files and pins nothing.

| Trap | Detail |
| --- | --- |
| Watching the wrong directory | fondue's real files live in `.agents/`, so `.claude/skills` alone misses every fondue update. `WATCH` names all three paths and both the drift check and the commit read it, so they cannot disagree |
| Symlinks are not directories | `readdir` reports a symlink as a symlink, so `sync-next-skills.mjs` would silently stop covering any Next.js skill that got symlinked. It only ever sees real directories |
| A green fondue step means nothing on its own | `npx skills update` exits 0 whether it refreshed the skill or never found it. The workflow runs the check either side of it, so "saw nothing" cannot pass as success |
| Rate limit | The sync script makes one GitHub API call. Unauthenticated that budget is 60/hour per IP, so a local run can fail on someone else's spending; `GITHUB_TOKEN` raises it |
| Required check | A branch pushed with `github.token` fires no `pull_request` event, so `pr.yml` never runs and the required `check` status never reports. The workflow dispatches `pr.yml` on the branch to put that status on the same commit |
| Scheduled runs stop | GitHub disables a cron workflow after 60 days of repo inactivity. `workflow_dispatch` restarts it |
| Unpinned CLI in CI | The fondue step runs `npx skills@latest`, third-party code from npm at whatever version is current. Upstream's own install instructions are unpinned and pinning would rot, so the exposure is accepted — but the workflow is split in two so it is accepted in a job that cannot write |
| Two jobs, not one | `sync` runs the CLI under `contents: read` and hands `propose` a tarball; `propose` writes and runs no third-party code. A compromised CLI can still put files in front of a reviewer, which is what the PR is for. What it cannot do is push, open a PR, or dispatch a workflow |
| tar, not the artifact walk | `.claude/skills/fondue` is a symlink. An uploader that follows it hands `propose` a directory where the repo keeps a link — the exact layout `check-fondue-install.mjs` exists to catch. tar stores the link itself |
| Deletions | A tar of the synced tree carries what upstream added and changed, and nothing records what it removed. `propose` deletes the watched paths before extracting, so the tree matches the sync exactly |
