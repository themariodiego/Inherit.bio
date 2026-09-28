import { OTHER_ADULT_UPLOAD_COPY as COPY } from "@/copy/upload/other-adult";
import { listOtherAdultTargets, prepareOtherAdultUploads } from "@/lib/uploads/other-adult-upload-server";
import { readOwnUploadLimits } from "@/lib/uploads/own-upload-limits";
import { day, latestFileLine } from "./other-adult-lines";
import { OtherAdultNewPersonForm, OtherAdultUploadCard } from "./other-adult-upload-card";

/**
 * The register's Path B on the upload page: "Upload with their written
 * permission". Renders nothing outside TEST-LOCAL and nothing for an account
 * whose jurisdiction does not permit third-party adult analysis. A Path A
 * invitation never appears here: its inviter never uploads.
 *
 * It is secondary to the person's own upload (brief §5.2: never at equal
 * prominence), so it stays closed until opened, and opens by itself once the
 * account has someone in it.
 */
export async function OtherAdultUploadSection() {
  const uploads = await prepareOtherAdultUploads().catch(() => null);
  if (!uploads) return null;
  const limits = await readOwnUploadLimits().catch(() => null);
  return (
    <section aria-labelledby="other-adult-upload-heading" data-slot="other-adult-upload">
      <details open={uploads.targets.length > 0} className="space-y-4">
        <summary className="min-h-11 cursor-pointer">
          <h2 id="other-adult-upload-heading" className="display inline text-2xl">{COPY.heading}</h2>
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{COPY.detail}</p>
          <p role="note" className="text-sm">{COPY.testNote}</p>
          {uploads.targets.map(target => (
            <OtherAdultUploadCard key={`${target.subjectId}:${target.state}:${target.consent?.token ?? ""}`} target={target} limits={limits} />
          ))}
          <OtherAdultNewPersonForm token={uploads.draftToken} />
        </div>
      </details>
    </section>
  );
}

/**
 * The files list's one line per Path B person with a file (brief §5.2: the
 * uploader sees the state, never the file). Read-only: no permission, no
 * upload, no file row.
 */
export async function OtherAdultHeldRows() {
  const targets = await listOtherAdultTargets().catch(() => null);
  const rows = (targets ?? []).flatMap(target => {
    if (target.state === "pending") {
      return [{ key: target.subjectId, text: COPY.pendingStatus(target.label),
        detail: target.latest?.deleteBy ? COPY.pendingDeadline(day(target.latest.deleteBy)) : null }];
    }
    const line = latestFileLine(target.label, target.latest);
    return line ? [{ key: target.subjectId, text: line, detail: null }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-3" data-slot="other-adult-held-rows">
      {rows.map(row => (
        <li key={row.key} className="rounded-xl border border-line bg-card p-4">
          <p role="status" className="text-sm">{row.text}</p>
          {row.detail ? <p className="text-sm text-ink-muted">{row.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}
