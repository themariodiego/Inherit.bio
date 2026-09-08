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
  return <div>
    <p role="alert" className="text-danger">{code === "build_unknown"
      ? "We could not identify the reference genome used in this file. Ask its provider for a VCF or raw DNA file that states GRCh37 or GRCh38."
      : reports
        ? "Your file was prepared, but we could not confirm that your selected reports are ready. You can retry reports without uploading the file again."
        : "We could not confirm whether file preparation finished. You can retry this step without uploading your file again."}</p>
    {code !== "build_unknown" && onRetry ? <Button className="mt-3" disabled={disabled}
      onClick={onRetry}>{reports ? "Retry selected reports" : "Retry preparation"}</Button> : null}
    {reports ? <p className="mt-2">
      <Link href={reportsHref} className="underline underline-offset-2">Review your reports</Link>
      {fileHref ? <> · <Link href={fileHref} className="underline underline-offset-2">View your file</Link></> : null}
    </p> : null}
  </div>;
}
