/**
 * Overview (`/overview`) copy — every user-visible string on the page, in one
 * place (docs/route-register.json → navigationContract.overviewBoxContract,
 * copySource src/copy/overview.ts). Strings ship character-for-character:
 * typographic apostrophes (U+2019), sentence case, second person, grade ≤ 9.
 *
 * Counts are pluralised with Intl.PluralRules("en") and carry an explicit
 * singular form ("1 embryo file added"), never "1 files".
 */
import { NAV_LABELS } from "./navigation";
import { LAYER_DEFINITIONS, NOT_DIAGNOSTIC } from "./reports/strings";

const plural = new Intl.PluralRules("en");

function one(n: number): boolean {
  return plural.select(n) === "one";
}

/** Nav label and page h1 are the same string (identity rule). */
export const OVERVIEW_H1 = NAV_LABELS.overview;

/**
 * `/example/report` (brief X1.3, §8 A31) does not exist yet. The third
 * "Start here" item links there, so it renders only once the route ships;
 * flip this to true in the change that adds `src/app/(marketing)/example/`.
 * A dead link is never shipped.
 */
export const EXAMPLE_ROUTES_AVAILABLE = false;

/**
 * `/copilot/[scope]` today resolves only `me` and `s-{uuid}` subject scopes
 * (src/app/(app)/copilot/[scope]/page.tsx → resolveSubjectForAccount); the
 * `family` and `{cohort}` scopes the register names return 404. Until the
 * Copilot page serves them, the Family and Embryos Copilot boxes link to
 * their domain landing (the blocking state) instead of a dead route.
 */
export const COPILOT_GROUP_SCOPES_AVAILABLE = false;

export const STATE_A_LEDE =
  "Inherit is free to use and sells nothing. Sequencing, if you need it, is bought from a provider directly.";

export interface StartHereItem {
  id: "have-file" | "no-file" | "example";
  label: string;
  description: string;
  href: string;
}

export const START_HERE: { heading: string; items: readonly StartHereItem[] } = {
  heading: "Start here",
  items: [
    {
      id: "have-file",
      label: "I have a DNA file",
      description:
        "A 23andMe, AncestryDNA, MyHeritage or FamilyTreeDNA download, or a VCF from a lab.",
      href: "/files/upload",
    },
    {
      id: "no-file",
      label: "I don’t have one yet",
      description:
        "Find a sequencing provider. You buy from them directly; Inherit takes no cut.",
      href: "/providers",
    },
    {
      id: "example",
      label: "Show me what this looks like first",
      description: "Read a complete example report. No account data needed.",
      href: "/example/report",
    },
  ],
};

/** The Start-here items that may render today (see EXAMPLE_ROUTES_AVAILABLE). */
export function startHereItems(): readonly StartHereItem[] {
  return START_HERE.items.filter(
    (item) => item.id !== "example" || EXAMPLE_ROUTES_AVAILABLE,
  );
}

export type DomainId = "my-genome" | "family" | "embryos";

export interface DomainSectionCopy {
  id: DomainId;
  /** The h2 — identical to the nav label. */
  heading: string;
  /** One line under the h2 in State A (≥ 80 characters of non-heading copy). */
  lede: string;
}

export const DOMAIN_SECTIONS: readonly DomainSectionCopy[] = [
  {
    id: "my-genome",
    heading: NAV_LABELS["my-genome"],
    lede:
      "Reports about you, where your ancestors came from, and a Copilot that answers from your own data.",
  },
  {
    id: "family",
    heading: NAV_LABELS.family,
    lede:
      "Add another adult with their permission, compare risks side by side, and see what two genomes mean for a future child.",
  },
  {
    id: "embryos",
    heading: NAV_LABELS.embryos,
    lede:
      "Upload the genetic files an IVF laboratory returned to you and compare embryos honestly.",
  },
];

export type EntryBoxId =
  | "my-genome.reports"
  | "my-genome.ancestry"
  | "my-genome.copilot"
  | "family.individual-risks"
  | "family.portrait"
  | "family.copilot"
  | "embryos.upload"
  | "embryos.compare"
  | "embryos.copilot";

export interface EntryBoxCopy {
  id: EntryBoxId;
  domain: DomainId;
  /** Exactly the accessible name of the box link. */
  label: string;
  /** One line, ≤ 12 words, plain words. */
  description: string;
  /**
   * Static route, or null when the page resolves the target on the server
   * (a person, a pair, a cohort) and falls back to the domain landing.
   */
  href: string | null;
}

