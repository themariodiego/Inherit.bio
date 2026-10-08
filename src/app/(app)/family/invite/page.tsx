import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { InviteAdultForm } from "@/components/family/invite-adult-form";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { INVITE_H1, PRE_CONSENT_STATEMENT } from "@/copy/family/invite";
import { NAV_LABELS } from "@/copy/navigation";
import { accountCapability, permits } from "@/lib/family/access";
import { route } from "@/lib/primary-routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: INVITE_H1 };

/**
 * `/family/invite` (design §2.6; register family.invite, route guard
 * `third_party_adult_analysis`).
 *
 * The pre-consent statement renders above the form, outside any disclosure
 * and before anything is entered: comparing two people's DNA can say
 * something neither of them asked to know, and that cannot be taken back.
 */
export default async function FamilyInvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const decision = await accountCapability(user.id, "third_party_adult_analysis");
  if (!permits(decision)) {
    return (
      <CapabilityUnavailable
        eyebrow={NAV_LABELS.family}
        title={INVITE_H1}
        backHref={route("family.index")}
      />
    );
  }

  return (
    <div data-surface="flow" className="page-stack stack-blocks mx-auto max-w-3xl">
      <div className="fam-head">
        <Breadcrumbs
          items={[
            { label: NAV_LABELS.family, href: route("family.index") },
            { label: INVITE_H1 },
          ]}
        />
        <header>
          <p className="eyebrow">{NAV_LABELS.family}</p>
          <h1 className="display">{INVITE_H1}</h1>
          <p
            data-slot="pre-consent-statement"
            className="body-lg max-w-measure text-ink"
          >
            {PRE_CONSENT_STATEMENT}
          </p>
        </header>
      </div>
      <InviteAdultForm />
    </div>
  );
}
