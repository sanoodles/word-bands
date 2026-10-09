// One invariant across every route: nothing a caller can put in a param or the query
// string makes a handler throw. A 4xx is a fine answer to junk; a 5xx means the junk got
// somewhere it was not handled. Add a row to POSITIONS when a route or a param is added.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBand } from "@/lib/bands";
import { GET as wordGET } from "./word/[word]/route";
import { GET as suggestGET } from "./suggest/route";
import { GET as bandsGET } from "./bands/[view]/route";
import { GET as bandGET } from "./band/[view]/[key]/route";
import { GET as translateGET } from "./translate/[word]/route";
import { GET as wiktionaryGET } from "./wiktionary/[word]/route";
import { GET as warmGET } from "./cron/warm/route";

const REAL = getBand("en", "freq", "1")!.words[0]!;
const req = (url: string) => new Request(`http://test${url}`);
const promise = <T>(v: T) => Promise.resolve(v);
const q = (v: string) => encodeURIComponent(v);

/**
 * Route params reach a handler already percent-decoded, so these are the decoded forms —
 * a bare "%" is what "%25" on the wire arrives as, and it is the one that finds a second
 * decode. Query values go in encoded, because that is how a caller sends them.
 */
const HOSTILE = [
  "",
  " ",
  "\t",
  "\n\r",
  "%",
  "%25",
  "%2577ater",
  "%zz",
  "../../etc/passwd",
  "..%2f..%2fetc%2fpasswd",
  "<script>alert(1)</script>",
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "\u0000",
  "a".repeat(500),
  "-1",
  "0",
  "1e999",
  "NaN",
  "Infinity",
  "null",
  "undefined",
  "[object Object]",
  "水",
  "🙂",
];

const POSITIONS: { name: string; call: (bad: string) => Promise<Response> }[] = [
  {
    // No params of its own; the authorization header is the only input it reads.
    name: "/api/cron/warm authorization",
    call: async (b) => {
      let r: Request;
      try {
        r = new Request("http://test/api/cron/warm", { headers: { authorization: b } });
      } catch {
        // A header value the HTTP layer would never deliver cannot reach the route.
        return new Response(null, { status: 400 });
      }
      return warmGET(r);
    },
  },
  {
    name: "/api/word/[word]",
    call: (b) => wordGET(req("/api/word/x"), { params: promise({ word: b }) }),
  },
  {
    name: "/api/word ?source",
    call: (b) => wordGET(req(`/api/word/x?source=${q(b)}`), { params: promise({ word: REAL }) }),
  },
  {
    name: "/api/suggest ?q",
    call: (b) => suggestGET(req(`/api/suggest?q=${q(b)}`)),
  },
  {
    name: "/api/suggest ?limit",
    call: (b) => suggestGET(req(`/api/suggest?q=th&limit=${q(b)}`)),
  },
  {
    name: "/api/suggest ?source",
    call: (b) => suggestGET(req(`/api/suggest?q=th&source=${q(b)}`)),
  },
  {
    name: "/api/bands/[view]",
    call: (b) => bandsGET(req("/api/bands/x"), { params: promise({ view: b }) }),
  },
  {
    name: "/api/bands ?source",
    call: (b) =>
      bandsGET(req(`/api/bands/x?source=${q(b)}`), { params: promise({ view: "cefr" }) }),
  },
  {
    name: "/api/band/[view]",
    call: (b) => bandGET(req("/api/band/x/x"), { params: promise({ view: b, key: "A1" }) }),
  },
  {
    name: "/api/band/[key]",
    call: (b) => bandGET(req("/api/band/x/x"), { params: promise({ view: "cefr", key: b }) }),
  },
  {
    name: "/api/band ?source",
    call: (b) =>
      bandGET(req(`/api/band/x/x?source=${q(b)}`), { params: promise({ view: "cefr", key: "A1" }) }),
  },
  {
    name: "/api/translate/[word]",
    call: (b) =>
      translateGET(req("/api/translate/x?source=en&target=es"), { params: promise({ word: b }) }),
  },
  {
    name: "/api/translate ?source",
    call: (b) =>
      translateGET(req(`/api/translate/x?source=${q(b)}&target=es`), {
        params: promise({ word: "water" }),
      }),
  },
  {
    name: "/api/translate ?target",
    call: (b) =>
      translateGET(req(`/api/translate/x?source=en&target=${q(b)}`), {
        params: promise({ word: "water" }),
      }),
  },
  {
    name: "/api/translate ?dict",
    call: (b) =>
      translateGET(req(`/api/translate/x?source=en&target=es&dict=${q(b)}`), {
        params: promise({ word: "water" }),
      }),
  },
  {
    name: "/api/wiktionary/[word]",
    call: (b) =>
      wiktionaryGET(req("/api/wiktionary/x?source=es&target=de"), { params: promise({ word: b }) }),
  },
  {
    name: "/api/wiktionary ?source",
    call: (b) =>
      wiktionaryGET(req(`/api/wiktionary/x?source=${q(b)}&target=de`), {
        params: promise({ word: "agua" }),
      }),
  },
  {
    name: "/api/wiktionary ?target",
    call: (b) =>
      wiktionaryGET(req(`/api/wiktionary/x?source=es&target=${q(b)}`), {
        params: promise({ word: "agua" }),
      }),
  },
];

// @spec ROUTE-10
describe("no caller-controlled value produces a 5xx", () => {
  // Translate is the one route that calls out. Stub it so the sweep never leaves the process.
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([[["x", "x"]]]))));
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const { name, call } of POSITIONS) {
    it(name, async () => {
      for (const bad of HOSTILE) {
        const res = await call(bad);
        expect(res.status, `${name} given ${JSON.stringify(bad)}`).toBeLessThan(500);
      }
    });
  }
});
