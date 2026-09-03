/**
 * Primary navigation copy — the single source for the five nav labels and
 * for the h1 identity rule: each label is character-identical to the `h1`
 * of its destination (docs/route-register.json →
 * navigationContract.primaryHeadingContract, copySource src/copy/navigation.ts).
 *
 * Exactly five items, in this order. No sixth item without removing one.
 */
export const NAV_LABELS = {
  overview: "Overview",
  "my-genome": "My Genome",
  family: "Family",
  embryos: "Embryos",
  settings: "Settings",
} as const;

export type NavItemId = keyof typeof NAV_LABELS;

export interface NavItem {
  id: NavItemId;
  label: (typeof NAV_LABELS)[NavItemId];
  href: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", label: NAV_LABELS.overview, href: "/overview" },
  { id: "my-genome", label: NAV_LABELS["my-genome"], href: "/genome/me" },
  { id: "family", label: NAV_LABELS.family, href: "/family" },
  { id: "embryos", label: NAV_LABELS.embryos, href: "/embryos" },
  { id: "settings", label: NAV_LABELS.settings, href: "/settings" },
];

/** Accessible name of both the sidebar and the phone bottom bar. */
export const NAV_LANDMARK_LABEL = "App";

/** Accessible name of the header cluster (theme, account e-mail, sign out). */
export const ACCOUNT_LANDMARK_LABEL = "Account";
