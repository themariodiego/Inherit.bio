"use client";

import { useRouter } from "next/navigation";
import { ANALYSIS_PERMISSION_BUTTON, ANALYSIS_PERMISSION_HEADING, ANALYSIS_PERMISSION_LEDE } from "@/copy/embryos/upload";
import type { SignableArtifact } from "@/lib/embryos/upload-stage";
import { ArtifactSigningForm } from "./upload/signing-form";

export function CohortPermission({ cohortId, artifact }: { cohortId: string; artifact: SignableArtifact }) {
  const router = useRouter();
  return <section data-slot="cohort-permission" className="space-y-4">
    <h2 className="text-lg font-semibold text-ink">{ANALYSIS_PERMISSION_HEADING}</h2>
    <p className="max-w-prose text-base leading-relaxed text-ink">{ANALYSIS_PERMISSION_LEDE}</p>
    <ArtifactSigningForm cohortId={cohortId} artifacts={[artifact]} submitLabel={ANALYSIS_PERMISSION_BUTTON} onSigned={() => router.refresh()} />
  </section>;
}
