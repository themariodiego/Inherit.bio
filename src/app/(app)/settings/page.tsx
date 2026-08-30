import type { Metadata } from "next";
import Link from "next/link";
import { ConsentList } from "@/components/settings/consent-list";
import { DangerZone } from "@/components/settings/danger-zone";
import { DigestToggle } from "@/components/settings/digest-toggle";
import { LlmSettingsForm } from "@/components/settings/llm-settings-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: llm }, { data: grants }] =
    await Promise.all([
      supabase.from("profiles").select("digest_opt_in").maybeSingle(),
      supabase
        .from("llm_settings")
        .select("provider, base_url, model, key_last4")
        .maybeSingle(),
      supabase
        .from("consent_grants")
        .select("id, provider_key, data_classes, granted_at, revoked_at")
        .order("granted_at", { ascending: false }),
    ]);

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div>
        <p className="eyebrow mb-2">Account</p>
        <h1 className="display text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">{user!.email}</p>
      </div>

      <section className="space-y-4">
        <h2 className="eyebrow">Copilot provider</h2>
        <LlmSettingsForm
          current={
            llm
              ? {
                  provider: llm.provider as "anthropic" | "openai_compatible",
                  base_url: llm.base_url,
                  model: llm.model,
                  key_last4: llm.key_last4,
                }
              : null
          }
        />
      </section>

      <section className="space-y-4">
        <h2 className="eyebrow">Cloud-LLM consent grants</h2>
        <ConsentList grants={grants ?? []} />
      </section>

      <section className="space-y-4">
        <h2 className="eyebrow">Email</h2>
        <DigestToggle
          userId={user!.id}
          optIn={profile?.digest_opt_in ?? false}
        />
      </section>

      <section className="space-y-4">
        <h2 className="eyebrow">Your data</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-5">
          <div>
            <h3 className="font-medium">Export everything</h3>
            <p className="text-sm text-ink-muted">
              ZIP of your original uploads, all variants, computed report
              results, polygenic scores, ancestry, consents, and chat history
              (if stored). Free, forever — exporting your own genome will
              never cost money here.
            </p>
          </div>
          <Button asChild variant="outline">
            <a href="/api/export">Download export</a>
          </Button>
        </div>
        <DangerZone />
      </section>

      {/* The accessibility statement otherwise lives only in the marketing
          footer, which signed-in pages never show — link it from here too. */}
      <footer className="border-t border-line pt-6 text-sm text-ink-muted">
        <Link
          href="/about#accessibility"
          className="underline underline-offset-4 hover:text-ink"
        >
          Accessibility
        </Link>{" "}
        — our WCAG 2.1 AA commitment, known gaps, and how to report a barrier.
      </footer>
    </div>
  );
}
