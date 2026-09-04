/**
 * <EmbryoChip> — the identity of one embryo (design §1.2; brief lines 199,
 * 207, 689; X2.4). Server component.
 *
 * A 24px disc with the initial as text on the neutral ground, identical for
 * every embryo in colour, weight and size; the server-generated label
 * ("Embryo 3"), derived only from the ordinal; the kind chip "Embryo"; and,
 * on the compare header only, the quality chip when the check was not
 * passed. No subject colour, no laboratory label, no rank, no ordinal
 * badge: nothing here can encode a verdict.
 */
import Link from "next/link";
import { EMBRYO_KIND_CHIP } from "@/copy/embryos/index";
import { QC_FAILED_CHIP } from "@/copy/embryos/qc";
import { subjectInitial } from "@/lib/subject-colour";
import { cn } from "@/lib/utils";

export interface EmbryoChipProps {
  embryo: { id: string; displayLabel: string };
  /** When set, the label is a link to the embryo's page. */
  href?: string;
  /** Renders the "Quality check not passed" chip (compare header only). */
  qcFailed?: boolean;
  className?: string;
}

/** The disc every embryo shares: the inset ground with the standard line, in the ink colour. */
export const EMBRYO_DISC_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-tint text-sm font-semibold leading-none text-ink";

export function EmbryoChip({ embryo, href, qcFailed, className }: EmbryoChipProps) {
  const label = href ? (
    <Link
      href={href}
      data-slot="embryo-label"
      className="font-medium text-ink underline-offset-4 hover:underline"
    >
      {embryo.displayLabel}
    </Link>
  ) : (
    <span data-slot="embryo-label" className="font-medium text-ink">
      {embryo.displayLabel}
    </span>
  );
  return (
    <span
      data-slot="embryo-chip"
      data-embryo-id={embryo.id}
      className={cn("inline-flex min-w-0 flex-wrap items-center gap-2 text-sm", className)}
    >
      <span aria-hidden="true" data-slot="embryo-disc" className={EMBRYO_DISC_CLASS}>
        {subjectInitial(embryo.displayLabel)}
      </span>
      {label}
      <span
        data-slot="subject-kind"
        className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm text-ink-muted"
      >
        {EMBRYO_KIND_CHIP}
      </span>
      {qcFailed ? (
        <span
          data-slot="qc-chip"
          className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm text-ink"
        >
          {QC_FAILED_CHIP}
        </span>
      ) : null}
    </span>
  );
}
