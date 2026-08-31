import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Invite family" };

export default function FamilyInvitePage() {
  return <CapabilityUnavailable eyebrow="Family" title="Invite another adult" backHref="/family" />;
}
