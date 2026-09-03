/**
 * <SubjectBar> — the 44px identity bar rendered directly under the app
 * header on every subject-derived route (brief §2 §2.3). Server component.
 *
 * (a) a 24px disc in the subject colour with the initial as text;
 * (b) the display name;
 * (c) the kind chip — exactly one of the KIND_CHIPS words;
 * (d) the file count as text, linking to /files;
 * (e) the persistent secondary action "Add a file" on self and adult bars.
 *
 * Colour never carries identity alone (X2.4): the initial and the name are
 * text. The bar root carries data-subject-id.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ADD_A_FILE, KIND_CHIPS, fileCount, type KindChip } from "@/copy/reports/strings";
import { subjectColourIndex, subjectInitial } from "@/lib/subject-colour";
import type { SubjectSummary } from "@/lib/subjects";
import { cn } from "@/lib/utils";

/** Literal class names so Tailwind can see every token. */
const DISC_CLASSES = [
  "bg-subject-0",
  "bg-subject-1",
  "bg-subject-2",
  "bg-subject-3",
  "bg-subject-4",
  "bg-subject-5",
  "bg-subject-6",
  "bg-subject-7",
] as const;

export type SubjectBarSubject = Pick<
  SubjectSummary,
  "id" | "displayLabel" | "subjectClass" | "routeSegment" | "subjectAccountId" | "ownerAccountId"
>;

/**
 * "Shared with you" when the other adult holds their own account and it is
 * not the owner's; "Uploaded with their permission" for every other adult
 * record. A `minor` record (forbidden by X2.3, still present in the enum)
 * is shown as an uploaded record until the migration owner removes it.
 */
export function subjectKind(subject: SubjectBarSubject): KindChip {
  switch (subject.subjectClass) {
    case "self":
      return "self";
    case "embryo":
      return "embryo";
    default:
      return subject.subjectAccountId && subject.subjectAccountId !== subject.ownerAccountId
        ? "adult_shared"
        : "adult_uploaded";
  }
}

export interface SubjectBarProps {
  subject: SubjectBarSubject;
  /** Number of processed files in this subject record. */
  fileCount: number;
  className?: string;
}

export function SubjectBar({ subject, fileCount: files, className }: SubjectBarProps) {
  const kind = subjectKind(subject);
  const colour = subjectColourIndex(subject);
  const canAddFile = kind === "self" || kind === "adult_shared" || kind === "adult_uploaded";

  return (
    <div
      data-subject-bar="true"
      data-subject-id={subject.id}
      data-subject-kind={kind}
      className={cn(
        "flex h-11 min-w-0 items-center gap-3 border-b border-line text-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="subject-disc"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none text-paper",
          DISC_CLASSES[colour],
        )}
      >
        {subjectInitial(subject.displayLabel)}
      </span>
      <span data-slot="subject-name" className="truncate font-medium text-ink">
        {subject.displayLabel}
      </span>
      <span
        data-slot="subject-kind"
        className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm text-ink-muted"
      >
        {KIND_CHIPS[kind]}
      </span>
      <Link
        href="/files"
        data-slot="subject-files"
        className="shrink-0 text-ink-muted underline-offset-2 hover:underline"
      >
        {fileCount(files)}
      </Link>
      {canAddFile ? (
        <Button asChild variant="outline" size="sm" className="ml-auto shrink-0">
          <Link href={`/files/upload?subject=${encodeURIComponent(subject.routeSegment)}`}>
            {ADD_A_FILE}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
