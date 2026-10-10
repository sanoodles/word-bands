// What names the site to a machine: to a crawler, to a link preview, to an installed
// app. Every one of those spellings has to agree, so they are written here once and
// read from `layout.tsx`, `page.tsx`, `robots.ts`, `sitemap.ts` and `manifest.ts`.
//
// The origin is not derivable at build time — Vercel's `VERCEL_URL` names the
// deployment, not the production domain — so it is stated.

export const SITE_URL = "https://wordbands.vercel.app";
export const SITE_NAME = "wordbands";

/**
 * The one-line description, on the page's `<meta>`, its Open Graph card and the
 * manifest. It names what the site does; the six languages are the part that tells a
 * reader whether it is for them.
 */
export const SITE_DESCRIPTION =
  "Which words to learn first — every word's frequency rank and CEFR level, " +
  "in English, Spanish, French, German, Portuguese and Italian.";
