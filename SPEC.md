# word-bands — spec

What this app must do.

CLAUDE.md is the other half: how to work here, where things live, and why a rule is the
rule it is. A statement lives in exactly one of the two files.

| Says | Belongs in |
| --- | --- |
| "must", "never", "always" — a fact about the running app | Here |
| "how", "why", "watch out" — a command, a rationale, a trap | CLAUDE.md |

## How this binds

Each rule carries an ID, and the test proving it names that ID. `pnpm spec:check` checks
both directions and fails on either.

| Piece | Rule |
| --- | --- |
| ID | `AREA-n`. Stable for the life of the rule. Never renumbered, never reused after a rule is deleted |
| The link | An `@spec` comment: `// @spec GATE-1`, or several — `// @spec GATE-1, GATE-2` |
| A proof | A `*.test.ts` / `*.test.tsx` under `apps/web/src`, or a checker under `scripts/`. Only a proof satisfies a rule |
| A mark | The same comment on the code a rule governs, so opening the file tells you which rule binds it. It never counts as proof — code cannot witness itself |
| Unproven rule | An error. A rule nothing asserts is a wish |
| Unknown ID | An error, in a proof or a mark alike. One naming a rule this file does not define is a leftover |
| Where it runs | `pnpm spec:check`, `pr.yml`, and `.githooks/pre-push`. It parses text and needs no network |

`pnpm spec:list` prints every rule by area with its proofs and marks; `pnpm spec:files`
prints the reverse, a file at a time. Neither is stored — both are derived on the read, so
neither can go stale.

One test may prove several rules, and one rule may be proven in several places. A rule that
is a property of the edge, or of every route at once, has no single place to mark and
carries none. What the check will not do is judge whether the test is any good — it
verifies the claim exists, not that it bites.

## Areas

| Prefix | Covers | Proof runs |
| --- | --- | --- |
| `GATE` | What `/api/translate` agrees to forward to Google | PR |
| `WARM` | The scheduled pass that keeps the de<->en head warm | PR |
| `ROUTE` | Route params: decoding, status codes, no 5xx | PR, and post-deploy for `ROUTE-1`–`ROUTE-6` |
| `BAND` | Band definitions, word lookup, levels, typeahead | PR |
| `FILTER` | What the committed artifacts must and must not contain | PR |
| `HEAD` | Response headers and the CSP | PR |
| `URL` | Deeplink state and the page title | PR |

Not covered yet, and deliberately: visual design, copy, component layout, the
accessibility contract (its proof is the transcript, which detects change rather than
badness), and the country/browser seeding rules.

## GATE — what /api/translate agrees to relay

Whatever reaches this route is forwarded to Google on our quota, so it must be a request
the word card could have made.

| ID | Rule |
| --- | --- |
| GATE-1 | A word param is 1 to 64 characters and holds no whitespace |
| GATE-2 | Hyphens and apostrophes are part of a word, not separators |
| GATE-3 | The source is one of the six indexed languages |
| GATE-4 | The target is two or three lowercase letters, and may be any language, not only the six |
| GATE-5 | A refused request answers 400, and Google is not called |
| GATE-6 | An upstream failure answers 502 |
| GATE-7 | Without `dict=1` the word is lowercased; with it the casing is kept |

## WARM — the scheduled pass over the head

A cron walks the A1+A2 head of de<->en, 100 words a day, so the words a learner browses
are always in the data cache rather than waiting on a first visitor to fetch them.

| ID | Rule |
| --- | --- |
| WARM-1 | The warm route answers 401 without the configured cron secret, and Google is not called. An unset secret refuses every request rather than opening the route |
| WARM-2 | A day's slice is 100 words, derived from the date alone, and consecutive days cover the whole head before wrapping |
| WARM-3 | Every word in the pass is one `/api/translate` would accept, and a case-homograph contributes both of its casings |
| WARM-4 | The pass reports how many of the words it asked for answered without going upstream |
| WARM-5 | The pass logs its result, since the response is returned to a scheduler that discards it |

## ROUTE — params, decoding and status

`ROUTE-1` to `ROUTE-6` are the deployed decode table. Vercel's edge decodes the path
before Next does, so a deployed param arrives decoded one more time than under `next
start`. The number of decodes is a property of where the code runs, not of the code, and
these rows state the deployed column. `scripts/check-deployed-decodes.mjs` reads them out
of this table rather than restating them, so reformatting it fails the check loudly rather
than quietly asserting nothing.

| ID | Request | `next start` | Vercel |
| --- | --- | --- | --- |
| ROUTE-1 | `/api/word/%` | 500 | 400 |
| ROUTE-2 | `/api/word/%25` | 404 | 404 |
| ROUTE-3 | `/api/word/%2525` | 404 | 404 |
| ROUTE-4 | `/api/word/%77ater` | 200 `water` | 200 `water` |
| ROUTE-5 | `/api/word/%2577ater` | 404 | 200 `water` |
| ROUTE-6 | `/api/word/%252577ater` | 404 | 404 |

