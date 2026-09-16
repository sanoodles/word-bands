#!/usr/bin/env node
// Renders the deployed page as what a screen reader would say, and diffs that against a
// committed transcript.
//
// The other two checks each read one thing at a time. The linter reads one element, so it
// cannot see a name computed from two of them. The suite reads one component in jsdom, so
// it cannot see the assembled page, real CSS, or Fondue's own markup. Both also only catch
// what someone thought to assert — and the two real problems found here were both things
// nobody had thought of: a name said four times over, and six tab stops announcing a CEFR
// level with no word attached.
//
// So this asserts nothing. It writes the page down in a form a person reads in ten
// seconds, and fails when that changes. A change is usually intended: re-run with --update
// and let the diff be the thing reviewed.
//
//   node scripts/check-a11y-transcript.mjs [url] [--update]
//
// Needs a Chromium-family browser on PATH; set CHROME to name one.

import { readFileSync, writeFileSync, writeSync, mkdtempSync, rmSync, accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "a11y-transcript.txt");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const TARGET = args.find((a) => !a.startsWith("--")) ?? process.env.EIGENLEX_URL ?? "https://word-bands.vercel.app";

// One fixed scenario, so the transcript is of the page and not of the day. German for the
// mid-sentence capitalization, `view=cefr` because that is the default and the band tabs
// are the widget with the most to get wrong.
const SCENARIO = "/?source=de&word=Wasser&target=en&view=cefr";
// A form the merge folded away, so the page answers for its base word and has to say so.
// "jede" reaches "jeder" through the chase past a lemma the build dropped (FILTER-8),
// which is the part of the redirect most likely to break without anything else noticing.
const FORM_SCENARIO = "/?source=de&word=jede&target=en&view=cefr";

// The translation is Google's, and Google can reword it any afternoon. Stubbed, so the
// transcript is our markup rather than today's dictionary — which is the subject anyway.
const GLOSS = {
  translation: "water",
  senses: ["water", "aqua"],
  groups: [{ pos: "noun", terms: ["water", "aqua"] }],
  levels: {
    water: { key: "A1", label: "A1 · Beginner", rank: 391 },
    aqua: { key: "C1", label: "C1 · Advanced", rank: 18422 },
  },
};

const BROWSERS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"];

// Resolved before spawning, because spawn reports a missing binary through an async error
// event — by then a pid exists and the process looks launched.
function onPath(bin) {
  const paths = bin.includes("/") ? [bin] : (process.env.PATH ?? "").split(":").map((d) => join(d, bin));
  for (const p of paths) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function launch() {
  const profile = mkdtempSync(join(tmpdir(), "a11y-transcript-"));
  const flags = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--window-size=1440,1200",
    // The page formats ranks and counts with toLocaleString(), which follows the browser's
    // locale. Unpinned, the same page reads "rank 18,422" on one machine and "18 422" on
    // another, and the transcript would be of the runner rather than of the app.
    "--lang=en-US",
    // CI runners have no display and no reason to keep the sandbox for a throwaway
    // browser that opens one page of ours. Left on everywhere else.
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "about:blank",
  ];
  const candidates = process.env.CHROME ? [process.env.CHROME] : BROWSERS;
  const bin = candidates.map(onPath).find(Boolean);
  if (!bin) {
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`no browser on PATH; tried ${candidates.join(", ")}. Set CHROME to name one.`);
  }
  const child = spawn(bin, flags, {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "UTC" },
  });
  child.on("error", () => {}); // surfaced by the exit handler below instead
  const log = [];
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, profile, log };
}

