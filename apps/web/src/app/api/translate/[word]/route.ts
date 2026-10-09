import { levelsOf } from "@/lib/bands";
import { isSourceLang } from "@/lib/languages";
import {
  alignGroup,
  baseLang,
  flattenSenses,
  gtxUrl,
  isLangCode,
  isSingleWord,
  needsPivot,
  parseGtx,
  parseSenseGroups,
  pivotTerm,
  type SenseGroup,
} from "@/lib/translate";

// A word's translation is stable, and the rare tail is looked up too seldom to survive a
// short TTL. The warm pass owns the head's freshness, so this number is really the tail's.
export const revalidate = 15552000; // 180 days; a literal, since Next cannot evaluate arithmetic here

async function gtx(
  word: string,
  source: string,
  target: string,
  dict: boolean,
): Promise<unknown> {
  const res = await fetch(gtxUrl(word, source, target, dict), { next: { revalidate } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const { word } = await params;
  const q = new URL(req.url).searchParams;
  const source = baseLang(q.get("source"));
  const target = baseLang(q.get("target"));
  // Unlike the other routes, this one answers by calling Google rather than by reading our
  // own data, so it forwards only what the card asks it for: one word, between two language
  // codes. Anything else is refused here instead of being relayed upstream on our quota.
  // @spec GATE-1, GATE-3, GATE-4, GATE-5
  if (!isSingleWord(word)) return new Response("not a word", { status: 400 });
  if (!isSourceLang(source) || !isLangCode(target)) {
    return new Response("unknown language", { status: 400 });
  }
  // `dict` mode translates one casing of a case-homograph: casing is significant, so keep
  // it; otherwise lowercase for a stable, lowercase result and better cache hits.
  const dict = q.get("dict") === "1";
  // @spec GATE-7
  const text = dict ? word : word.toLowerCase();

  try {
    // The English hop is worth starting up front: a pair Google has no dictionary for
    // always ends up needing it, and this keeps the pivot to one extra round trip.
    const pivoting = dict && needsPivot(source, target);
    const [data, viaEn] = await Promise.all([
      gtx(text, source, target, dict),
      pivoting ? gtx(text, source, "en", true) : null,
    ]);

    let groups: SenseGroup[] = dict ? parseSenseGroups(data) : [];
    if (!groups.length && viaEn) {
      const pivot = pivotTerm(viaEn);
      if (pivot) {
        groups = alignGroup(parseSenseGroups(await gtx(pivot.term, "en", target, true)), pivot.pos);
      }
    }

    const translation = parseGtx(data);
    return Response.json({
      word: text,
      source,
      target,
      translation,
      senses: flattenSenses(groups),
      // Per-part-of-speech readings, so the card can show a word's distinct meanings.
      groups,
      // @spec BAND-9
      levels: levelsOf(target, [...groups.flatMap((g) => g.terms), translation]),
    });
  } catch {
    // @spec GATE-6
    return new Response("upstream error", { status: 502 });
  }
}
