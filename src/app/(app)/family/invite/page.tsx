import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { InviteAdultForm } from "@/components/family/invite-adult-form";

export const metadata: Metadata = { title: "Invite family" };

export default function FamilyInvitePage() {
  if (process.env.INHERIT_TEST_JURISDICTION !== "1") {
    return <CapabilityUnavailable eyebrow="Family" title="Invite another adult" backHref="/family" />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Family</p>
        <h1 className="display text-3xl">Invite another adult</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          The invited person must accept through their own account. Acceptance
          does not share their genetic data and does not let you upload or
          analyse a file for them.
        </p>
      </header>
      <InviteAdultForm />
    </div>
  );
}
