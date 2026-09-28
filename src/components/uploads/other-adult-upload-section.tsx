import { OTHER_ADULT_UPLOAD_COPY as COPY } from "@/copy/upload/other-adult";
import { listOtherAdultTargets, prepareOtherAdultUploads } from "@/lib/uploads/other-adult-upload-server";
import { readOwnUploadLimits } from "@/lib/uploads/own-upload-limits";
import { OtherAdultUploadCard } from "./other-adult-upload-card";

/**
 * The signed-in person's own pending adult invitations, each with the one
 * thing they can do for it. Renders nothing outside TEST-LOCAL, nothing for
 * an account whose jurisdiction does not permit third-party adult analysis,
 * and nothing for an account with no pending invitation.
 */
export async function OtherAdultUploadSection() {
  const targets = await prepareOtherAdultUploads().catch(() => null);
  if (!targets || targets.length === 0) return null;
  const limits = await readOwnUploadLimits().catch(() => null);
  return (
    <section aria-labelledby="other-adult-upload-heading" data-slot="other-adult-upload" className="space-y-4">
      <h2 id="other-adult-upload-heading" className="display text-2xl">{COPY.heading}</h2>
      <p className="text-sm leading-relaxed text-ink-muted">{COPY.detail}</p>
      <p role="note" className="text-sm">{COPY.draftNote}</p>
      {targets.map(target => (
        <OtherAdultUploadCard key={target.consent?.token ?? `${target.subjectId}:${target.state}`} target={target} limits={limits} />
      ))}
    </section>
  );
}

/**
 * The files list's one line per held file (brief §2.6: invisible in every
 * list except one row). Read-only: it presents no permission and no upload.
 */
export async function OtherAdultHeldRows() {
  const targets = await listOtherAdultTargets().catch(() => null);
  const held = (targets ?? []).filter(target => target.state === "held");
  if (held.length === 0) return null;
  return (
    <ul className="space-y-3" data-slot="other-adult-held-rows">
      {held.map(target => (
        <li key={target.subjectId} className="rounded-xl border border-line bg-card p-4">
          <p role="status" className="text-sm">{COPY.heldStatus(target.label)}</p>
        </li>
      ))}
    </ul>
  );
}
