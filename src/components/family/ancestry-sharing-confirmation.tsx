"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { submitFamilyPermission } from "@/lib/family/permission-response";
import type { GrantPurposeRequest } from "@/lib/family/grant-token";
import { SHARING_ERROR_STATUS } from "@/copy/family/permissions";

/** Fresh affirmative consent; the ordinary Turn off control remains available. */
export function AncestrySharingConfirmation({ personName, request }: { personName: string; request: GrantPurposeRequest }) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  return <section aria-labelledby="ancestry-confirm-heading" className="space-y-3 rounded-xl border border-line p-4">
    <h2 id="ancestry-confirm-heading" className="font-semibold">Confirm ancestry sharing</h2>
    <p className="max-w-prose text-sm leading-relaxed">Your earlier choice can share older ancestry results with {personName}.
      Confirm it again to share newer saved ancestry results with the same person. You can still turn sharing off below.</p>
    {failed ? <p role="alert" className="text-sm text-danger">{SHARING_ERROR_STATUS}</p> : null}
    <Button type="button" disabled={pending} onClick={async () => {
      setPending(true); setFailed(false);
      try {
        if (await submitFamilyPermission({ kind: "grant", request })) router.refresh(); else setFailed(true);
      } catch { setFailed(true); } finally { setPending(false); }
    }}>{pending ? "Saving…" : "Confirm ancestry sharing"}</Button>
  </section>;
}
