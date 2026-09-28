/**
 * Primary navigation copy — the single source for the five nav labels and
 * for the h1 identity rule: each label is character-identical to the `h1`
 * of its destination (docs/route-register.json →
 * navigationContract.primaryHeadingContract, copySource src/copy/navigation.ts).
 *
 * Exactly five items, in this order. No sixth item without removing one.
 * Each href is built from its route id (src/lib/primary-routes.ts), never
 * spelled here.
 */
import { route } from "@/lib/primary-routes";

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
  { id: "overview", label: NAV_LABELS.overview, href: route("app.overview") },
  {
    id: "my-genome",
    label: NAV_LABELS["my-genome"],
    href: route("genome.subject", { subject: "me" }),
  },
  { id: "family", label: NAV_LABELS.family, href: route("family.index") },
  { id: "embryos", label: NAV_LABELS.embryos, href: route("embryos.index") },
  { id: "settings", label: NAV_LABELS.settings, href: route("settings.index") },
];

/** Accessible name of both the sidebar and the phone bottom bar. */
export const NAV_LANDMARK_LABEL = "App";

/** Accessible name of the header cluster (theme, account e-mail, sign out). */
export const ACCOUNT_LANDMARK_LABEL = "Account";

/**
 * The public rights links (docs/route-register.json →
 * navigationContract.publicRightsReachability). A person with no account
 * reaches each one in the registered number of actions from the home page:
 * the three in the persistent public footer are one action away, and the two
 * on the legal index are two. Labels and copy ids are the register's own, and
 * each href is built from the register's route id.
 */
export const PUBLIC_RIGHTS_FOOTER_HEADING = "Your rights";

export const PUBLIC_RIGHTS_FOOTER = [
  {
    copyId: "navigation.rights.someone-uploaded-my-dna",
    label: "Someone uploaded my DNA",
    routeId: "rights.subject-access",
    href: route("rights.subject-access"),
  },
  {
    copyId: "navigation.rights.future-person-claim",
    label: "I was born from an analysed embryo",
    routeId: "rights.future-person-claim",
    href: route("rights.future-person-claim"),
  },
  {
    copyId: "navigation.rights.data-retention",
    label: "Data rights and retention",
    routeId: "legal.index",
    href: route("legal.index"),
  },
] as const;

export const LEGAL_INDEX_RIGHTS = [
  {
    copyId: "legal.index.access-object-delete",
    label: "Access, object or delete data about me",
    routeId: "rights.subject-access",
    href: route("rights.subject-access"),
  },
  {
    copyId: "legal.index.future-person-claim",
    label: "Claim a future-person record",
    routeId: "rights.future-person-claim",
    href: route("rights.future-person-claim"),
  },
] as const;
