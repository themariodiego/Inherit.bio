import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Upload embryo data" };

export default function EmbryoUploadPage() {
  return <CapabilityUnavailable eyebrow="Embryo Analysis" title="Upload embryo data" backHref="/embryos" />;
}
