// Relative imports: the browser spec reads these lines too.
import { HELD_FOR_YOU_COPY as HELD, OTHER_ADULT_UPLOAD_COPY as COPY } from "../../copy/upload/other-adult";
import type { PathBRevisionState, SubjectHeldFile } from "../../lib/uploads/other-adult-upload";

/** The person's own line about one file someone added for them (Path B's account branch). */
export function heldForYouLine(file: SubjectHeldFile): string {
  return file.state === "pending"
    ? HELD.pending(day(file.addedOn), file.fileKind, day(file.deleteBy))
    : HELD.confirmed(day(file.addedOn), file.fileKind);
}

/** A day as the Path B screens write it: "28 September 2026", in UTC. */
export function day(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The one line about the latest file for this person, when it is no longer pending. */
export function latestFileLine(label: string, latest: PathBRevisionState | null): string | null {
  if (!latest || latest.state === "pending") return null;
  if (latest.state === "confirmed") return COPY.confirmedStatus(label, day(latest.addedOn));
  if (latest.state === "refused") return COPY.refusedStatus(label, day(latest.addedOn));
  return COPY.endedStatus(day(latest.addedOn));
}
