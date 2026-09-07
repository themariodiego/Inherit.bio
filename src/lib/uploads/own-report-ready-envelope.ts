import "server-only";
import { encryptSecret, hmacSecret } from "../crypto";
import { createAdminClient } from "../supabase/admin";
import { createClient } from "../supabase/server";

/** Only the authenticated server response selects the recipient. This envelope
 * is an argument to the atomic completion RPC, never a direct mail submission. */
export async function ownReportReadyEnvelope(accountId: string) {
  // Read the DB-owned counter first. An Auth email transition before getUser
  // or between getUser and enqueue makes this envelope stale, never readdressed.
  const { data: profile, error } = await createAdminClient().from("profiles")
    .select("mail_contact_revision").eq("id", accountId).single();
  if (error || !Number.isSafeInteger(profile?.mail_contact_revision) || profile!.mail_contact_revision < 1) throw new Error("unavailable");
  const contactRevision = profile!.mail_contact_revision;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (user?.id !== accountId || !user.email || !user.email_confirmed_at) throw new Error("unavailable");
  const email = user.email.trim().toLowerCase();
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error("unavailable");
  return { contactRevision, contactCiphertext: encryptSecret(email).toString("hex"), contactHmac: hmacSecret(email, "contact-email-v1"),
    dashboardUrl: new URL("/genome/me/reports", origin.origin).href };
}