export const ENTRY_BOXES: readonly EntryBoxCopy[] = [
  {
    id: "my-genome.reports",
    domain: "my-genome",
    label: "Reports",
    description: "What your own file can show, one report at a time.",
    href: "/genome/me/reports",
  },
  {
    id: "my-genome.ancestry",
    domain: "my-genome",
    label: "Ancestry",
    description: "Broad world regions where DNA like yours is common.",
    href: "/genome/me/ancestry",
  },
  {
    id: "my-genome.copilot",
    domain: "my-genome",
    label: "Copilot",
    description: "Ask questions in plain words, answered from your own data.",
    href: "/copilot/me",
  },
  {
    id: "family.individual-risks",
    domain: "family",
    label: "Individual risks",
    description: "Each adult’s own reports, side by side, never merged.",
    href: null,
  },
  {
    id: "family.portrait",
    domain: "family",
    label: "Portrait",
    description: "What two DNA files could mean for a future child.",
    href: null,
  },
  {
    id: "family.copilot",
    domain: "family",
    label: "Copilot",
    description: "Ask questions across the people in your family view.",
    href: null,
  },
  {
    id: "embryos.upload",
    domain: "embryos",
    label: "Upload",
    description: "Add the files an IVF laboratory returned to you.",
    href: "/embryos/upload",
  },
  {
    id: "embryos.compare",
    domain: "embryos",
    label: "Compare your embryos",
    description: "Look at each file side by side, without ranking.",
    href: "/embryos/compare",
  },
  {
    id: "embryos.copilot",
    domain: "embryos",
    label: "Copilot",
    description: "Ask questions about the files your laboratory sent.",
    href: null,
  },
];

/** Primary-button labels, one per state. */
export const PRIMARY = {
  /** State A — the first Start-here item. */
  haveFile: START_HERE.items[0].label,
  /** State B. */
  addFile: "Add a file",
  /** States C and D. */
  openReports: "Open my reports",
  /** State E. */
  compareEmbryos: "Compare your embryos",
} as const;

export const STATE_B = {
  processing: (name: string) => `Processing ${name}`,
  notEnough:
    "This deployment has not processed enough files to estimate a time yet.",
  timing: (p50: string, p95: string) =>
    `Most files like this finish in about ${p50}. Nine in ten finish within ${p95}.`,
  steps: [
    "Checking the file",
    "Reading your DNA spots",
    "Matching to the current map",
    "Building your reports",
    "Done",
  ],
} as const;

export const STATE_C = {
  justYou: "Just you so far.",
  noEmbryoFiles: "No embryo files added.",
  openReports: PRIMARY.openReports,
  ancestryFound: (k: number) =>
    one(k) ? "Ancestry: 1 region found" : `Ancestry: ${k} regions found`,
  ancestryNote: "Places where DNA like yours is common.",
  ancestryTooFew:
    "Ancestry: your file covers too few markers to estimate regions.",
} as const;

export const STATE_D = {
  more: (n: number) => `+${n} more`,
  peopleNote: "People in your family view.",
  /** Kind chip next to a person's name. */
  sharedWithYou: "Shared with you",
  uploadedWithPermission: "Uploaded with their permission",
} as const;

export const STATE_E = {
  filesAdded: (n: number) =>
    one(n) ? "1 embryo file added" : `${n} embryo files added`,
  filesAddedNote: "Files an IVF laboratory sent you.",
  passed: (p: number) => `${p} passed the quality check`,
  passedNote: "Enough data to read reliably.",
  notMeasured: (q: number) => `${q} could not be measured`,
  notMeasuredNote: "Kept and shown, with the reason.",
  compareEmbryos: PRIMARY.compareEmbryos,
} as const;

export const STARTER = {
  five: "Five reports to read first. They’re the clearest ones your file supports.",
  some: (n: number) =>
    one(n)
      ? "1 report to read first. It’s the clearest one your file supports."
      : `${n} reports to read first. They’re the clearest ones your file supports.`,
  none: "Your file doesn’t cover any of the starter reports. Browse the full library.",
  // "You’ve read the starter set. Browse the full library." is not shipped:
  // nothing records which reports were opened, so the sentence could not be
  // true. Add it with the view-tracking change, never before.
} as const;

/** The split-string halves (brief §4 §1.4): never summed, never merged. */
export const SPLIT = {
  estimates: (p: number) =>
    one(p) ? "1 statistical estimate" : `${p} statistical estimates`,
  variantCalls: (m: number) =>
    one(m) ? "1 specific-variant report" : `${m} specific-variant reports`,
} as const;

export const SPLIT_NOTE = "Statistical estimates from many small effects.";

/** The X5.1 definition sentence, from its one home in src/copy/reports/strings.ts. */
export const ESTIMATE_DEFINITION = LAYER_DEFINITIONS.estimate;

export const VARIANT_CALL_NOTE = "One DNA position, read directly from your file.";

/** The one §5 §6.1 line, re-exported from its home so Overview and the reports share a single string. */
export { NOT_DIAGNOSTIC };
