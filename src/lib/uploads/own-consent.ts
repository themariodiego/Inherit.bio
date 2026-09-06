import { z } from "zod";

export const OWN_UPLOAD_ARTIFACT_KEYS = [
  "disclosure.insurance-and-discrimination",
  "consent.upload-self",
] as const;
export type OwnUploadArtifactKey = (typeof OWN_UPLOAD_ARTIFACT_KEYS)[number];

export const OWN_UPLOAD_STATEMENTS = {
  "disclosure.insurance-and-discrimination": ["understood"],
  "consent.upload-self": ["own-adult-dna"],
} as const;

export const ownConsentBody = z.object({
  action: z.literal("sign-artifact"),
  signatureClass: z.literal("tier1-self"),
  subjectId: z.uuid().regex(/^[0-9a-f-]+$/),
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().max(64)).length(1),
}).strict();

export type OwnConsentRequest = z.infer<typeof ownConsentBody>;

export function isOwnConsentPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "signatureClass" in value && value.signatureClass === "tier1-self";
}
