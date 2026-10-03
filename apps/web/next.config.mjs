const dev = process.env.NODE_ENV === "development";

// Everything the page loads is same-origin — no CDN, no webfont host, no analytics — so
// the policy can name 'self' and stop. `unsafe-inline` stays for scripts because Next
// streams the RSC payload through inline <script> tags; nonces would need middleware,
// which is a bigger surface than the one this buys. Dev additionally evals (HMR) and
// opens a websocket back.
// @spec HEAD-2, HEAD-3, HEAD-4
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// @spec HEAD-1
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // frame-ancestors covers this for anything current; kept for browsers that don't read it.
  { key: "X-Frame-Options", value: "DENY" },
  // The page asks for none of these, so nothing it loads should be able to either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` and `next build` both default to `.next`; building into it while a
  // dev server is live corrupts the server. `build:check` overrides this so a
  // verification build lands in a separate dir and can't clobber dev.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // bands.ts imports data/word-bands.json directly, so the tracer bundles it
  // automatically — no outputFileTracingIncludes needed.
  // @spec HEAD-5
  poweredByHeader: false,
  // The agent instructions live in the root CLAUDE.md, not in files `next dev` writes here.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
