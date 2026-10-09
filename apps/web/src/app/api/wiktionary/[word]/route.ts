import { getWiktionary, levelsOf } from "@/lib/bands";
import { DEFAULT_SOURCE, isSourceLang } from "@/lib/languages";

export const dynamic = "force-dynamic";

/**
 * Wiktionary's translations of a word, which the word card shows beside Google's. Read
 * from committed data, so it calls no one and answers whether Google does or not.
 * @spec WIKT-5
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  // @spec ROUTE-7
  const { word } = await params;
  const q = new URL(req.url).searchParams;
  const source = q.get("source") ?? DEFAULT_SOURCE;
  const target = q.get("target") ?? "";
  // @spec ROUTE-9
  if (!isSourceLang(source)) return new Response("unknown language", { status: 404 });
  // @spec ROUTE-8
  const found = await getWiktionary(source, target, word.toLowerCase());
  const terms = found?.terms ?? [];
  return Response.json({ terms, title: found?.title ?? null, levels: levelsOf(target, terms) });
}
