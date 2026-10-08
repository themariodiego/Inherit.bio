import type { Metadata } from "next";
import Link from "next/link";
import { EntryBoxGrid } from "@/components/overview/entry-box";
import { ChromosomalSexControl } from "@/components/settings/chromosomal-sex-control";
import { DigestToggle } from "@/components/settings/digest-toggle";
import { JurisdictionForm } from "@/components/settings/jurisdiction-form";
import { DATA_AND_METHODS } from "@/copy/reports/strings";
import { localAuthDestination } from "@/lib/auth/local-destination";
import { declaredChromosomalSexFrom } from "@/lib/family/chromosomal-sex";
import {
  countriesWithSubdivisions,
  currentJurisdictionAttestation,
  declarationChoices,
  jurisdictionName,
  readDeclaration,
  subdivisionChoices,
  subdivisionName,
} from "@/lib/legal/jurisdiction-declaration";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

// The four sections as entry rows (round-1 M4, M10): the same ruled form
// Overview's secondary domains use, each row one link named by its label.
const sections = [
  { id: "settings-data", href: route("settings.data"), label: "Data", description: "Export or delete account data." },
  { id: "settings-copilot", href: route("settings.copilot"), label: "Copilot", description: "Choose a local or cloud model endpoint." },
  { id: "settings-people", href: route("settings.people"), label: "People", description: "Subject records and relationship authority." },
  { id: "settings-consents", href: route("settings.consents"), label: "Consents", description: "Review and revoke grants by purpose." },
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
  const declaration = user ? await readDeclaration(user.id) : { code: null, subdivision: null };
  const declaredCode = declaration.code;
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
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Account</p>
        <h1 className="display">Settings</h1>
        <p className="caption">{user?.email}</p>
      </header>
      {/* The sections people come for lead; the declaration, a form most
          people never touch again, follows them (round-1 M4). */}
      <nav aria-label="Settings sections">
        <EntryBoxGrid variant="rows" boxes={sections} />
      </nav>
      {/* One form for every preference after the rows: a plate with its
          label in the head, the plates 48px apart (round-3 R3). */}
      <div className="stack-blocks">
        {user && attestation ? (
          <JurisdictionForm
            choices={declarationChoices(declaredCode)}
            states={Object.fromEntries(countriesWithSubdivisions().map((code) => [code, subdivisionChoices(code)]))}
            current={declaredCode ? {
              code: declaredCode,
              name: jurisdictionName(declaredCode),
              state: declaration.subdivision
                ? { code: declaration.subdivision, name: subdivisionName(declaration.subdivision) }
                : null,
            } : null}
            attestation={attestation}
            next={next}
          />
        ) : null}
        {user ? (
          <section className="plate">
            <div className="plate-head"><h2 className="eyebrow">Email</h2></div>
            <div className="plate-body">
              <DigestToggle userId={user.id} optIn={profile?.digest_opt_in ?? false} />
            </div>
          </section>
        ) : null}
        {self ? <ChromosomalSexControl subjectId={self.id} declared={declaredSex} /> : null}
      </div>
      <footer className="rule flex flex-wrap gap-x-6 gap-y-2 pt-4 text-sm">
        <Link href="/about#accessibility" className="link-target quiet-link">Accessibility</Link>
        {/* The third of the expert path's three entry points (brief §7.3); the
            other two are every report footer and the ancestry page. */}
        <Link href={route("genome.data", { subject: "me" })} className="link-target quiet-link">
          {DATA_AND_METHODS}
        </Link>
      </footer>
    </div>
  );
}
