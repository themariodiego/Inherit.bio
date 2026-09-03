import type { Metadata } from "next";
import Link from "next/link";
import { DigestToggle } from "@/components/settings/digest-toggle";
import { DATA_AND_METHODS } from "@/copy/reports/strings";
import { route } from "@/lib/primary-routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const sections = [
  { href: "/settings/data", title: "Data", copy: "Export or delete account data." },
  { href: "/settings/copilot", title: "Copilot", copy: "Choose a local or cloud model endpoint." },
  { href: "/settings/people", title: "People", copy: "Subject records and relationship authority." },
  { href: "/settings/consents", title: "Consents", copy: "Review and revoke grants by purpose." },
] as const;

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("digest_opt_in").maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="eyebrow">Account</p>
        <h1 className="display text-3xl">Settings</h1>
        <p className="text-base text-ink-muted">{user?.email}</p>
      </header>
      <nav aria-label="Settings sections" className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="rounded-2xl border border-line bg-card p-5 hover:border-forest">
            <h2 className="font-medium">{section.title}</h2>
            <p className="mt-2 text-sm text-ink-muted">{section.copy}</p>
          </Link>
        ))}
      </nav>
      {user ? (
        <section className="space-y-4">
          <h2 className="eyebrow">Email</h2>
          <DigestToggle userId={user.id} optIn={profile?.digest_opt_in ?? false} />
        </section>
      ) : null}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/about#accessibility" className="underline underline-offset-4 hover:text-ink">Accessibility</Link>
        {/* The third of the expert path's three entry points (brief §7.3); the
            other two are every report footer and the ancestry page. */}
        <Link href={route("genome.data", { subject: "me" })} className="underline underline-offset-4 hover:text-ink">
          {DATA_AND_METHODS}
        </Link>
      </footer>
    </div>
  );
}
