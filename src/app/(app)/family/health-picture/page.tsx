import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Family health picture" };

export default function FamilyHealthPicturePage() {
  return <CapabilityUnavailable eyebrow="Family" title="Family health picture" backHref="/family" />;
}
