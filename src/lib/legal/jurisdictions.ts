/**
 * The jurisdiction reader (docs/canonical-artifacts.md names this file as the
 * consumer of `data/jurisdictions.json`; brief X12, G5.1b). It answers one
 * question — may this capability run for these accounts? — and returns the
 * status with the register's own user-facing copy, so no surface invents a
 * jurisdiction sentence.
 *
 * Resolution follows `determination.resolutionGrammar.lookupOrder` in the
 * JSON: a committed subdivision answers for itself and never inherits; an
 * alpha-2 country uses its exact override when one is committed and the
 * default real jurisdiction otherwise; an unset, malformed or unregistered
 * code is `unreviewed` (`productionPolicy.missingJurisdictionStatus`). A
 * real `permitted` or `prohibited` decision without its signed review object
 * is read as `unreviewed` (the file's own fail-closed rule). Under
 * `INHERIT_TEST_JURISDICTION=1` every account resolves to the `TEST-LOCAL`
 * row (X12.3); that pseudo-value is never reachable through a real code.
 *
 * `familyCapability` implements G5.1b: the acting account and every
 * contributor are resolved separately and the strictest answer wins, where
 * `prohibited` is stricter than `unreviewed`, which is stricter than
 * `permitted`.
 *
 * The pure functions take codes so they are unit-testable; the account
 * functions read `profiles.jurisdiction_code` through the service-role
 * client and accept an injected reader for tests.
 */
import jurisdictionsJson from "../../../data/jurisdictions.json";
import { createAdminClient } from "@/lib/supabase/admin";

export const CAPABILITY_STATUSES = ["permitted", "prohibited", "unreviewed"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** The capabilities `data/jurisdictions.json` decides, in its order; checked against the file at load. */
export const JURISDICTION_CAPABILITIES = [
  "third_party_adult_analysis",
  "family_heritability",
  "family_portrait",
  "family_portrait_abo",
  "family_portrait_rh",
  "family_portrait_red_hair",
  "family_portrait_lactase_persistence",
  "family_portrait_earwax",
  "embryo_analysis",
  "embryo_single_locus",
  "embryo_statistical_estimate",
  "carrier_match",
] as const;
export type JurisdictionCapability = (typeof JURISDICTION_CAPABILITIES)[number];

export const TEST_JURISDICTION_CODE = "TEST-LOCAL";
export const TEST_JURISDICTION_ENV = "INHERIT_TEST_JURISDICTION";

export type DecisionSource =
  | "test-local"
  | "subdivision"
  | "country"
  | "default"
  | "unset"
  | "unregistered";

export interface CapabilityDecision {
  capability: JurisdictionCapability;
  status: CapabilityStatus;
  /** The file's `userFacingCopy` for the decision that answered. */
  userFacingCopy: string;
  /** The normalised code the decision was resolved for; null when the account has none. */
  jurisdictionCode: string | null;
  source: DecisionSource;
}

interface CapabilityRecord {
  status: string;
  review: unknown;
  userFacingCopy: string;
}

interface JurisdictionEntry {
  displayName?: string;
  capabilities: Record<string, CapabilityRecord | undefined>;
}

export interface JurisdictionsFile {
  statusValues: readonly string[];
  capabilities: readonly string[];
  realJurisdictionCatalog: { codes: readonly string[] };
  defaultRealJurisdiction: JurisdictionEntry;
  realJurisdictions: Record<string, JurisdictionEntry | undefined>;
  testJurisdictions: Record<string, JurisdictionEntry | undefined>;
  productionPolicy: {
    missingCapabilityStatus: string;
    missingJurisdictionStatus: string;
    testPseudoJurisdictionValues: readonly string[];
  };
}

const FILE = jurisdictionsJson as unknown as JurisdictionsFile;

function assertFileShape(file: JurisdictionsFile): void {
  const listed = [...file.capabilities];
  const expected = [...JURISDICTION_CAPABILITIES];
  if (listed.length !== expected.length || listed.some((value, index) => value !== expected[index])) {
    throw new Error(
      `data/jurisdictions.json capabilities differ from JURISDICTION_CAPABILITIES: ${listed.join(", ")}`,
    );
  }
  for (const status of file.statusValues) {
    if (!(CAPABILITY_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`data/jurisdictions.json names an unknown status: ${status}`);
    }
  }
  if (file.productionPolicy.missingJurisdictionStatus !== "unreviewed") {
    throw new Error("data/jurisdictions.json missingJurisdictionStatus must be unreviewed");
  }
  if (!file.productionPolicy.testPseudoJurisdictionValues.includes(TEST_JURISDICTION_CODE)) {
    throw new Error(`data/jurisdictions.json must reserve ${TEST_JURISDICTION_CODE}`);
  }
}

assertFileShape(FILE);

export interface ResolveOptions {
  /** True when the isolated TEST-LOCAL acceptance fixture is enabled; defaults to the environment flag. */
  testJurisdiction?: boolean;
  /** The register to resolve against; defaults to the committed file. Tests inject a synthetic one. */
  data?: JurisdictionsFile;
}

/** `INHERIT_TEST_JURISDICTION=1` enables the TEST-LOCAL row (playwright.config.ts and CI set it). */
export function isTestJurisdictionEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[TEST_JURISDICTION_ENV] === "1";
}

