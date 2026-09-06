import { z } from "zod";
import { route } from "@/lib/primary-routes";
import type { OwnReportChoicesView } from "./own-report-purpose";
import { subjectNormalizationReceipt, subjectSynchronousReportReceipt } from "./subject-upload-contract";

type Choice = Extract<OwnReportChoicesView, { kind: "ready" }>["choices"][number];
const grantReceipt = z.object({ recordKind: z.literal("purpose_grant"), recordId: z.uuid(),
  artifactKey: z.string(), artifactVersion: z.number().int().positive(), purposeKey: z.string(),
  signedAt: z.iso.datetime({ offset: true }),
}).strict();
const revokeReceipt = z.object({ revoked: z.literal(true), effectiveAt: z.iso.datetime({ offset: true }) }).strict();

/** Only closed, target-matching receipts change the permission controls. */
export async function enableOwnReportChoice(subjectId: string, choice: Choice): Promise<void> {
  const response = await fetch(route("api.consents"), { method: "POST", headers: {
    "content-type": "application/json", "x-inherit-csrf": choice.token,
  }, body: JSON.stringify({ action: "grant-purpose", subjectId, purposeKey: choice.purposeKey,
    artifactVersion: choice.artifact.version, artifactPresentationToken: choice.token,
    affirmed: true, statementKeys: choice.statementKeys,
  }) });
  const receipt = grantReceipt.safeParse(await response.json());
  if (response.status !== 201 || !receipt.success || receipt.data.purposeKey !== choice.purposeKey
    || receipt.data.artifactKey !== choice.artifact.key || receipt.data.artifactVersion !== choice.artifact.version) {
    throw new Error("choice_not_saved");
  }
}

export async function disableOwnReportChoice(grantId: string): Promise<void> {
  if (!z.uuid().safeParse(grantId).success) throw new Error("invalid_grant");
  const response = await fetch(route("api.consent-revoke", { id: grantId }), { method: "POST" });
  if (response.status !== 200 || !revokeReceipt.safeParse(await response.json()).success) throw new Error("choice_not_saved");
}

export async function generateOwnReports(fileId: string): Promise<"ready" | "not_generated"> {
  if (!z.uuid().safeParse(fileId).success) throw new Error("invalid_file");
  const response = await fetch(route("api.file-process", { id: fileId }), { method: "POST" });
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error("generation_unavailable");
  const generated = subjectSynchronousReportReceipt.safeParse(body);
  if (generated.success && generated.data.fileId === fileId) return "ready";
  const prepared = subjectNormalizationReceipt.safeParse(body);
  if (prepared.success && prepared.data.fileId === fileId) return "not_generated";
  throw new Error("generation_unavailable");
}
