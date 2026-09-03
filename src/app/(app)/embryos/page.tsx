import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { NAV_LABELS } from "@/copy/navigation";

export const metadata: Metadata = { title: "Embryos" };

export default function EmbryosPage() {
  return (
    <CapabilityUnavailable eyebrow="Embryo Analysis" title={NAV_LABELS.embryos} backHref="/overview">
      <div className="rounded-xl bg-tint p-4 text-sm leading-relaxed">
        <h3 className="font-medium">If a child is born from this</h3>
        <p className="mt-2 text-ink-muted">
          This record is held for the future person, never to rank embryos or
          predict which life is better. Their rights follow the record.
        </p>
      </div>
      <p className="text-sm text-ink-muted">
        No embryo analysis model is currently allowlisted on this deployment.
      </p>
    </CapabilityUnavailable>
  );
}
