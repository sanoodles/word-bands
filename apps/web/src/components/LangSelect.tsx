"use client";

import { Select } from "@frontify/fondue/components";

/**
 * A language picker showing the ISO 639-1 code, so it costs a couple of characters of
 * width instead of "Português" and can sit on the row it governs rather than above it.
 * The endonym rides along in the markup either way: visible in the menu, and carried
 * into the trigger too, where globals.css hides it from sight but not from assistive
 * tech — which is what names the control's current value.
 */
export default function LangSelect<T extends string>({
  label,
  describedBy,
  value,
  options,
  onChange,
}: {
  /** Accessible name of the control. */
  label: string;
  /** Element saying what a pick does, read on focus — before the pick (WCAG 3.2.2). */
  describedBy?: string;
  value: T;
  options: { code: T; name: string }[];
  onChange: (code: T) => void;
}) {
  return (
    <Select
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      // Fondue types the callback as a bare string; it only ever hands back a value
      // one of the items above was mounted with.
      onSelect={(v) => v && onChange(v as T)}
      // The trigger renders the item's markup instead of its label string — which is
      // what lets the code show alone with the endonym still along for the ride.
      showStringValue={false}
    >
      {options.map(({ code, name }) => (
        // `label` still drives the type-to-find, so typing "esp" reaches Español.
        <Select.Item key={code} value={code} label={name}>
          <span className="lang-option">
            <span aria-hidden="true" className="lang-code text-muted-aaa">
              {code.toUpperCase()}
            </span>
            <span lang={code} className="lang-name">
              {name}
            </span>
          </span>
        </Select.Item>
      ))}
    </Select>
  );
}
