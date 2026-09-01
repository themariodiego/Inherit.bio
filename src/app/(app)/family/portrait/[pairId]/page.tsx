import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Family portrait" };

export default function FamilyPortraitPage() {
  return <CapabilityUnavailable eyebrow="Family" title="Inheritance portrait" backHref="/family" />;
}
