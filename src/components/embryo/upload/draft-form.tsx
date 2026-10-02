"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BACK_BUTTON, DRAFT_CONTACTS_STATUS, DRAFT_NOTE, DRAFT_QUESTION_HEADING, EMBRYO_COUNT_LABEL, SAVE_DRAFT_BUTTON, parentEmailLabel } from "@/copy/embryos/upload";
import { REQUEST_FAILED_STATUS } from "@/copy/embryos/signing";
import { EMBRYO_COUNT_MAXIMUM, requiredContactCount, type Basis, type UploadSituation } from "@/lib/embryos/basis";
import { UPLOAD_CSRF_HEADER } from "@/lib/embryos/upload-transport";
import { route } from "@/lib/primary-routes";

/** No laboratory name, original sample label or file leaves this form. */
export function DraftForm({ headingId, situation, basis, csrfToken, onBack }: {
  headingId: string; situation: UploadSituation; basis: Basis; csrfToken: string; onBack: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const submitting = useRef(false);
  const [status, setStatus] = useState<"ready" | "pending" | "failed" | "contacts">("ready");
  const count = requiredContactCount(situation, basis);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const values = new FormData(event.currentTarget);
    const contacts = Array.from({ length: count }, (_, index) => String(values.get(`contact-${index}`) ?? "").trim());
    const common = { uploadSituation: situation, basis, donorAttributionIntent: "none", embryoCount: Number(values.get("embryoCount")) };
    const body = situation === "own-embryos" ? { ...common, otherRequiredPrincipalContacts: contacts }
      : { ...common, requiredGeneticPrincipalContacts: contacts };
    submitting.current = true;
    setStatus("pending");
    try {
      const response = await fetch(route("api.embryo-cohort-drafts", {}), {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", [UPLOAD_CSRF_HEADER]: csrfToken }, body: JSON.stringify(body),
      });
      if (response.status !== 201) {
        const refusal: unknown = await response.json().catch(() => null);
        setStatus(refusal && typeof refusal === "object" && "issues" in refusal && Array.isArray(refusal.issues)
          && refusal.issues.includes("contacts") ? "contacts" : "failed");
        return;
      }
      router.refresh();
    } catch { setStatus("failed"); }
    finally { submitting.current = false; }
  }
  return (
    <form onSubmit={submit} data-slot="draft-form" className="space-y-4">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink">{DRAFT_QUESTION_HEADING}</h2>
      <p className="max-w-prose text-base leading-relaxed text-ink">{DRAFT_NOTE}</p>
      <fieldset disabled={status === "pending"} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={`${id}-count`} className="block text-base font-medium text-ink">{EMBRYO_COUNT_LABEL}</label>
          <Input id={`${id}-count`} name="embryoCount" type="number" inputMode="numeric" min={2} max={EMBRYO_COUNT_MAXIMUM} required className="max-w-xs" />
        </div>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="space-y-2">
            <label htmlFor={`${id}-${index}`} className="block text-base font-medium text-ink">{parentEmailLabel(index, count)}</label>
            <Input id={`${id}-${index}`} name={`contact-${index}`} type="email" autoComplete="off" required maxLength={254} className="max-w-md" />
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="lg" onClick={onBack}>{BACK_BUTTON}</Button>
          <Button type="submit" size="lg">{SAVE_DRAFT_BUTTON}</Button>
        </div>
      </fieldset>
      {status === "failed" || status === "contacts" ? <p role="alert" className="max-w-prose text-sm text-ink">{status === "contacts" ? DRAFT_CONTACTS_STATUS : REQUEST_FAILED_STATUS}</p> : null}
    </form>
  );
}
