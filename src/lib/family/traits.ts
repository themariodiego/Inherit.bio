import allowlistJson from "../../../data/family-trait-allowlist.json";

/**
 * The Portrait trait allowlist reader (design §2.5; brief X10.1 line 2480,
 * G5.9(c) line 2650, §3 §8.4 line 1014, §4 §5.3 line 1351).
 *
 * `data/family-trait-allowlist.json` is the one home of what Portrait may
 * show as a trait (`docs/canonical-artifacts.md`); this module is its typed
 * consumer and restates none of its contents. The five keys are fixed by the
 * brief, so they are typed here as a closed union and the reader refuses a
 * file whose keys differ. The denied patterns come from the file too, so the
 * gate in `traits.test.ts` and the runtime check read the same list.
 *
 * A trait is `registered` only when the file carries both a genotype-to-
 * phenotype table citation and an accuracy citation for it. Today no
 * `data/citations.json` exists, so every trait is `unregistered` and the
 * file's own status says the registry is withheld. Nothing here computes a
 * trait: it answers which traits exist and whether each may render.
 */

/** The five keys, exactly (brief X10.1). */
export const TRAIT_KEYS = ["abo", "rh", "red_hair", "lactase_persistence", "earwax"] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

/** The non-trait class the same constraint admits: recessive and X-linked carrier arithmetic. */
export const CARRIER_ARITHMETIC_KEY = "carrier_arithmetic" as const;

export const TRAIT_EVIDENCE = ["clinical", "established"] as const;
export type TraitEvidence = (typeof TRAIT_EVIDENCE)[number];

export const TRAIT_RENDERINGS = ["exact-fraction", "band-with-interval"] as const;
export type TraitRendering = (typeof TRAIT_RENDERINGS)[number];

export const TRAIT_STATUSES = ["unregistered", "registered"] as const;
export type TraitStatus = (typeof TRAIT_STATUSES)[number];

export interface TraitEntry {
  key: TraitKey;
  layer: "variant_call";
  /** Null until a source exists: no evidence level is asserted without one. */
  evidence: TraitEvidence | null;
  rendering: TraitRendering;
  genotypePhenotypeTableCitationId: string | null;
  accuracyCitationId: string | null;
  status: TraitStatus;
}

export interface TraitAllowlist {
  status: string;
  deniedKeyPatterns: readonly string[];
  traits: Record<TraitKey, TraitEntry>;
}

/**
 * The database's own refusal on `portrait_results.trait_key`
 * (`supabase/migrations/20260831224126_reference_registries_and_constraints.sql`),
 * mirrored so a key the table would reject is refused before any write.
 */
export const PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN = /(intelligence|cognitive|iq|education|success)/i;

export function isTraitKey(value: string): value is TraitKey {
  return (TRAIT_KEYS as readonly string[]).includes(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function citationId(value: unknown, field: string, key: string): string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new Error(`family-trait-allowlist: ${key}.${field} must be null or a non-empty citation id`);
}

function readEntry(key: TraitKey, raw: unknown): TraitEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`family-trait-allowlist: ${key} is not an object`);
  }
  const entry = raw as Record<string, unknown>;
  if (entry.layer !== "variant_call") {
    throw new Error(`family-trait-allowlist: ${key}.layer must be "variant_call"`);
  }
  if (entry.evidence !== null && !isOneOf(TRAIT_EVIDENCE, entry.evidence)) {
    throw new Error(`family-trait-allowlist: ${key}.evidence must be null, "clinical" or "established"`);
  }
  if (!isOneOf(TRAIT_RENDERINGS, entry.rendering)) {
    throw new Error(`family-trait-allowlist: ${key}.rendering must be one of ${TRAIT_RENDERINGS.join(", ")}`);
  }
  if (!isOneOf(TRAIT_STATUSES, entry.status)) {
    throw new Error(`family-trait-allowlist: ${key}.status must be one of ${TRAIT_STATUSES.join(", ")}`);
  }
  const genotypePhenotypeTableCitationId = citationId(
    entry.genotype_phenotype_table_citation_id,
    "genotype_phenotype_table_citation_id",
    key,
  );
  const accuracyCitationId = citationId(entry.accuracy_citation_id, "accuracy_citation_id", key);
  // A registered trait must carry both sources and an evidence level; an
  // entry that claims registration without them is a defect, not a trait.
  if (
    entry.status === "registered" &&
    (genotypePhenotypeTableCitationId === null || accuracyCitationId === null || entry.evidence === null)
  ) {
    throw new Error(
      `family-trait-allowlist: ${key} is registered but lacks a citation or an evidence level`,
    );
  }
  return {
    key,
    layer: "variant_call",
    evidence: entry.evidence,
    rendering: entry.rendering,
    genotypePhenotypeTableCitationId,
    accuracyCitationId,
    status: entry.status,
  };
}

