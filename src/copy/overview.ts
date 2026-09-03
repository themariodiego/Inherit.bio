/**
 * Overview (`/overview`) copy — every user-visible string on the page, in one
 * place (docs/route-register.json → navigationContract.overviewBoxContract,
 * copySource src/copy/overview.ts). Strings ship character-for-character:
 * typographic apostrophes (U+2019), sentence case, second person, grade ≤ 9.
 *
 * Counts are pluralised with Intl.PluralRules("en") and carry an explicit
 * singular form ("1 embryo file added"), never "1 files". The split report
 * counts ("151 statistical estimates", "1 specific-variant report") are not
 * defined here: their one home is countText in src/components/reports/count.tsx.
 */
import { route } from "@/lib/primary-routes";
import { NAV_LABELS } from "./navigation";
import { ADD_A_FILE, LAYER_DEFINITIONS, NOT_DIAGNOSTIC } from "./reports/strings";

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
      href: route("files.upload"),
    },
    {
      id: "no-file",
      label: "I don’t have one yet",
      description:
        "Find a sequencing provider. You buy from them directly; Inherit takes no cut.",
      href: route("marketing.providers"),
    },
    {
      id: "example",
      label: "Show me what this looks like first",
      description: "Read a complete example report. No account data needed.",
      // The example route has no id in docs/route-register.json yet, so it
      // cannot come from src/lib/primary-routes.ts; the literal stays until
      // the route is registered, and EXAMPLE_ROUTES_AVAILABLE gates it off.
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
    href: route("genome.reports", { subject: "me" }),
  },
  {
    id: "my-genome.ancestry",
    domain: "my-genome",
    label: "Ancestry",
    description: "Broad world regions where DNA like yours is common.",
    href: route("genome.ancestry", { subject: "me" }),
  },
  {
    id: "my-genome.copilot",
    domain: "my-genome",
    label: "Copilot",
    description: "Ask questions in plain words, answered from your own data.",
    href: route("copilot.scope", { scope: "me" }),
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
    href: route("embryos.upload"),
  },
  {
    id: "embryos.compare",
    domain: "embryos",
    label: "Compare your embryos",
    description: "Look at each file side by side, without ranking.",
    href: route("embryos.compare"),
  },
  {
    id: "embryos.copilot",
    domain: "embryos",
    label: "Copilot",
    description: "Ask questions about the files your laboratory sent.",
    href: null,
  },
];

/**
 * Primary-button labels, one per state. Each label that also names something
 * elsewhere is read from that one home rather than restated.
 */
export const PRIMARY = {
  /** State A — the first Start-here item. */
  haveFile: START_HERE.items[0].label,
  /** State B — the same words as the subject bar's secondary action. */
  addFile: ADD_A_FILE,
  /** States C and D. */
  openReports: "Open my reports",
  /** State E — the label of the Compare box. */
  compareEmbryos: ENTRY_BOXES.find((box) => box.id === "embryos.compare")!.label,
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
  /**
   * The only ancestry line Overview renders, and only when an admixture
   * result exists with too few usable markers (D26). "{k} regions found" is
   * not shipped: no region count exists that could make it true.
   */
  ancestryTooFew:
    "Ancestry: your file covers too few markers to estimate regions.",
} as const;

/** The kind chip beside a person's name is KIND_CHIPS (reports/strings), as on the subject bar. */
export const STATE_D = {
  more: (n: number) => `+${n} more`,
  peopleNote: "People in your family view.",
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

/** The note beside the estimate half of the split string (brief §4 §1.4). */
export const SPLIT_NOTE = "Statistical estimates from many small effects.";

/**
 * The variant-call half's 1–12-word note (X9.1 caps every metric note at
 * twelve words; the mandated definition is 18 and renders adjacent, exactly
 * as the estimate half does). Shortened from the definition, not invented.
 */
export const SPLIT_NOTE_VARIANT_CALL = "Results read from one spot in your DNA.";

export const VARIANT_CALL_DEFINITION = LAYER_DEFINITIONS.variant_call;

/**
 * The X5.1 definition sentence, from its one home in src/copy/reports/strings.ts.
 * The variant-call half reads LAYER_DEFINITIONS.variant_call from the same home.
 */
export const ESTIMATE_DEFINITION = LAYER_DEFINITIONS.estimate;

/** The one §5 §6.1 line, re-exported from its home so Overview and the reports share a single string. */
export { NOT_DIAGNOSTIC };
