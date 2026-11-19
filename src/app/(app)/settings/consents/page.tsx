import type { Metadata } from "next";
import Link from "next/link";
import { ConsentList } from "@/components/settings/consent-list";
import { RevokeAllConsents } from "@/components/settings/revoke-all-consents";
import { OwnUploadWithdrawal } from "@/components/uploads/own-upload-withdrawal";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { revokeAllControlNonce } from "@/lib/consents-revoke-all-control";
import { mintPersonOperationNonce } from "@/lib/person-operation-nonce";
import { createClient } from "@/lib/supabase/server";
import { route } from "@/lib/primary-routes";
import { prepareOwnUploadWithdrawal } from "@/lib/uploads/own-upload-withdrawal";

export const metadata: Metadata = { title: "Consents" };

export default async function ConsentsPage() {
  const supabase = await createClient();
  const [{ data: grants }, revokeAllNonce, account, ownUpload] = await Promise.all([
    supabase.from("consent_grants").select("id, provider_key, data_classes, granted_at, revoked_at").order("granted_at", { ascending: false }),
    revokeAllControlNonce(),
    getSensitiveAccountContext(),
    // The consent to store the account's own DNA file, with its withdrawal
    // (owner decision of 19 November 2026); nothing when it is not live.
    prepareOwnUploadWithdrawal(),
  ]);
  // Each live grant's revocation consumes a one-time nonce (api.consent-revoke,
  // G8.5, 24 October 2026), rendered here for this account, session and grant
  // and stored nowhere.
  const rows = (grants ?? []).map((grant) => ({ ...grant,
    revokeNonce: account && !grant.revoked_at ? mintPersonOperationNonce({ accountId: account.user.id,
      sessionId: account.sessionId, operation: "consent_revoke", targetId: grant.id }) : null }));
  return (
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display">Consents</h1>
        <p className="lede">Each grant names one purpose and can be revoked independently.</p>
      </header>
      <ConsentList grants={rows} />
      {revokeAllNonce ? <RevokeAllConsents nonce={revokeAllNonce} /> : null}
      <OwnUploadWithdrawal view={ownUpload} />
      <p className="text-sm"><Link href={route("settings.index")} className="link-target quiet-link">← Settings</Link></p>
    </div>
  );
}