/** True when the key names, or contains, a class the brief denies (line 1014, X10.1). */
export function isDeniedTraitKey(key: string, patterns: readonly string[] = DENIED_KEY_PATTERNS): boolean {
  const lower = key.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern)) || PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN.test(key);
}

/**
 * Reads and validates the allowlist. Throws on any key outside the five, on
 * a missing key, on a denied key, and on a registered entry without both
 * citations — so a file that drifts fails at import time, before any page.
 */
export function readTraitAllowlist(source: unknown = allowlistJson): TraitAllowlist {
  if (typeof source !== "object" || source === null) {
    throw new Error("family-trait-allowlist: not an object");
  }
  const file = source as Record<string, unknown>;
  if (typeof file.status !== "string" || file.status.trim() === "") {
    throw new Error("family-trait-allowlist: status must be a non-empty string");
  }
  if (
    !Array.isArray(file.denied_key_patterns) ||
    file.denied_key_patterns.some((pattern) => typeof pattern !== "string" || pattern === "")
  ) {
    throw new Error("family-trait-allowlist: denied_key_patterns must be a list of non-empty strings");
  }
  const deniedKeyPatterns = file.denied_key_patterns as string[];
  if (typeof file.traits !== "object" || file.traits === null) {
    throw new Error("family-trait-allowlist: traits must be an object");
  }
  const rawTraits = file.traits as Record<string, unknown>;
  const keys = Object.keys(rawTraits);
  for (const key of keys) {
    if (!isTraitKey(key)) throw new Error(`family-trait-allowlist: "${key}" is outside the closed list`);
    if (isDeniedTraitKey(key, deniedKeyPatterns)) {
      throw new Error(`family-trait-allowlist: "${key}" matches a denied class`);
    }
  }
  for (const key of TRAIT_KEYS) {
    if (!(key in rawTraits)) throw new Error(`family-trait-allowlist: "${key}" is missing`);
  }
  const traits = {} as Record<TraitKey, TraitEntry>;
  for (const key of TRAIT_KEYS) traits[key] = readEntry(key, rawTraits[key]);
  return { status: file.status, deniedKeyPatterns, traits };
}

/** The denied patterns, from the file (the one home). */
export const DENIED_KEY_PATTERNS: readonly string[] = (allowlistJson as { denied_key_patterns: string[] })
  .denied_key_patterns;

const ALLOWLIST = readTraitAllowlist();

/** The file's own status line, rendered as the reason every trait card shows nothing. */
export const ALLOWLIST_STATUS = ALLOWLIST.status;

export function traitEntry(key: TraitKey): TraitEntry {
  return ALLOWLIST.traits[key];
}

/** `registered` only when the file carries both citations for the trait. */
export function traitStatus(key: TraitKey): TraitStatus {
  return ALLOWLIST.traits[key].status;
}

/** The keys in the file's order, for a page that renders one card per trait. */
export function listTraitEntries(): TraitEntry[] {
  return TRAIT_KEYS.map((key) => ALLOWLIST.traits[key]);
}
