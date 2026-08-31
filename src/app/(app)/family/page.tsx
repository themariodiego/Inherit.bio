import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "Family" };

export default function FamilyPage() {
  return (
    <CapabilityUnavailable eyebrow="Family" title="Understand shared inheritance" backHref="/overview">
      <div className="rounded-xl bg-tint p-4 text-sm leading-relaxed">
        <h3 className="font-medium">If a child is born from this</h3>
        <p className="mt-2 text-ink-muted">
          Their genetic record belongs to them. Any future use must preserve
          their right to know, not know, correct, export, and delete it.
        </p>
      </div>
    </CapabilityUnavailable>
  );
}
