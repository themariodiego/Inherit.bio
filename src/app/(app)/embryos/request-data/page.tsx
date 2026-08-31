import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Request embryo data" };

export default function EmbryoRequestDataPage() {
  return <CapabilityUnavailable eyebrow="Embryo Analysis" title="Request data from a clinic" backHref="/embryos" />;
}
