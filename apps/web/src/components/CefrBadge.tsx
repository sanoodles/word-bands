"use client";

import { Tooltip } from "@frontify/fondue/components";
import type { WordLevel } from "@/lib/types";

// Deliberately quiet: a translation can carry six of these, and they annotate the terms
// rather than compete with them. Spacing is a margin, not a space character, and the band
// itself is unselectable, so a copied line is the translation and nothing else
// ("water, aqua") rather than "waterA1, aquaB2".
// 24px around a 15x14 badge, with the horizontal half given back as margin: vertical
// padding on an inline box overflows the line without moving anything.
const PADDED = "tw-px-[5px] tw-py-[5px] -tw-mx-[5px]";

const BADGE =
  "tw-ml-1 tw-cursor-help tw-select-none tw-align-baseline tw-tabular-nums tw-body-x-small text-muted-aaa";

/**
 * A word's CEFR level, with the band name and rank a hover or focus away. Focusable so
 * that detail is reachable by keyboard too, following the `Abbr` pattern in Workspace.
 *
 * `role="img"` carries the whole thing as the badge's name — a bare "A1" says nothing read
 * aloud, and the alternative, hidden text, would ride along into anything copied out of the
 * translation. The name is the only channel that survives browse mode, where nothing is
 * focused and no tooltip is open, so it holds the detail rather than the tooltip.
 *
 * `describedBy` names the word this level belongs to. Reading the line, the two arrive
 * next to each other and it is not needed; tabbing lands on the badge alone, where the
 * level would otherwise have no subject. A description is the right channel for exactly
 * that reason — it is announced on focus, and not while reading the line.
 */
export default function CefrBadge({
  level,
  describedBy,
  padded = false,
}: {
  level: WordLevel;
  /** Id of the element holding the word this level is for. */
  describedBy?: string;
  /**
   * Pad the hit area out to 24px (WCAG 2.5.8). For a badge standing on its own; one
   * inside a sentence takes the inline exception, and the padding would space the words
   * around it. The horizontal half is cancelled by margin, so the run keeps its width.
   */
  padded?: boolean;
}) {
  const detail = `${level.label} · rank ${level.rank.toLocaleString()}`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          // Focusable on purpose, so the tooltip is reachable without a mouse.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="img"
          aria-label={detail}
          // The name is English prose, and a translation's terms sit in a lang span.
          lang="en"
          // Never Radix's: the name already says what its tooltip says. A child prop wins
          // Slot's merge, so this stands whether it points at the word or at nothing.
          aria-describedby={describedBy ?? ""}
          className={padded ? `${BADGE} ${PADDED}` : BADGE}
        >
          {level.key}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{detail}</Tooltip.Content>
    </Tooltip.Root>
  );
}
