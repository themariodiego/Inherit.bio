import {
  HELD_FOR_YOU_COPY as HELD,
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_CHOICES_COPY as CHOICES,
} from "@/copy/upload/other-adult";
import { listPathBUploaderShares, preparePathBChoices } from "@/lib/uploads/path-b-purpose-server";
import { PathBChoices } from "./path-b-choices";
import Link from "next/link";
import { route } from "@/lib/primary-routes";
import { listPathBReportMetadata } from "@/lib/uploads/path-b-report-reader";
import {
  listOtherAdultTargets,
  listSubjectHeldFiles,
  prepareOtherAdultUploads,
} from "@/lib/uploads/other-adult-upload-server";
import { readOwnUploadLimits } from "@/lib/uploads/own-upload-limits";
import { day, heldForYouLine, latestFileLine } from "./other-adult-lines";
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
 * Path B's account branch on the files list: for a person who confirmed a
 * request with their account, each file someone added for them, read-only.
 * The name the uploader typed, the kind, the dates and the state; answers
 * come from each file's email.
 */
export async function HeldForYouRows() {
  const people = await listSubjectHeldFiles().catch(() => null);
  const shown = (people ?? []).filter(person => person.files.length > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="held-for-you-heading" className="space-y-3" data-slot="held-for-you">
      <h2 id="held-for-you-heading" className="display text-2xl">{HELD.heading}</h2>
      {shown.map((person, index) => (
        <div key={index} className="rounded-xl border border-line bg-card p-4">
          <p className="text-sm text-ink-muted">{HELD.name(person.label)}</p>
          <ul className="mt-2 space-y-2">
            {person.files.map(file => (
              <li key={`${file.addedOn}:${file.state}`}><p role="status" className="text-sm">{heldForYouLine(file)}</p></li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Path B's reading layer for the signed-in person: their choices, one kind of
 * result at a time, for themselves and for the person who added their file.
 */
export async function PathBChoicesSection() {
  const people = await preparePathBChoices().catch(() => null);
  return people && people.length > 0 ? <PathBChoices people={people} /> : null;
}

/**
 * The files list's one line per Path B person with a file (brief §5.2: the
 * uploader sees the state, never the file). Read-only: no permission, no
 * upload, no file row.
 */
export async function OtherAdultHeldRows() {
  const [targets, shares, ready] = await Promise.all([
    listOtherAdultTargets().catch(() => null), listPathBUploaderShares().catch(() => null),
    listPathBReportMetadata().catch(() => []),
  ]);
  // Choice metadata is separate from the current completed-result links.
  // Neither projection carries a genetic result or a server receipt to JSX.
  const shared = (shares ?? []).filter(share => share.shared.length > 0).map((share, index) => ({
    key: `shared:${index}`, detail: null, href: null,
    text: CHOICES.uploaderShared(share.label, share.shared.map(layer => CHOICES.layers[layer.purpose]).join(", ")),
  }));
  const rows = [...(targets ?? []).flatMap(target => {
    if (target.state === "pending") {
      return [{ key: target.subjectId, text: COPY.pendingStatus(target.label), href: null,
        detail: target.latest?.deleteBy ? COPY.pendingDeadline(day(target.latest.deleteBy)) : null }];
    }
    const line = latestFileLine(target.label, target.latest);
    return line ? [{ key: target.subjectId, text: line, detail: null, href: null }] : [];
  }), ...shared, ...ready.filter(row => row.direction === "uploader").map(row => ({ key: `ready:${row.subjectId}`,
    text: CHOICES.readyShared(row.label), detail: null,
    href: route("genome.reports", { subject: `s-${row.subjectId}` }) }))];
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-3" data-slot="other-adult-held-rows">
      {rows.map(row => (
        <li key={row.key} className="rounded-xl border border-line bg-card p-4">
          <p role="status" className="text-sm">{row.text}</p>
          {row.detail ? <p className="text-sm text-ink-muted">{row.detail}</p> : null}
          {row.href ? <Link className="inline-flex min-h-11 items-center underline" href={row.href}>{CHOICES.openShared}</Link> : null}
        </li>
      ))}
    </ul>
  );
}
