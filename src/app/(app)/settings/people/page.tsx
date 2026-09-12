import type { Metadata } from "next";
import { FeatureNotBuilt } from "@/components/feature-not-built";

export const metadata: Metadata = { title: "People" };

/**
 * Until 2026-09-12 this rendered `<CapabilityUnavailable>`, which told every
 * visitor that a legal review was missing and the feature was off. There is no
 * jurisdiction guard on this route — the page was never built — so the
 * sentence was false, and it blamed the law for it.
 */
export default function PeopleSettingsPage() {
  return (
    <FeatureNotBuilt
      eyebrow="Settings"
      title="People and relationships"
      backHref="/settings"
      whatItWouldDo="This page will list the people you share with and let you change each of those choices in one place."
    />
  );
}
