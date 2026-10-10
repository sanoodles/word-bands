// The learner's current scenario, encoded in the URL's query string so it can be
// copied as a shareable deeplink. Reflects the four things a sender might want a
// recipient to land on: the source language, the looked-up word, the target
// language, and the band view / pinned band tab.

import { isSourceLang, type SourceLang, type TargetLang } from "@/lib/languages";
import { SITE_NAME } from "@/lib/site";
import type { BandView } from "@/lib/types";

// A client-safe copy of `bands.isView`, which cannot be imported here: that module is
// server-only and this one runs in the browser.
const isView = (v: string): v is BandView => v === "freq" || v === "cefr" || v === "defining";

// The spellings each language is accepted under, canonical first. Only the canonical one
// is ever written, so a link carrying another is rewritten the moment it is opened.
// @spec URL-2
const SOURCE_PARAMS = ["source", "lang"] as const;
const TARGET_PARAMS = ["target", "tl"] as const;

function param(p: URLSearchParams, names: readonly string[]): string | null {
  for (const n of names) {
    const v = p.get(n);
    if (v) return v;
  }
  return null;
}

export interface Scenario {
  /** Source language whose vocabulary is being browsed. */
  source: SourceLang;
  /** The looked-up word. */
  word: string;
  /** Target language (the reader's own). */
  target: TargetLang;
  /** Which way the vocabulary is split: frequency, CEFR, or defining level. */
  view: BandView;
  /** An explicitly-picked band tab, when it differs from the word's own band. */
  band: string | null;
}

/**
 * The document title for a scenario's word — the other place the scenario surfaces.
 * Shared so the server-rendered title and the client's agree word for word.
 * @spec URL-6
 */
export function pageTitle(word: string | null | undefined): string {
  // Sliced because the word can come straight off the query string, unlooked-up.
  const w = word?.trim().slice(0, 40);
  return w ? `${SITE_NAME}: ${w}` : SITE_NAME;
}

/** The scenario encoded in the current URL, if any (client-only; empty on the server). */
// @spec URL-1, URL-3
export function readScenario(): Partial<Scenario> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Partial<Scenario> = {};
  const source = param(p, SOURCE_PARAMS);
  if (source && isSourceLang(source)) out.source = source;
  const word = p.get("word");
  if (word) out.word = word;
  const target = param(p, TARGET_PARAMS);
  if (target) out.target = target;
  const view = p.get("view");
  if (view && isView(view)) out.view = view;
  const band = p.get("band");
  if (band) out.band = band;
  return out;
}

/**
 * Reflect the scenario into the URL. Uses replaceState — we're mirroring live state
 * for sharing, not adding a history entry for every language flip or band click.
 * @spec URL-4
 */
export function writeScenario(s: Scenario): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  p.set(SOURCE_PARAMS[0], s.source);
  if (s.word) p.set("word", s.word);
  if (s.target) p.set(TARGET_PARAMS[0], s.target);
  p.set("view", s.view);
  if (s.band) p.set("band", s.band);
  const { pathname, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}?${p.toString()}${hash}`);
}
