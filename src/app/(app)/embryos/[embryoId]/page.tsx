import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Embryo record" };

export default function EmbryoDetailPage() {
  return <CapabilityUnavailable eyebrow="Embryo Analysis" title="Embryo record" backHref="/embryos" />;
}
