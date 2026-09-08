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
  }>;
};
