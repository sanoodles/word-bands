/**
 * The hero's two facing panels — the word you ask for, and what it means. They share
 * a frame and lead their row with a language select, so the pair reads as one
 * control: source on the left, target on the right.
 */
export const PANEL =
  "tw-rounded-x-large tw-border tw-border-line-subtle tw-bg-surface tw-px-3 tw-py-4 " +
  "min-[700px]:tw-px-6 min-[700px]:tw-py-5";

/**
 * The language select each panel leads with. Narrow, because it shows only the ISO
 * code (see LangSelect), and one step below the word and translation it governs (20px)
 * rather than Fondue's 14px default, which reads as a stray control.
 */
export const PANEL_LANG =
  "tw-w-20 tw-shrink-0 [&_[role=combobox]]:tw-min-h-[44px] [&_[role=combobox]]:tw-text-large";

/**
 * The heading over a section, and over each of the two language selects, whose visible
 * name is otherwise only the ISO code they hold. Quiet, so a heading on every section
 * does not compete with the words themselves.
 */
export const SECTION_HEADING = "tw-mb-1.5 tw-body-small tw-font-medium text-muted-aaa";
