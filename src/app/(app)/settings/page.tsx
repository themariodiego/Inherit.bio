import type { Metadata } from "next";
import Link from "next/link";
import { ChromosomalSexControl } from "@/components/settings/chromosomal-sex-control";
import { DigestToggle } from "@/components/settings/digest-toggle";
import { JurisdictionForm } from "@/components/settings/jurisdiction-form";
import { DATA_AND_METHODS } from "@/copy/reports/strings";
import { localAuthDestination } from "@/lib/auth/local-destination";
import { declaredChromosomalSexFrom } from "@/lib/family/chromosomal-sex";
import {
  currentJurisdictionAttestation,
  jurisdictionChoices,
  jurisdictionName,
  readDeclaredJurisdiction,
} from "@/lib/legal/jurisdiction-declaration";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const sections = [
  { href: route("settings.data"), title: "Data", copy: "Export or delete account data." },
  { href: route("settings.copilot"), title: "Copilot", copy: "Choose a local or cloud model endpoint." },
  { href: route("settings.people"), title: "People", copy: "Subject records and relationship authority." },
  { href: route("settings.consents"), title: "Consents", copy: "Review and revoke grants by purpose." },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const [{ data: { user } }, { data: profile }, query, attestation] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("digest_opt_in").maybeSingle(),
    searchParams,
    currentJurisdictionAttestation(),
  ]);
  // G5.1a: the first sign-in is sent here until a country is declared, with
  // the page it asked for as `next`; only a local path is ever followed.
  const declaredCode = user ? await readDeclaredJurisdiction(user.id) : null;
  const next = typeof query.next === "string" && !declaredCode ? localAuthDestination(query.next) : null;

  // The declaration is per subject, and the only subject in scope on this page
  // is the one this account IS (D-031). An account that also holds another
  // adult's record cannot declare for them from here, and nothing on this page
  // offers to: that adult declares from their own session or their value stays
  // blank.
  const self = user ? await resolveSubjectForAccount(user.id, "me") : null;
  const declaredSex =
    self && user
      ? declaredChromosomalSexFrom(
          (
            await createAdminClient().rpc("own_chromosomal_sex_v1", {
              p_account_id: user.id,
              p_subject_id: self.id,
            })
          ).data,
        )
      : null;

  return (
    <div className="page-stack mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="eyebrow">Account</p>
        <h1 className="display text-3xl">Settings</h1>
        <p className="text-base text-ink-muted">{user?.email}</p>
      </header>
      {user && attestation ? (
        <JurisdictionForm
          choices={jurisdictionChoices()}
          current={declaredCode ? { code: declaredCode, name: jurisdictionName(declaredCode) } : null}
          attestation={attestation}
          next={next}
        />
      ) : null}
      <nav aria-label="Settings sections" className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="link-surface rounded-2xl border border-line bg-card p-6 hover:border-forest">
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
      {self ? <ChromosomalSexControl subjectId={self.id} declared={declaredSex} /> : null}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/about#accessibility" className="link-target underline underline-offset-4 hover:text-ink">Accessibility</Link>
        {/* The third of the expert path's three entry points (brief §7.3); the
            other two are every report footer and the ancestry page. */}
        <Link href={route("genome.data", { subject: "me" })} className="link-target underline underline-offset-4 hover:text-ink">
          {DATA_AND_METHODS}
        </Link>
      </footer>
    </div>
  );
}
