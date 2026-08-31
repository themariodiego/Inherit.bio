import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Compare embryo data" };

export default function EmbryoComparePage() {
  return <CapabilityUnavailable eyebrow="Embryo Analysis" title="Side-by-side review" backHref="/embryos" />;
}
