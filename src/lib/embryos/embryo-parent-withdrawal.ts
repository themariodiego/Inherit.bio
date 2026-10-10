import "server-only";
import { z } from "zod";
import { EMBRYO_STATUS } from "@/copy/embryos";
import { EMBRYO_WITHDRAWAL_COPY, EMBRYO_WITHDRAWAL_PURPOSES } from "@/copy/rights/embryo-withdrawal";
import { createAdminClient } from "@/lib/supabase/admin";
import { adultSubjectRequestAllowed } from "./adult-subject-review";
import { mintPublicFormToken, readPublicFormToken } from "./operation-token";
import type { EmbryoStatus } from "./policy";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "./rights-session";

/**
 * The embryo-parent-withdrawal rights session (register rights.withdraw,
 * `rightsEmbryoWithdrawal`; `policyContracts.upload-time-rights-notice-v1.embryo`).
 * An upload-time notice's link opened it; the browser holds only the
 * host-only cookie. Everything shown comes from one database projection that
 * rechecks the session, its credential and the purpose matrix, and every
 * action goes back through the database with a one-time form nonce bound to
 * this session. Nothing here names an embryo, a file, a person or a contact.
 */

export const embryoParentWithdrawalBody = z.object({
  operation: z.enum(["refuse", "delete"]),
  nonce: z.string().min(1).max(2_048),
}).strict();
export type EmbryoWithdrawalOperation = z.infer<typeof embryoParentWithdrawalBody>["operation"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const viewSchema = z.object({
  version: z.literal("embryo-parent-withdrawal-view-v1"),
  addedOn: z.string().regex(DATE),
  embryoCount: z.number().int().min(1).max(64),
  statuses: z.array(z.enum(Object.keys(EMBRYO_STATUS) as [EmbryoStatus, ...EmbryoStatus[]])).min(1).max(64),
  purposes: z.array(z.string().max(64)).max(16),
  retentionMaximumDays: z.number().int().min(1).max(3_660),
  allowedActionIds: z.array(z.enum(["refuse", "delete"])).max(2),
}).strict();

/** The registered closed shape `rightsEmbryoWithdrawal`, plus this form's nonce. */
export interface RightsEmbryoWithdrawal {
  cohortSafeLabel: string;
  embryoCount: number;
  safeStatusLabels: string[];
  currentPurposeLabels: string[];
  retentionMaximumDays: number;
  allowedActionIds: EmbryoWithdrawalOperation[];
  /** Always empty: no condition is registered, and a cohort with a score is refused upstream. */
  findings: never[];
}

const WORDS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The projection for the session the cookie names, or null for any other state. */
export async function loadEmbryoParentWithdrawal(
  request: Request, now = Date.now(),
): Promise<{ view: RightsEmbryoWithdrawal; nonce: string } | null> {
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const { data, error } = await createAdminClient().rpc("embryo_parent_withdrawal_view_v1", { p_session_hash: sessionHash });
  if (error || data === null) return null;
  const parsed = viewSchema.safeParse(data);
  if (!parsed.success || parsed.data.statuses.length !== parsed.data.embryoCount) return null;
  const facts = parsed.data;
  return {
    view: {
      cohortSafeLabel: EMBRYO_WITHDRAWAL_COPY.cohortLabel(WORDS.format(new Date(`${facts.addedOn}T00:00:00Z`))),
      embryoCount: facts.embryoCount,
      safeStatusLabels: facts.statuses.map((status) => EMBRYO_STATUS[status]),
      currentPurposeLabels: facts.purposes.flatMap((purpose) =>
        Object.hasOwn(EMBRYO_WITHDRAWAL_PURPOSES, purpose) ? [EMBRYO_WITHDRAWAL_PURPOSES[purpose]!] : []),
      retentionMaximumDays: facts.retentionMaximumDays,
      allowedActionIds: facts.allowedActionIds,
      findings: [],
    },
    nonce: mintPublicFormToken("embryo-parent-withdraw", now, sessionHash),
  };
}

/** The session hash and one-time nonce of a form this deployment served for this session. */
export function readEmbryoParentWithdrawal(request: Request, nonce: string, now = Date.now()) {
  if (!adultSubjectRequestAllowed(request)) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter((part) => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, "embryo-parent-withdraw", now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}

/** True only when the database took exactly this action for this session. */
export async function respondEmbryoParentWithdrawal(
  authority: { sessionHash: string; nonce: string }, operation: EmbryoWithdrawalOperation,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("respond_embryo_parent_withdrawal_v1", {
    p_session_hash: authority.sessionHash, p_action: operation, p_nonce: authority.nonce,
  });
  return !error && data === (operation === "refuse" ? "refused" : "deleted");
}
