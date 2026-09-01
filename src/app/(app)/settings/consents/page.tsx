import type { Metadata } from "next";
import Link from "next/link";
import { ConsentList } from "@/components/settings/consent-list";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Consents" };

export default async function ConsentsPage() {
  const supabase = await createClient();
  const { data: grants } = await supabase.from("consent_grants").select("id, provider_key, data_classes, granted_at, revoked_at").order("granted_at", { ascending: false });
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2"><p className="eyebrow">Settings</p><h1 className="display text-3xl">Consents</h1><p className="text-sm text-ink-muted">Each grant names one purpose and can be revoked independently.</p></header>
      <ConsentList grants={grants ?? []} />
      <Link href="/settings" className="text-sm underline underline-offset-2">← Settings</Link>
    </div>
  );
}
