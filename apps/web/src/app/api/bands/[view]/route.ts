import { getBandSummary, isView } from "@/lib/bands";
import { DEFAULT_SOURCE, isSourceLang } from "@/lib/languages";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ view: string }> },
) {
  const { view } = await params;
  if (!isView(view)) return new Response("unknown view", { status: 404 });
  const source = new URL(req.url).searchParams.get("source") ?? DEFAULT_SOURCE;
  if (!isSourceLang(source)) return new Response("unknown language", { status: 404 });
  // An empty summary means this language does not offer the view — `defining` needs a
  // dictionary graph, which only some languages have. A 404 rather than an empty list, since
  // to a caller the view is as absent as a misspelt one.
  // @spec ROUTE-9
  const bands = getBandSummary(source, view);
  return bands.length ? Response.json(bands) : new Response("unknown view", { status: 404 });
}
