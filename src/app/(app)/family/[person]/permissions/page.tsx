import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Family permissions" };

export default function FamilyPermissionsPage() {
  return <CapabilityUnavailable eyebrow="Family" title="Permissions" backHref="/family" />;
}