// Chrome prints the endpoint it chose to stderr, which is the only way to learn it with
// --remote-debugging-port=0. A fixed port would collide with whatever else is debugging on
// this machine — and this runs locally as often as it runs in CI.
//
// The endpoint is the browser itself, which carries no Page domain. The tab is reached
// through Target, over this same socket, rather than through the HTTP list on the port:
// that list is guarded against DNS rebinding and its rules have moved between versions,
// and a check that cannot open a tab on someone else's runner is not a check.
function browserEndpoint({ child, log }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser reported no debugging endpoint in 20s\n${log.join("").slice(0, 600)}`)), 20_000);
    child.stderr.on("data", () => {
      const m = /ws:\/\/[^\s]+/.exec(log.join(""));
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`browser exited (${code})\n${log.join("").slice(0, 600)}`)); });
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const raw = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify(sessionId ? { id: n, method, params, sessionId } : { id: n, method, params }));
    });
  return { ws, raw, on: (l) => listeners.push(l), open: new Promise((r) => (ws.onopen = r)) };
}

// A flattened session, so the page's commands and its events ride the one socket the
// browser already gave us.
async function attachToPage(cdp) {
  const { targetId } = await cdp.raw("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.raw("Target.attachToTarget", { targetId, flatten: true });
  return {
    send: (method, params) => cdp.raw(method, params, sessionId),
    on: (l) => cdp.on((msg) => msg.sessionId === sessionId && l(msg)),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function transcribe(send, on) {
  const js = async (expression, opts = {}) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...opts });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result;
  };
  const val = async (e) => (await js(e)).value;
  const key = async (k, code, vk) => {
    for (const type of ["rawKeyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(250);
  };
  // Settle waits key on the page, never on a number of seconds, so a slow cold start reads
  // the same as a warm one instead of transcribing a half-built page — or, worse, a control
  // one keystroke ahead of the panel it just changed.
  const until = async (expr, what, saw = "null") => {
    for (let i = 0; i < 75; i++) {
      if (await val(expr)) return;
      await sleep(400);
    }
    // What it was looking at matters more than the fact that it gave up: a timeout here is
    // either the page being slow or the page having changed, and those want opposite fixes.
    throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(await val(saw))}`);
  };

  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/translate/*" }] });
  on(async (msg) => {
    if (msg.method !== "Fetch.requestPaused") return;
    await send("Fetch.fulfillRequest", {
      requestId: msg.params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(GLOSS)).toString("base64"),
    });
  });
  await send("Page.enable");
  await send("Accessibility.enable");

  // Each section that presses a key starts from a freshly loaded page. Arrowing the cloud
  // queues a lookup that lands 300ms later and opens that word's band — which, left alone,
  // arrives in the middle of the next section and reverts the tab it just moved.
  const reset = async () => {
    await send("Page.navigate", { url: TARGET + SCENARIO });
    await until(
      `!!document.querySelector("[role=option]")`,
      "the word cloud",
      `document.querySelector(".BandBrowser")?.innerText?.slice(0, 80) ?? null`,
    );
    await until(
      `!!document.querySelector("[aria-live] [role=img]")`,
      "the translation",
      `document.querySelector("[aria-live]")?.innerText ?? null`,
    );
  };
  await reset();

  // The page is responsive, and below 700px the band tabs are a dropdown instead. A window
  // that came up the wrong size would otherwise transcribe as a pile of unexplained
  // differences rather than as the environment being wrong.
  for (const [sel, what] of [
    ["[role=tablist] [role=tab]", "the desktop band tabs"],
    ["form[role=search] [role=img]", "the badge in the search field"],
  ]) {
    if (!(await val(`!!document.querySelector(${JSON.stringify(sel)})`)))
      throw new Error(`${what} did not render — is the window 1440 wide and the font loaded?`);
  }

  const V = (a) => (a ? a.value : undefined);
  const out = [];
  const say = (s = "") => out.push(s);
  const rule = (t) => { say(); say(t); say("-".repeat(72)); };

  // Names and descriptions come from Chrome, because they are computed and half of this
  // page's markup is Fondue's — there is no reading them off the source.
  //
  // Roles and states do not. Both are authored, and Chrome has renamed roles between
  // versions ("img" became "image"), which would make this a transcript of whichever
  // Chrome the runner shipped that week rather than of the page.
  const speak = async () => {
    // Focus resting on <body> is the page having none — where a tab walk ends up once it
    // has passed the last control and been round the browser's own chrome.
    if (await val(`(() => { const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement; })()`)) return null;
    const { result } = await send("Runtime.evaluate", { expression: "document.activeElement" });
    if (!result.objectId) return null;
    const { nodes } = await send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const n = nodes?.[0];
    if (!n) return null;
    const role = await val(`(() => { const a = document.activeElement;
      return a.getAttribute("role")
        ?? ({ A: "link", BUTTON: "button", INPUT: "textbox", SELECT: "combobox", SUMMARY: "button" })[a.tagName]
        ?? a.tagName.toLowerCase(); })()`);
    const states = await val(`(() => { const a = document.activeElement, s = [], g = (k) => a.getAttribute(k);
      if (g("aria-selected") === "true") s.push("selected");
      if (g("aria-checked") === "true") s.push("checked");
      if (g("aria-pressed") === "true") s.push("pressed");
      if (g("aria-disabled") === "true") s.push("unavailable");
      if (g("aria-expanded")) s.push(g("aria-expanded") === "true" ? "expanded" : "collapsed");
      if (g("aria-posinset")) s.push(g("aria-posinset") + " of " + g("aria-setsize"));
      return s; })()`);
    const bits = [V(n.name) || "(unnamed)", role, ...states];
    if (V(n.description)) bits.push(`— ${V(n.description)}`);
    return bits.join(", ");
  };

  // Everything that reads the page as loaded goes first: arrowing the cloud looks a new
  // word up, which rewrites the title and the translation underneath.
  rule("THE DOCUMENT — before anything is touched");
  say(`  title        ${JSON.stringify(await val(`document.title`))}`);
  say(`  description  ${JSON.stringify(await val(`document.querySelector("meta[name=description]")?.content ?? null`))}`);
  say(`  lang         ${JSON.stringify(await val(`document.documentElement.lang`))}`);

  rule("THE OUTLINE — landmarks and headings, in the order they are met");
  const { nodes } = await send("Accessibility.getFullAXTree");
  // getFullAXTree hands back a flat array in no particular order, so the outline is walked
  // from the root. An outline out of order is worse than none: it reads as a page defect.
  const kids = new Map();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const LANDMARK = new Set(["main", "navigation", "search", "banner", "contentinfo", "complementary", "region", "form"]);
  const walk = (n, depth) => {
    let next = depth;
    if (!n.ignored) {
      const role = V(n.role);
      if (LANDMARK.has(role)) {
        say(`  ${"  ".repeat(depth)}${role}${V(n.name) ? ` "${V(n.name)}"` : " (unnamed)"}`);
        next = depth + 1;
      } else if (role === "heading") {
        const lvl = (n.properties ?? []).find((p) => p.name === "level")?.value.value;
        say(`  ${"  ".repeat(depth)}h${lvl} "${V(n.name)}"`);
      }
    }
    for (const c of kids.get(n.nodeId) ?? []) walk(c, next);
  };
  for (const root of nodes.filter((n) => !n.parentId)) walk(root, 0);

  rule("READING THE TRANSLATION, rather than tabbing to it");
  say(`  ${await val(`(() => { const l = document.querySelector("[aria-live] span[lang]"); if (!l) return "(none)";
    const walk = (n) => { let o = "";
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { o += c.textContent; continue; }
        if (c.getAttribute && c.getAttribute("aria-hidden") === "true") continue;
        const al = c.getAttribute && c.getAttribute("aria-label");
        o += al ? " (" + al + ")" : walk(c);
      } return o; };
    return walk(l).replace(/\s+/g, " ").trim(); })()`)}`);
  say(`  copied as    ${JSON.stringify(await val(`(() => { const l = document.querySelector("[aria-live] span[lang]");
    const s = getSelection(), r = document.createRange(); r.selectNodeContents(l); s.removeAllRanges(); s.addRange(r);
    const t = s.toString(); s.removeAllRanges(); return t; })()`))}`);

  // Tab moves focus and activates nothing, so this leaves the page as it found it.
  rule("TAB THROUGH THE PAGE");
  await val(`(document.activeElement?.blur(), true)`);
  for (let i = 0, stop = 0; i < 30; i++) {
    await key("Tab", "Tab", 9);
    // `next dev` serves its own dev-tools overlay as a focusable custom element that
    // production never has, so without this a local run differs from the deployed page by
    // one stop and the check is useless as a pre-push read. Skipped rather than stopped
    // on: the walk has to carry on past it, and the numbering has to not count it.
    if (await val(`!!document.activeElement?.closest("nextjs-portal")`)) continue;
    const line = await speak();
    // Past the last control, focus leaves for the browser's own chrome and comes back on
    // the body. Anything after that is the walk going round a second time.
    if (line === null) break;
    say(`  ${String(++stop).padStart(2)}. ${line}`);
  }

  rule("THE WORD CLOUD — a listbox of the band's words");
  await reset();
  await val(`(document.querySelector("[role=option][tabindex='0']").focus(), true)`);
  say(`  on entry     ${await speak()}`);
  for (const [k, c, v] of [["ArrowRight", "ArrowRight", 39], ["ArrowDown", "ArrowDown", 40]]) {
    await key(k, c, v);
    say(`  ${k.padEnd(12)} ${await speak()}`);
  }

  // A redirect adds exactly one sentence to the page, in a live region, and swaps the word
  // out from under the field — so those three readings are the whole scenario. Its own
  // navigation rather than reset()'s, because the deeplink is the scenario.
  rule("LOOKING UP AN INFLECTED FORM — the word answered for is not the one asked for");
  await send("Page.navigate", { url: TARGET + FORM_SCENARIO });
  await until(
    `(document.querySelector("[role=status]")?.textContent ?? "").length > 0`,
    "the redirect notice",
    `document.querySelector("[role=status]")?.textContent ?? null`,
  );
  say(`  asked for    jede`);
  say(`  announced    ${await val(`document.querySelector("[role=status]").textContent`)}`);
  say(`  the field    ${JSON.stringify(await val(`document.querySelector("form[role=search] input").value`))}`);
  say(`  the card     ${await val(`document.querySelector("[aria-label^='Meaning of']")?.getAttribute("aria-label") ?? null`)}`);

  // Last, because moving off A1 leaves a different band open behind it.
  rule("THE BAND TABS — one stop, arrows inside it");
  await reset();
  await val(`(document.querySelector("[role=tab][aria-selected=true]").focus(), true)`);
  say(`  on entry     ${await speak()}`);
  for (const [k, c, v] of [["ArrowRight", "ArrowRight", 39], ["End", "End", 35], ["Home", "Home", 36]]) {
    await key(k, c, v);
    // The tab takes focus in the key handler and its state a render later, so reading it
    // straight away catches it selected sometimes and not others.
    await until(
      `document.activeElement.getAttribute("aria-selected") === "true"`,
      "the tab to take the selection",
      `document.activeElement.getAttribute("aria-label")`,
    );
    const line = await speak();
    // The panel is fetched, so it lands after the tab moves. Waiting for it is the point:
    // a transcript of a tab already moved and a panel not yet is a transcript of nothing.
    const label = await val(`document.activeElement.getAttribute("aria-label").split(",")[0]`);
    await until(
      `document.querySelector("[role=tabpanel] [role=listbox]")?.getAttribute("aria-label").startsWith("Words in " + ${JSON.stringify(label)})`,
      "the panel to follow the tab",
      `document.querySelector("[role=tabpanel]")?.innerText?.slice(0, 60) ?? null`,
    );
    say(`  ${k.padEnd(12)} ${line}`);
    say(`  ${" ".repeat(12)}   cloud: ${await val(`document.querySelector("[role=tabpanel] [role=listbox]").getAttribute("aria-label")`)}`);
  }
  return out.join("\n").trimStart() + "\n";
}

// A line diff, so an inserted line shows as one insertion rather than shifting everything
// below it into noise. Longest common subsequence, small enough to write, with a couple of
// lines of context so a changed line can be placed by eye.
function diff(a, b, context = 2) {
  const m = a.length, n = b.length;
  const lcs = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const rows = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) rows.push({ mark: "  ", text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) rows.push({ mark: "- ", text: a[i++] });
    else rows.push({ mark: "+ ", text: b[j++] });
  }
  while (i < m) rows.push({ mark: "- ", text: a[i++] });
  while (j < n) rows.push({ mark: "+ ", text: b[j++] });

  // Unchanged runs longer than the context window collapse, so a one-line change in a
  // hundred-line transcript prints as a few lines and not as the whole file.
  const keep = rows.map((r, k) =>
    r.mark !== "  " || rows.some((o, l) => o.mark !== "  " && Math.abs(l - k) <= context));
  const out = [];
  let skipped = false;
  for (const [k, r] of rows.entries()) {
    if (keep[k]) {
      if (skipped) out.push("  …");
      skipped = false;
      out.push(r.mark + r.text);
    } else skipped = true;
  }
  return out;
}

// GitHub renders one of these as an annotation on the run itself, so a failure says what
// changed where it is read — the log is behind a click, and behind admin rights for anyone
// reading over the API.
function annotate(title, body) {
  if (!process.env.GITHUB_ACTIONS) return;
  const esc = (t) => t.replaceAll("%", "%25").replaceAll("\n", "%0A").replaceAll("\r", "%0D");
  // writeSync, not console.log: process.exit() below truncates a piped stdout mid-write,
  // and in Actions stdout is always a pipe. The first attempt at this lost every
  // annotation that way, which read as the command never having run.
  writeSync(1, `::error title=${esc(title)}::${esc(body.slice(0, 4000))}\n`);
}

let browser;
try {
  browser = launch();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let actual;
try {
  const cdp = connect(await browserEndpoint(browser));
  await cdp.open;
  const page = await attachToPage(cdp);
  actual = await transcribe(page.send, page.on);
  cdp.ws.close();
} catch (err) {
  // A check that could not check is not a pass.
  console.error(`could not transcribe ${TARGET}${SCENARIO}`);
  console.error(err.message);
  annotate("Could not transcribe the page", `${TARGET}${SCENARIO}\n\n${err.stack ?? err.message}`);
  process.exit(1);
} finally {
  // kill() only asks. Deleting the profile while the browser is still flushing into it
  // fails with ENOTEMPTY, which `force` does not cover — and a throw in here escapes
  // before the comparison, so the check dies of housekeeping with the transcript already
  // in hand. Wait for the exit, retry the delete, and never let either be the verdict.
  await new Promise((resolve) => {
    const done = setTimeout(resolve, 5_000);
    browser.child.once("exit", () => { clearTimeout(done); resolve(); });
    browser.child.kill();
  });
  try {
    rmSync(browser.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    /* a directory left in tmp is the OS's to reap, and no reason to fail a check */
  }
}

if (UPDATE) {
  writeFileSync(BASELINE, actual);
  console.log(`wrote ${BASELINE} from ${TARGET}`);
  console.log("Read the diff before committing it — that reading is the whole check.");
  process.exit(0);
}

let expected;
try {
  expected = readFileSync(BASELINE, "utf8");
} catch {
  console.error(`no transcript at ${BASELINE}. Create it with --update.`);
  process.exit(1);
}

if (expected === actual) {
  console.log(`the page still reads the same on ${TARGET}`);
  process.exit(0);
}

const lines = diff(expected.split("\n"), actual.split("\n"));
console.error(`the page reads differently on ${TARGET}:\n`);
for (const line of lines) console.error(line);
annotate("The page reads differently", `${TARGET}\n\n${lines.join("\n")}`);
console.error(`
- is scripts/a11y-transcript.txt, + is ${TARGET} now.
If the change is meant, re-run with --update and commit the diff.`);
process.exit(1);
