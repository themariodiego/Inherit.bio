"use client";

import * as React from "react";

import { glossaryEntry } from "@/copy/glossary";
import { cn } from "@/lib/utils";

/**
 * The gloss a technical term carries where it has to survive in the copy.
 *
 * The brief states the contract rather than leaving it to taste, and every
 * clause of it is load-bearing for somebody:
 *
 *   - line 884: "dotted underline, keyboard-focusable, expanding a `Disclosure`
 *     in place. **Never a hover-only tooltip.**"
 *   - line 708: `Disclosure` is "the single progressive-detail mechanism", so a
 *     gloss opens the same way a method note does, not in a bespoke popover.
 *
 * Hover-only is the one the brief forbids in bold, and it is forbidden here by
 * construction rather than by convention: this is a `<button>` with an
 * `onClick`, so there is no hover handler to forget to pair with a focus
 * handler. A reader on a phone has no hover at all, and a reader using a
 * keyboard or a screen reader cannot hover either — for them a hover-only
 * gloss is not a worse explanation, it is no explanation.
 *
 * It renders nothing but its children when the term is unknown, so a
 * mistyped term degrades to plain text rather than to an empty control that
 * announces itself and then says nothing.
 */
export function GlossaryTerm({
  term,
  children,
  className,
}: {
  /** The term or alias to look up; defaults to the rendered text. */
  term?: string;
  /** Defaults to `term`, so `<GlossaryTerm term="variant" />` renders the word. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const label = term ?? (typeof children === "string" ? children : "");
  const entry = glossaryEntry(label);
  const shown = children ?? term;

  if (!entry) return <>{shown}</>;

  return (
    <span data-slot="glossary-term" data-term={entry.term}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-definition`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(
          // Dotted underline, per the brief. `decoration-dotted` rather than a
          // border so the underline follows the text when the line wraps.
          "underline decoration-dotted underline-offset-4 cursor-help",
          "rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
      >
        {shown}
      </button>
      {/* In place, not floating: the definition pushes the text below it down,
          which is what makes it survive reflow and zoom. `hidden` rather than
          unmounting keeps the control's `aria-controls` target present for
          assistive technology that resolves it before the first open. */}
      <span
        id={`${id}-definition`}
        data-slot="glossary-definition"
        hidden={!open}
        className="mt-1 block max-w-prose text-sm text-ink-muted"
      >
        {entry.definition}
      </span>
    </span>
  );
}
