import { z } from "zod";

/**
 * Path B's reading layer (TEST-LOCAL only): the person a Path B file was
 * added for, once bound to their own account, turns result layers on one at
 * a time, for themselves or for the person who added the file
 * (directional-purpose-grant-v1). The direction and every revision live in
 * the server-sealed presentation token; the body names only the layer.
 *
 * The queued normalization continuation can create a subject-bound canonical
 * source under its own confirmation, mitigation and worker fences. Reading
 * still requires the exact current grant in the selected direction and stops
 * at analysis-not-generated until a distinct queued report contract executes.
 * Normalization and a purpose grant alone never imply report readiness.
 */
export const PATH_B_PURPOSES = ["reports.monogenic", "reports.polygenic", "ancestry"] as const;
export type PathBPurpose = (typeof PATH_B_PURPOSES)[number];
export const PATH_B_DIRECTIONS = ["self", "uploader"] as const;
export type PathBDirection = (typeof PATH_B_DIRECTIONS)[number];

/**
 * Everything the person can turn on and off: the three result layers, and
 * since 20 November 2026 (owner decision "G8.5: Copilot for another adult's
 * record opens") `copilot.local` for the person who added the file. Copilot
 * has no "for you" row (the person's own Copilot is their own permission) and
 * is no result layer: it lets that person's own local model read the report
 * layers shared with them, and nothing else.
 */
export const PATH_B_CHOICE_PURPOSES = [...PATH_B_PURPOSES, "copilot.local"] as const;
export type PathBChoicePurpose = (typeof PATH_B_CHOICE_PURPOSES)[number];

/** The approved text one choice is signed under, or null where that direction has no such choice. */
export function pathBGrantText(direction: PathBDirection, purpose: PathBChoicePurpose): string | null {
  if (purpose === "copilot.local") return direction === "uploader" ? "consent.share-with-adult" : null;
  return PATH_B_GRANT_TEXT[direction][purpose];
}

/** The approved text each layer and direction is granted under, and the statements it records. */
export const PATH_B_GRANT_TEXT: Record<PathBDirection, Record<PathBPurpose, string>> = {
  self: { "reports.monogenic": "consent.own-monogenic", "reports.polygenic": "consent.own-polygenic", ancestry: "consent.own-ancestry" },
  uploader: { "reports.monogenic": "consent.share-with-adult", "reports.polygenic": "consent.share-with-adult", ancestry: "consent.share-with-adult" },
};
export const PATH_B_STATEMENTS: Record<PathBDirection, readonly string[]> = {
  self: ["make-this-result-for-me"],
  uploader: ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"],
};

/** `POST /api/consents`, one Path B layer: the same closed shape as every grant body. */
export const pathBPurposeBody = z.object({
  action: z.literal("grant-purpose"),
  subjectId: z.uuid(),
  purposeKey: z.enum(PATH_B_CHOICE_PURPOSES),
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(8),
}).strict();
export type PathBPurposeRequest = z.infer<typeof pathBPurposeBody>;

/** The database's gates, as the read decision names them. */
export const PATH_B_GATES = ["subject-bound-source", "analysis-not-generated", "ready", "directional-purpose-grant-v1", "adult.non-account-holder-24mo",
  "adult.acceptance-hold-72h", "adult.re-notice-30d", "not-found", "purpose"] as const;
export type PathBGate = (typeof PATH_B_GATES)[number];

const gate = z.enum(PATH_B_GATES);
const decision = z.object({ decision: z.enum(["allow", "subject-own-right-only", "deny"]), gate: gate.nullable() }).strict();

/** `path_b_person_choices_v1`, row by row. */
export const pathBPersonChoices = z.array(z.object({
  subjectId: z.uuid(),
  label: z.string().min(1).max(200),
  uploaderShare: decision,
  readGate: z.object({ "reports.monogenic": gate, "reports.polygenic": gate, ancestry: gate }).strict(),
  grants: z.array(z.object({ grantId: z.uuid(), purpose: z.enum(PATH_B_CHOICE_PURPOSES), direction: z.enum(PATH_B_DIRECTIONS),
    grantedAt: z.string() }).strict()).max(14),
}).strict()).max(100);
export type PathBPersonChoices = z.infer<typeof pathBPersonChoices>;

/** `path_b_uploader_shares_v1`: the layers each person shared with the uploader. */
export const pathBUploaderShares = z.array(z.object({
  label: z.string().min(1).max(200),
  shared: z.array(z.object({ purpose: z.enum(PATH_B_PURPOSES), gate }).strict()).max(3),
}).strict()).max(100);
export type PathBUploaderShares = z.infer<typeof pathBUploaderShares>;

/** One row of the person's choices as the page renders it. */
export interface PathBChoice {
  purpose: PathBChoicePurpose;
  direction: PathBDirection;
  grantId: string | null;
  /** With a grant: the one-time nonce the page rendered for its revocation (G5.6, 23 Oct 2026). */
  revokeNonce: string | null;
  /** Present when the layer can be turned on now: a sealed presentation for exactly this row. */
  offer: { token: string; artifactVersion: number; artifactBody: string } | null;
}
export interface PathBChoicesView {
  subjectId: string;
  label: string;
  shareOpen: boolean;
  choices: PathBChoice[];
  readGate?: PathBPersonChoices[number]["readGate"];
}
