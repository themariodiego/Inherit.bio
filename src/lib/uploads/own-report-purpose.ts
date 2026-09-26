import { z } from "zod";

export const OWN_REPORT_PURPOSES = ["reports.monogenic", "reports.polygenic", "ancestry"] as const;
export type OwnReportPurpose = (typeof OWN_REPORT_PURPOSES)[number];
export const OWN_REPORT_CHOICES = {
  "reports.monogenic": { label: "Observed genetic variants", description: "See which genetic variants were read from your file and their coverage. A variant alone is not a diagnosis.", artifactKey: "consent.own-monogenic" },
  "reports.polygenic": { label: "Trait reports and estimates", description: "Explore trait reports and estimates from individual variants or many variants, with evidence, coverage and uncertainty.", artifactKey: "consent.own-polygenic" },
  ancestry: { label: "Ancestry", description: "Explore genetic ancestry estimates and their uncertainty.", artifactKey: "consent.own-ancestry" },
} as const;
export const OWN_REPORT_STATEMENTS = ["make-this-result-for-me"] as const;
export const ownReportPurposeBody = z.object({
  action: z.literal("grant-purpose"), subjectId: z.uuid(), purposeKey: z.enum(OWN_REPORT_PURPOSES),
  artifactVersion: z.number().int().positive().safe(), artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true), statementKeys: z.tuple([z.literal("make-this-result-for-me")]),
}).strict();
export type OwnReportChoicesView = { kind: "unavailable" } | {
  kind: "ready"; subjectId: string; choices: Array<{
    purposeKey: OwnReportPurpose; label: string; description: string; granted: boolean; grantId: string | null;
    artifact: { key: string; version: number; body: string }; token: string; statementKeys: string[];
    /**
     * Present only when this person already agreed to an earlier version of
     * this document and that signature no longer resolves. G5.2 requires the
     * re-consent surface to say what changed, in the same block as the accept
     * control, and to link the full version they signed.
     *
     * `changes` carries every version after the one they signed, each with its
     * own summary, rather than only the newest. Someone two versions behind is
     * owed both, and the alternative — showing the newest summary alone —
     * describes the span incompletely while looking complete.
     */
    reconsent: { signedVersion: number; changes: Array<{ version: number; summary: string }> } | null;
  }>;
};

/**
 * The "Choose your reports" section exactly as `/genome/[subject]/reports`
 * renders it. `hidden` is every case where the section does not render at
 * all (no own-account choices for this record, or no prepared file for them
 * to run on); `files-unavailable` is the one where it renders only a line
 * saying the choices could not load. Anything that tells a person to go to
 * that section reads this, so it can only point at a section that is there.
 */
export type OwnReportChoicesPanel =
  | { kind: "hidden" }
  | { kind: "files-unavailable" }
  | { kind: "ready"; view: Extract<OwnReportChoicesView, { kind: "ready" }>; files: Array<{ id: string; label: string }> };
