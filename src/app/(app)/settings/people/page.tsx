import type { Metadata } from "next";
import { CapabilityUnavailable } from "@/components/capability-unavailable";

export const metadata: Metadata = { title: "People" };

export default function PeopleSettingsPage() {
  return <CapabilityUnavailable eyebrow="Settings" title="People and relationships" backHref="/settings" />;
}
