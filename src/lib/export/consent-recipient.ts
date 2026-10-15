import { z } from "zod";

const destination = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
});

/** Recorded destination history, never internal credential/transport evidence.
 * Keep this named projection shared by synchronous and consumed archives. */
export const consentRecipientSchema = z.object({
  providerLabel: z.string(),
  origin: destination,
  revision: z.number().int().positive().safe(),
  providerClass: z.enum(["local", "cloud"]),
  baseUrl: destination,
  provider: z.string(),
  model: z.string(),
}).strict();

export function exportConsentRecipient(value: unknown): z.infer<typeof consentRecipientSchema> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("export_recipient_unavailable");
  const row = value as Record<string, unknown>;
  return consentRecipientSchema.parse({
    providerLabel: row.providerLabel, origin: row.origin, revision: row.revision,
    providerClass: row.providerClass, baseUrl: row.baseUrl, provider: row.provider, model: row.model,
  });
}
