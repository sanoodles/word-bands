# word-bands

A vocabulary learning tool: **which words to learn first** — in English, Spanish,
French, German, Portuguese, or Italian. Pick the language you're studying; every word
is placed on a learning band — by raw **frequency**, or by **CEFR level** — so you can
look a word up to see where it lands, or browse the whole vocabulary in order.

## How it works

Learning order is driven by **word frequency**: the words you meet most often are the
ones worth learning first. We measured frequency to be a far better predictor of
learning order than any dictionary-structure metric, so the ranking rests on it alone.

- **Frequency** comes from [SUBTLEX-US](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus)
  (Brysbaert & New, 2009) for English, and from the OpenSubtitles-derived
  [FrequencyWords](https://github.com/hermitdave/FrequencyWords) lists for the other
  languages. Inflections are merged onto their base form via a per-language
  [lemmatization list](https://github.com/michmech/lemmatization-lists), so a concept
  is one entry carrying its combined frequency.
- **CEFR levels** (A1–C2) are derived from frequency rank, with the band boundaries
  calibrated against the [CEFR-J Wordlist](https://www.cefr-j.org/) (Tono, Tokyo
  University of Foreign Studies) — so the labels are learner-familiar while coverage
  stays the full vocabulary. CEFR-J stops at B2, so the C1 and C2 boundaries extrapolate
  the same doubling trend rather than resting on a source. The calibration is one English
  measurement, reused unchanged for every language as a first-order heuristic: no language
  has a CEFR source of its own, and no external dictionary is required at runtime.
- **The tail is filtered.** A subtitle corpus does not trail off into rare words, it
  trails off into character names, untranslated English, misspellings and OCR debris —
  past rank 25,000 only about one word in seven is in the language's own dictionary. So
  past that rank the lemmatization list has to vouch for a word for it to be listed,
  which leaves each language with 33–40k words of genuine vocabulary.
- **Display casing** is measured from the
  [Leipzig Corpora](https://wortschatz.uni-leipzig.de/en/download) sentence collection:
  how often each word is capitalized mid-sentence decides whether it's shown capitalized.
  One rule serves every language — German nouns, and proper nouns anywhere, come out
  capitalized, while Spanish `lunes` and Italian `gennaio` correctly stay lowercase.
- **Personal names** are filtered out — subtitle corpora are full of character names, which
  aren't vocabulary. A word is dropped only when a [names gazetteer](https://github.com/smashew/NameDatabases),
  the lemma list, mid-sentence casing, and how often it follows a determiner *all* agree
  it's a name; each guard rescues words the others would wrongly take.
- **Defining levels**, for Portuguese and Italian, measure how heavily the dictionary leans
  on a word to define others. They are not a difficulty scale. They are computed from each
  language's own Wiktionary, the [Portuguese](https://pt.wiktionary.org/) and the
  [Italian](https://it.wiktionary.org/)
  ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), extracted by
  [Wiktextract](https://kaikki.org/) (Ylonen, 2022). The definitions are read as a graph of
  which word defines which, as in
  [Blondin Massé et al. (2008)](https://aclanthology.org/W08-2003/) and
  [Vincent-Lamarre et al. (2016)](https://doi.org/10.1111/tops.12211). The levels come from
  that graph's k-core decomposition
  ([Seidman, 1983](https://doi.org/10.1016/0378-8733(83)90028-X)). Restricted defining
  vocabularies go back to West & Endicott (1935) and the *Longman Dictionary of
  Contemporary English* (1978).
- **Translations** — the word card's short meaning — are fetched live from
  [Google Translate](https://translate.google.com/) (its public `gtx` endpoint) in the
  reader's chosen language, and cached. This is the only source consulted at runtime;
  everything above is baked into the committed artifacts at build time.

This keeps the data footprint small and **scales to other languages**: add a frequency
list and a lemmatization list for the language, register it, and rebuild.

## Layout

A single Next.js app.

| Path | Role |
| --- | --- |
| `apps/web` | The website + hosted API (the band browser and word lookup). |
| `apps/web/src/lib/languages.ts` | The supported source languages + their metadata. |
| `apps/web/scripts/build-bands.ts` | Builds the per-language `word-bands.<code>.json` artifacts. |
| `apps/web/data/word-bands.<code>.json` | Committed artifacts: the ranked words + band definitions. |

## Develop

```sh
pnpm install
git config core.hooksPath .githooks   # once per clone, see below
pnpm dev         # http://localhost:3000
pnpm test        # run tests
pnpm typecheck   # type-check everything
```

A push to `main` deploys, so `.githooks/pre-push` type-checks and runs the suite first —
about ten seconds. Git only looks in `.githooks` once `core.hooksPath` points there, hence
the one-time setup above. `git push --no-verify` skips it.

## Rebuild the data

The `word-bands.<code>.json` artifacts are committed, so the app runs without a build
step. To regenerate them, place each language's gitignored inputs in `apps/web/data/`
— English `subtlex.csv` + `lemma-en.txt`; each other language `freq-<code>.txt` +
`lemma-<code>.txt`. Casing and the name filter additionally need `casing-<code>.txt` (a
Leipzig sentences file) per language, plus the shared `names.txt` gazetteer.

`freq-<code>.txt` is FrequencyWords' **`<code>_full.txt`**, not the `_50k` variant — the
build applies its own floor (`minCount` in the `LANGS` table) so the cut is recorded in
code rather than in whichever file was downloaded. Then run:

```sh
pnpm --filter @word-bands/web build:bands        # all languages
pnpm --filter @word-bands/web build:bands es     # just one
```

> **Heads up:** `next dev` and `next build` share `apps/web/.next`, so running
> `pnpm build` while the web dev server is live corrupts it (its API routes start
> 500ing). To verify a production build without stopping `pnpm dev`, use
> `pnpm --filter @word-bands/web build:check` — it builds into `.next-build`.

## License

MIT
