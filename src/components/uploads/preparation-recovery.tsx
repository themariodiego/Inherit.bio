"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BrowserPreparationError } from "@/lib/uploads/subject-upload-browser";

/** A failure acknowledges only the stage certified by the exact-file receipt. */
export function PreparationRecovery({ code, disabled, onRetry, reportsHref, fileHref }: {
  code: BrowserPreparationError["code"];
  disabled: boolean;
  onRetry?: () => void;
  reportsHref: string;
  fileHref?: string;
}) {
  const reports = code === "report_generation_unavailable";
  // The month's admission cap: a retry now would be refused the same way, so
  // no retry control is offered; the file stays listed and can be prepared
  // from the first of next month. The cap's number is never shown.
  const capacity = code === "preparation_capacity_reached";
  // A spent artifact budget: the same file would stop at the same point, so no
  // retry control is offered and the file stays listed, exactly as the cap
  // does. No size is quoted, because the limit that bit is a budget on prepared
  // bytes rather than a ceiling on the file, and the file was admitted under
  // every ceiling it was measured against — naming one would send someone to
  // shrink a file against a number that was never the problem.
  const tooLarge = code === "preparation_file_too_large";
  return <div>
    <p role="alert" className="text-danger">{code === "build_unknown"
      ? "We could not identify the reference genome used in this file. Ask its provider for a VCF or raw DNA file that states GRCh37 or GRCh38."
      : capacity
        ? "Inherit has reached this month's limit for full-genome files. Your file is kept; try again from the first of next month."
        : tooLarge
          ? "This file is larger than Inherit can prepare. It is kept in your private storage, and preparing it again would stop at the same point."
          : reports
            ? "Your file was prepared, but we could not confirm that your selected reports are ready. You can retry reports without uploading the file again."
            : "We could not confirm whether file preparation finished. You can retry this step without uploading your file again."}</p>
    {code !== "build_unknown" && !capacity && !tooLarge && onRetry ? <Button className="mt-3" disabled={disabled}
      onClick={onRetry}>{reports ? "Retry selected reports" : "Retry preparation"}</Button> : null}
    {reports ? <p className="mt-2">
      <Link href={reportsHref} className="underline underline-offset-2">Review your reports</Link>
      {fileHref ? <> · <Link href={fileHref} className="underline underline-offset-2">View your file</Link></> : null}
    </p> : null}
    {(capacity || tooLarge) && fileHref ? <p className="mt-2">
      <Link href={fileHref} className="underline underline-offset-2">View your file</Link>
    </p> : null}
  </div>;
}