const COUNTRY = /^[A-Z]{2}$/;
const SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/** Trim and upper-case, as the file's normalisation rule says; empty becomes null. */
export function normaliseJurisdictionCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const code = raw.trim().toUpperCase();
  return code.length === 0 ? null : code;
}

function isCapability(value: string): value is JurisdictionCapability {
  return (JURISDICTION_CAPABILITIES as readonly string[]).includes(value);
}

function isStatus(value: string): value is CapabilityStatus {
  return (CAPABILITY_STATUSES as readonly string[]).includes(value);
}

function decisionFrom(
  capability: JurisdictionCapability,
  record: CapabilityRecord | undefined,
  fallback: CapabilityRecord,
  jurisdictionCode: string | null,
  source: DecisionSource,
  requireSignedReview: boolean,
): CapabilityDecision {
  // A missing capability decision is `unreviewed` (missingCapabilityStatus),
  // read with the default row's copy so the sentence is never blank.
  if (!record || !isStatus(record.status)) {
    return {
      capability,
      status: "unreviewed",
      userFacingCopy: fallback.userFacingCopy,
      jurisdictionCode,
      source,
    };
  }
  // A real permitted or prohibited decision is only as good as its signed
  // review object; without one the runtime resolver reads it as unreviewed.
  if (
    requireSignedReview &&
    record.status !== "unreviewed" &&
    (record.review === null || typeof record.review !== "object")
  ) {
    return {
      capability,
      status: "unreviewed",
      userFacingCopy: fallback.userFacingCopy,
      jurisdictionCode,
      source,
    };
  }
  return {
    capability,
    status: record.status,
    userFacingCopy: record.userFacingCopy,
    jurisdictionCode,
    source,
  };
}

/**
 * One account's decision for one capability, from its declared code.
 * Unset → `unreviewed`; under the test flag → the TEST-LOCAL row.
 */
