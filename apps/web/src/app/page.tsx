import { headers } from "next/headers";
import FeedbackLink from "@/components/FeedbackLink";
import ThemeToggle from "@/components/ThemeToggle";
import Workspace from "@/components/WorkspaceLazy";
import { pageTitle } from "@/lib/scenario";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// A shared deeplink names its word in the tab and in link previews, before any client
// JS runs. `Workspace` recases it to the corpus's spelling once the lookup lands.
//
// `openGraph` and `twitter` are restated rather than inherited: Next merges metadata
// shallowly, so a child that names either one replaces the layout's whole object. Left
// to `title` alone the preview would keep saying "word-bands" while the tab said the word.
// @spec URL-7
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ word?: string | string[] }>;
}) {
  const { word } = await searchParams;
  const title = pageTitle(Array.isArray(word) ? word[0] : word);
  return {
    title,
    openGraph: {
      type: "website" as const,
      siteName: SITE_NAME,
      title,
      description: SITE_DESCRIPTION,
      url: "/",
      locale: "en",
    },
    twitter: { card: "summary" as const, title, description: SITE_DESCRIPTION },
  };
}

// Same gutter for the footer as for the content it sits under. The footer is outside
// <main> so it lands in its own contentinfo landmark rather than inside the content.
//
// 1,760px because every laptop is wider than the 1,400 this used to be — 1,470 on a 13"
// Air, 1,512 on a 14", 1,536 on a 1920 Windows panel at 125%, 1,728 on a 16" — and the cap
// was protecting nothing. Line length is held where it belongs, on the prose itself: the
// strapline at 60ch and the credits at 80ch. What the cap actually squeezed was the two
// things that want width, the chip cloud and the defining figure.
const GUTTER = "tw-mx-auto tw-max-w-[1760px] tw-px-3 min-[700px]:tw-px-6 min-[900px]:tw-px-10";

export default async function Home() {
  // Vercel resolves the client IP to a country, which seeds the source language for a
  // first-time visitor. Absent everywhere else, which falls back to English. The root
  // layout already reads cookies, so this route is dynamic either way.
  const country = (await headers()).get("x-vercel-ip-country");
  // On a phone the gutter is room taken off the content, so it stays narrow until there
  // is some to spare — vertically as well, where the top padding is blank screen above
  // the title. The cap itself is reasoned about above.
  return (
    <>
      <main
        className={`Home ${GUTTER} tw-pb-8 tw-pt-5 min-[700px]:tw-pb-16 min-[700px]:tw-pt-10`}
        id="main"
        tabIndex={-1}
      >
        <header className="tw-mb-6">
          <div className="tw-mb-1 tw-flex tw-items-start tw-justify-between tw-gap-4">
            <h1 className="tw-heading-xx-large-strong">{SITE_NAME}</h1>
            <ThemeToggle />
          </div>
          {/* line-height 1.5 for blocks of text (WCAG 1.4.8); the Fondue type token
              sets a tighter value, so override it inline. */}
          <p className="tw-body-large tw-max-w-[60ch] text-muted-aaa" style={{ lineHeight: 1.5 }}>
            Which words to learn first.
          </p>
        </header>
        <Workspace country={country} />
      </main>
      {/* The address is the link text, not hidden behind a word: a browser with no mail
          handler leaves a mailto doing nothing, and then it is still readable. A link
          inside a sentence, so the 44px target size does not apply (WCAG 2.5.8). */}
      <footer
        className={`${GUTTER} tw-pb-6 min-[700px]:tw-pb-12 tw-body-x-small text-muted-aaa`}
        style={{ lineHeight: 1.5 }}
      >
        A wrong word, a missing one, or an idea? Write to <FeedbackLink />.
      </footer>
    </>
  );
}
