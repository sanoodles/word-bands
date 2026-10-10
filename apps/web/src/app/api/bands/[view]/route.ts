import { getBandSummary, isView } from "@/lib/bands";
import { DEFAULT_SOURCE, isSourceLang } from "@/lib/languages";

export const dynamic = "force-dynamic";

// @spec ROUTE-9
export async function GET(
  req: Request,
  { params }: { params: Promise<{ view: string }> },
) {
  const { view } = await params;
  if (!isView(view)) return new Response("unknown view", { status: 404 });
  const source = new URL(req.url).searchParams.get("source") ?? DEFAULT_SOURCE;
  if (!isSourceLang(source)) return new Response("unknown language", { status: 404 });
  return Response.json(getBandSummary(source, view));
}