export function resolveCapability(
  jurisdictionCode: string | null | undefined,
  capability: JurisdictionCapability,
  options: ResolveOptions = {},
): CapabilityDecision {
  if (!isCapability(capability)) {
    throw new Error(`Unknown jurisdiction capability: ${String(capability)}`);
  }
  const data = options.data ?? FILE;
  const fallback = data.defaultRealJurisdiction.capabilities[capability];
  if (!fallback) {
    throw new Error(`data/jurisdictions.json has no default decision for ${capability}`);
  }
  const testEnabled = options.testJurisdiction ?? isTestJurisdictionEnabled();

  if (testEnabled) {
    const row = data.testJurisdictions[TEST_JURISDICTION_CODE];
    return decisionFrom(
      capability,
      row?.capabilities[capability],
      fallback,
      TEST_JURISDICTION_CODE,
      "test-local",
      false,
    );
  }

  const code = normaliseJurisdictionCode(jurisdictionCode);
  if (code === null) {
    return decisionFrom(capability, undefined, fallback, null, "unset", true);
  }

  // TEST-LOCAL is handled only by the flag above, never by the real-code
  // grammar; a persisted pseudo-value reads as unregistered.
  if (data.productionPolicy.testPseudoJurisdictionValues.includes(code)) {
    return decisionFrom(capability, undefined, fallback, code, "unregistered", true);
  }

  if (SUBDIVISION.test(code)) {
    const country = code.slice(0, 2);
    const entry = data.realJurisdictions[code];
    if (!data.realJurisdictionCatalog.codes.includes(country) || !entry) {
      return decisionFrom(capability, undefined, fallback, code, "unregistered", true);
    }
    // A committed subdivision answers for itself and never inherits.
    return decisionFrom(capability, entry.capabilities[capability], fallback, code, "subdivision", true);
  }

  if (COUNTRY.test(code) && data.realJurisdictionCatalog.codes.includes(code)) {
    const override = data.realJurisdictions[code];
    const record = override?.capabilities[capability];
    if (override && record) {
      return decisionFrom(capability, record, fallback, code, "country", true);
    }
    return decisionFrom(capability, fallback, fallback, code, "default", true);
  }

  return decisionFrom(capability, undefined, fallback, code, "unregistered", true);
}

const STRICTNESS: Record<CapabilityStatus, number> = {
  permitted: 0,
  unreviewed: 1,
  prohibited: 2,
};

/** The strictest of several decisions; on a tie the earliest wins, so the acting account's copy leads. */
export function strictestDecision(decisions: readonly CapabilityDecision[]): CapabilityDecision {
  if (decisions.length === 0) throw new Error("strictestDecision needs at least one decision");
  let strictest = decisions[0];
  for (const decision of decisions.slice(1)) {
    if (STRICTNESS[decision.status] > STRICTNESS[strictest.status]) strictest = decision;
  }
  return strictest;
}

/**
 * G5.1b over codes: the acting account's code first, then every
 * contributor's. Any `prohibited` or `unreviewed` contributor blocks a
 * permitted actor.
 */
export function familyCapabilityFromCodes(
  viewerCode: string | null | undefined,
  contributorCodes: readonly (string | null | undefined)[],
  capability: JurisdictionCapability,
  options: ResolveOptions = {},
): CapabilityDecision {
  return strictestDecision([
    resolveCapability(viewerCode, capability, options),
    ...contributorCodes.map((code) => resolveCapability(code, capability, options)),
  ]);
}

/** Reads `profiles.jurisdiction_code` for a set of accounts; a missing profile reads as unset. */
export type JurisdictionCodeReader = (
  accountIds: readonly string[],
) => Promise<ReadonlyMap<string, string | null>>;

export const readJurisdictionCodes: JurisdictionCodeReader = async (accountIds) => {
  const codes = new Map<string, string | null>();
  if (accountIds.length === 0) return codes;
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, jurisdiction_code")
    .in("id", [...new Set(accountIds)]);
  if (error) throw new Error(`profiles.jurisdiction_code read failed: ${error.message}`);
  for (const row of data ?? []) codes.set(row.id, row.jurisdiction_code);
  return codes;
};

export interface AccountResolveOptions extends ResolveOptions {
  readJurisdictionCodes?: JurisdictionCodeReader;
}

/** One account's decision for one capability, read from its profile. */
export async function accountCapability(
  accountId: string,
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  const read = options.readJurisdictionCodes ?? readJurisdictionCodes;
  const codes = await read([accountId]);
  return resolveCapability(codes.get(accountId) ?? null, capability, options);
}

/**
 * G5.1b: the strictest decision across the acting account and every
 * contributing account. Every account's own declaration is read; nothing is
 * inferred from another account's code.
 */
export async function familyCapability(
  viewerAccountId: string,
  contributorAccountIds: readonly string[],
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  const read = options.readJurisdictionCodes ?? readJurisdictionCodes;
  const codes = await read([viewerAccountId, ...contributorAccountIds]);
  return familyCapabilityFromCodes(
    codes.get(viewerAccountId) ?? null,
    contributorAccountIds.map((id) => codes.get(id) ?? null),
    capability,
    options,
  );
}
