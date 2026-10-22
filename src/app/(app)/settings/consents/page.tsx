import type { Metadata } from "next";
import Link from "next/link";
import { ConsentList } from "@/components/settings/consent-list";
import { RevokeAllConsents } from "@/components/settings/revoke-all-consents";
import { revokeAllControlNonce } from "@/lib/consents-revoke-all-control";
import { createClient } from "@/lib/supabase/server";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Consents" };

export default async function ConsentsPage() {
  const supabase = await createClient();
  const [{ data: grants }, revokeAllNonce] = await Promise.all([
    supabase.from("consent_grants").select("id, provider_key, data_classes, granted_at, revoked_at").order("granted_at", { ascending: false }),
    revokeAllControlNonce(),
  ]);
  return (
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display">Consents</h1>
        <p className="lede">Each grant names one purpose and can be revoked independently.</p>
      </header>
      <ConsentList grants={grants ?? []} />
      {revokeAllNonce ? <RevokeAllConsents nonce={revokeAllNonce} /> : null}
      <p className="text-sm"><Link href={route("settings.index")} className="link-target quiet-link">← Settings</Link></p>
    </div>
  );
}