| ID | Rule |
| --- | --- |
| ROUTE-7 | A handler takes its param as Next hands it over. No second decode |
| ROUTE-8 | A word lookup lowercases its param |
| ROUTE-9 | An unknown word, source language, view or band answers 404 |
| ROUTE-10 | No caller-controlled value produces a 5xx on any route |
| ROUTE-11 | `/api/suggest` clamps a limit above its cap and falls back to the default for one that is not a count |

## BAND — bands, levels and lookup

Bands are frequency-rank thresholds calibrated against CEFR-J. They are English-derived
and reused for every language.

The `defining` view is the exception: a defining level is a property of the word, measured
from how often a dictionary reaches for it when defining others, so its bands are sets
rather than rank windows. It needs a dictionary graph per language and only Portuguese has
one, which is why it is the one view a language can lack.

| ID | Rule |
| --- | --- |
| BAND-1 | The CEFR bands top out at rank 1,000 / 3,000 / 6,000 / 12,000 / 25,000 / 50,000 for A1 / A2 / B1 / B2 / C1 / C2 |
| BAND-2 | Every language uses the same band definitions in the `freq` and `cefr` views |
| BAND-3 | Every rank in a language's list falls inside a band |
| BAND-4 | A band holding no words is not offered |
| BAND-5 | A word lookup keys on lowercase and answers in the corpus's display casing |
| BAND-6 | A case-homograph answers with both casings, most frequent first |
| BAND-7 | A translated term's level keys case-insensitively |
| BAND-8 | A phrase, or a word the language has no headword for, has no level |
| BAND-9 | Only the six indexed languages carry levels |
| BAND-10 | Typeahead matches a lowercase prefix, answers in frequency order, honours its limit, and leads with an exact match |
| BAND-11 | Only a language carrying defining levels offers the `defining` view; for the rest it answers 404 |
| BAND-12 | In the `defining` view every word falls in a band, the ones with no level in `none` |
| BAND-13 | The defining figure's data carries one level per ranked word, and is served only for a language that has levels |
| BAND-14 | In typeahead a letter typed without a diacritic also matches that letter with any diacritic, and a letter typed with one matches only itself. The exact match it leads with is exact in its diacritics too |

## FILTER — what the artifacts hold

The committed `data/word-bands.<code>.json` files are the build's output and the app's
only corpus. These rules are about their contents, so they hold whether or not anyone
re-runs the build.

| ID | Rule |
| --- | --- |
| FILTER-1 | No clitic surface form survives in Portuguese or French |
| FILTER-2 | Hyphenated vocabulary survives, because clitic segments are matched whole |
| FILTER-3 | A surface word that heads its own lemma entry keeps it rather than merging into another |
| FILTER-4 | However deep a list runs, its deepest word still falls in a band, and the tail band is offered exactly where a list runs past rank 50,000 |
| FILTER-5 | A personal name that is also an ordinary word of the language survives |
| FILTER-6 | Display casing is measured mid-sentence, not ruled: German nouns and proper nouns are capitalized, weekdays and months are not |
| FILTER-7 | A word measured lowercase mid-sentence is stored lowercase, in every language |
| FILTER-8 | A lemma headword that is not a word of the language holds no entry; its frequency sits under the form that is written |
| FILTER-9 | Below the dictionary gate, German holds no word its own spell checker rejects |
| FILTER-10 | Past the dictionary gate, German keeps a word its own compounding or derivation accounts for, and still drops what the corpus tail is made of |

## FORM — looking a word up by an inflected form

The build merges every inflection onto its lemma, so a form is not an entry of its own.
`data/forms.<code>.json` is the way back.

| ID | Rule |
| --- | --- |
| FORM-1 | An inflected form the corpus writes resolves to the indexed word it belongs to |
| FORM-2 | Every redirect names a word that is in the list, including where the lemma itself was dropped |
| FORM-3 | A word found as typed is never reported as a redirect |
| FORM-4 | `/api/word` resolves a form only after an exact lookup misses, and names the form it was asked for |
| FORM-5 | A redirected answer says which word it is showing and which form was asked for |
| FORM-6 | That sentence is announced when it appears, politely, from a region that was already there |

## HEAD — response headers

| ID | Rule |
| --- | --- |
| HEAD-1 | Every path carries the CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy` |
| HEAD-2 | The CSP names no host. Everything the page loads is same-origin |
| HEAD-3 | `default-src`, `object-src`, `frame-ancestors`, `base-uri` and `form-action` are all closed |
| HEAD-4 | Production carries neither `unsafe-eval` nor a websocket source |
| HEAD-5 | The framework is not named in a response header |

## URL — deeplink state

| ID | Rule |
| --- | --- |
| URL-1 | The scenario is five params: `source`, `word`, `target`, `view`, `band` |
| URL-2 | `lang` and `tl` are read, never written |
| URL-3 | An unknown source language or view is dropped rather than honoured |
| URL-4 | `band` is written only when set. `source` and `view` are always written |
| URL-5 | On mount the URL wins over a stored pick, which wins over the seeded pair |
| URL-6 | The tab title is `word-bands: <word>`, capped at 40 characters, and `word-bands` with no word |
| URL-7 | A deeplink's word reaches the Open Graph and Twitter titles server-side, not only the tab |
| URL-8 | `view=defining` is dropped when the link's source language has no defining levels |
