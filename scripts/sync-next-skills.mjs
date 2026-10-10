#!/usr/bin/env node
// Syncs the vendored Next.js skills under .claude/skills/ with vercel/next.js@canary.
//
// Which skills are vendored is read off the disk, not listed here: any directory in
// .claude/skills/ that also exists upstream is synced. Vendoring a new one is a `cp`,
// and un-vendoring one is an `rm`, with no edit to this file either way.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readdir, readFile, writeFile, mkdir, rm, rmdir } from "node:fs/promises";

const REPO = "vercel/next.js";
const REF = "canary";
const UPSTREAM_DIR = "skills";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, ".claude", "skills");

const check = process.argv.includes("--check");

const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "wordbands-skills-sync",
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

// A weekly cron must not fail on a transient upstream 5xx. The two statuses worth
// failing fast on are a 4xx, which will not fix itself, and a rate limit, where backoff
// cannot clear a budget that refills hourly and retrying spends the next window too.
async function fetchRetry(url, init, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      last = err;
      res = null;
    }

    if (res?.ok) return res;

    if (res) {
      if (res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
        throw new Error(
          `GitHub API rate limit reached; it resets in ${mins} min. ` +
            `Unauthenticated requests are capped at 60/hour per IP — set GITHUB_TOKEN to raise it.`,
        );
      }
      last = new Error(`${url} -> ${res.status} ${res.statusText}`);
      if (res.status < 500) throw last;
    }

    if (attempt < tries) await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
  }
  throw last;
}

async function upstreamTree() {
  const url = `https://api.github.com/repos/${REPO}/git/trees/${REF}:${UPSTREAM_DIR}?recursive=1`;
  const res = await fetchRetry(url, { headers });
  const { tree, truncated } = await res.json();
  if (truncated) throw new Error("upstream tree came back truncated");
  return tree;
}

async function upstreamFile(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${UPSTREAM_DIR}/${path}`;
  const res = await fetchRetry(url, { headers: { "user-agent": headers["user-agent"] } });
  return res.text();
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

// Leaving empty directories behind would make the next run's deletion list lie.
async function pruneEmpty(dir, stopAt) {
  for (let at = dir; at !== stopAt; at = dirname(at)) {
    try {
      await rmdir(at);
    } catch {
      return;
    }
  }
}

// An expected failure — a rate limit, upstream down — is a message, not a stack trace.
// Both hooks: a rejected top-level await reaches one or the other depending on how Node
// is configured to treat unhandled rejections.
const die = (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
};
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

const tree = await upstreamTree();
const upstreamSkills = tree
  .filter((e) => e.type === "tree" && !e.path.includes("/") && !e.path.startsWith("."))
  .map((e) => e.path);

const localSkills = (await readdir(SKILLS, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const vendored = localSkills.filter((name) => upstreamSkills.includes(name));
const unvendored = upstreamSkills.filter((name) => !localSkills.includes(name));

if (vendored.length === 0) throw new Error(`no vendored upstream skills found in ${SKILLS}`);

const changes = [];

for (const skill of vendored) {
  const dir = join(SKILLS, skill);
  const want = tree.filter((e) => e.type === "blob" && e.path.startsWith(`${skill}/`)).map((e) => e.path);
  const have = await walk(dir);

  for (const path of want) {
    const rel = path.slice(skill.length + 1);
    const dest = join(dir, rel);
    const next = await upstreamFile(path);
    const current = have.includes(rel) ? await readFile(dest, "utf8") : null;
    if (current === next) continue;
    changes.push({ skill, rel, kind: current === null ? "added" : "changed" });
    if (check) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, next);
  }

  for (const rel of have) {
    if (want.includes(`${skill}/${rel}`)) continue;
    changes.push({ skill, rel, kind: "deleted" });
    if (check) continue;
    const dest = join(dir, rel);
    await rm(dest);
    await pruneEmpty(dirname(dest), dir);
  }
}

console.log(`vendored from ${REPO}@${REF}/${UPSTREAM_DIR}: ${vendored.join(", ")}`);

if (changes.length === 0) {
  console.log("up to date");
} else {
  if (check) console.log("drift found; nothing written");
  for (const { skill, rel, kind } of changes) console.log(`  ${kind.padEnd(7)} ${skill}/${rel}`);
}

if (unvendored.length > 0) console.log(`not vendored: ${unvendored.join(", ")}`);

if (check && changes.length > 0) process.exit(1);
