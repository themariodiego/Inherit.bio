import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Family member" };

export default function FamilyPersonPage() {
  return <CapabilityUnavailable eyebrow="Family" title="Family member record" backHref="/family" />;
}
