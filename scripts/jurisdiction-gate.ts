// CI gate: the structural half of G5.5's human-review gate.
//
// `data/jurisdictions.json` specifies a `signedReviewContract` in detail and
// nothing enforced it. The runtime resolver in `src/lib/legal/jurisdictions.ts`
// fails closed - a `permitted` or `prohibited` decision without a review object
// reads as `unreviewed` - but that is all it can do: it cannot read the
// filesystem for the markdown record, cannot check the ten required fields, and
// should not try. So a decision could carry a `review` that is an empty object,
// or name a record that does not exist, and the product would refuse the
// capability while the file claimed somebody had approved it.
//
// This gate is the half that reads the tree. It exists BEFORE any real
// determination does, which is deliberate: the moment someone qualified
// supplies one, its completeness is enforced rather than assumed, and until
// then the invariants that make "default deny" true are held.
//
// WHAT THIS GATE DELIBERATELY DOES NOT DO, recorded rather than left as a
// silent gap. `signedReviewContract.referentialValidation` also requires that
// `gitSha` resolve to an ancestor commit, that `data/jurisdictions.json` be
// re-read AT that commit, that `scope` resolve there as an RFC 6901 pointer,
// and that the reviewed decision deep-compare with the candidate one. Those are
// checks on the history of a determination, and there are zero determinations:
// implementing them now would mean writing and testing git archaeology against
// no real input, which is how a check ends up passing because it never ran.
// They are listed in UNIMPLEMENTED below and this gate reports them on every
// run, so the shortfall is visible rather than forgotten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DATA = "data/jurisdictions.json";
const REVIEW_ROOT = "docs/reviews/jurisdictions";

/** Named here so a reader of the pass line sees what is still owed. */
export const UNIMPLEMENTED = [
  "gitSha ancestry: resolve the sha to one commit and require it to name an ancestor of the candidate",
  "reviewed-at-sha comparison: re-read the file at gitSha, resolve scope as a JSON Pointer, and deep-compare the decision with the review member removed from both",
] as const;

export interface JurisdictionGateResult {
  failures: string[];
  warnings: string[];
  capabilityCount: number;
  catalogCodeCount: number;
  realJurisdictionCount: number;
  reviewedDecisionCount: number;
  checkedDateCount: number;
  oldestDateAgeDays: number;
}

interface Decision {
  status?: unknown;
  accessedOn?: unknown;
  review?: unknown;
  [key: string]: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Strict Gregorian YYYY-MM-DD; anything else is a failure, never a guess. */
export function parseStrictDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function elapsedDays(from: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - from.getTime()) / 86_400_000);
}

/** Leading YAML front matter, parsed flatly: `key: value` only, no aliases,
 * no nesting, duplicate keys rejected. The contract says every value is a
 * string, so a parser that can do more than that can be wrong in more ways. */
export function frontMatter(source: string): Record<string, string> | string {
  if (!source.startsWith("---\n")) return "no leading front matter";
  const end = source.indexOf("\n---", 3);
  if (end === -1) return "front matter is not terminated";
  const body = source.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) return `front-matter line is not key: value: ${line}`;
    const key = line.slice(0, at).trim();
    if (key in fields) return `duplicate front-matter key: ${key}`;
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

export function runJurisdictionGate(
  repositoryRoot: string,
  asOfDate?: string,
): JurisdictionGateResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const read = (relative: string) =>
    fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

  const file = JSON.parse(read(DATA)) as Record<string, unknown>;
  const capabilities = (file.capabilities ?? []) as string[];
  const statuses = (file.statusValues ?? []) as string[];
  const catalog = ((file.realJurisdictionCatalog ?? {}) as Record<string, unknown>).codes as
    | string[]
    | undefined;
  const realJurisdictions = (file.realJurisdictions ?? {}) as Record<string, Decision>;
  const testJurisdictions = (file.testJurisdictions ?? {}) as Record<string, Record<string, unknown>>;
  const defaults = ((file.defaultRealJurisdiction ?? {}) as Record<string, unknown>)
    .capabilities as Record<string, Decision> | undefined;
  const contract = (file.signedReviewContract ?? {}) as Record<string, unknown>;
  const reference = (contract.referenceObject ?? {}) as Record<string, unknown>;
  const requiredFields = (reference.requiredFields ?? []) as string[];
  const markdown = (contract.markdownRecord ?? {}) as Record<string, unknown>;
  const frontMatterFields = (markdown.frontMatterFields ?? []) as string[];
  const freshness = (file.freshnessContract ?? {}) as Record<string, number | string>;
  const warnAfter = Number(freshness.warnAfterDays ?? 300);
  const failAbove = Number(freshness.failAboveDays ?? 365);

  const asOf = parseStrictDate(asOfDate ?? new Date().toISOString().slice(0, 10));
  if (!asOf) {
    failures.push(`freshness: asOfDate ${asOfDate} is not a strict Gregorian YYYY-MM-DD date`);
  }

  // --- Default deny, which is the whole basis of G5.5 -----------------------
  for (const [capability, decision] of Object.entries(defaults ?? {})) {
    if (decision.status !== "unreviewed") {
      failures.push(
        `default deny: defaultRealJurisdiction capability ${capability} is ${String(decision.status)}; ` +
          `every capability every unreviewed code falls through to must be unreviewed`,
      );
    }
  }

  // --- The test pseudo-jurisdiction never reaches production ----------------
  for (const [code, row] of Object.entries(testJurisdictions)) {
    if (row.productionAllowed !== false) {
      failures.push(`test jurisdiction ${code} must declare productionAllowed false`);
    }
  }

  // --- Every signed decision, against the contract it claims to satisfy -----
  let reviewedDecisionCount = 0;
  const dates: { where: string; value: unknown }[] = [
    { where: "/accessedAt", value: file.accessedAt },
    {
      where: "/realJurisdictionCatalog/snapshotAccessedOn",
      value: ((file.realJurisdictionCatalog ?? {}) as Record<string, unknown>).snapshotAccessedOn,
    },
  ];
  for (const [group, rows] of [
    ["unrestrictedCapabilities", file.unrestrictedCapabilities],
    ["defaultRealJurisdiction/capabilities", defaults],
  ] as const) {
    for (const [capability, decision] of Object.entries((rows ?? {}) as Record<string, Decision>)) {
      dates.push({ where: `/${group}/${capability}/accessedOn`, value: decision.accessedOn });
    }
  }

  for (const [code, row] of Object.entries(realJurisdictions)) {
    const rowCapabilities = (row.capabilities ?? {}) as Record<string, Decision>;
    const missing = capabilities.filter((capability) => !(capability in rowCapabilities));
    if (missing.length > 0) {
      failures.push(
        `coverage: realJurisdictions/${code} decides ${Object.keys(rowCapabilities).length} of ` +
          `${capabilities.length} capabilities; missing ${missing.join(", ")}`,
      );
    }
    for (const [capability, decision] of Object.entries(rowCapabilities)) {
      const at = `/realJurisdictions/${code}/capabilities/${capability}`;
      dates.push({ where: `${at}/accessedOn`, value: decision.accessedOn });
      if (!statuses.includes(String(decision.status))) {
        failures.push(`${at}: status ${String(decision.status)} is not one of ${statuses.join(", ")}`);
        continue;
      }
      if (decision.status === "unreviewed") {
        if (decision.review !== null) {
          failures.push(`${at}: an unreviewed decision must carry review null`);
        }
        continue;
      }
      reviewedDecisionCount++;
      const review = decision.review;
      if (!isPlainObject(review)) {
        failures.push(
          `${at}: status ${String(decision.status)} requires the signed review reference object, not ` +
            `${review === null ? "null" : typeof review}`,
        );
        continue;
      }
      const present = Object.keys(review);
      for (const field of requiredFields) {
        if (!present.includes(field)) failures.push(`${at}: review is missing ${field}`);
      }
      for (const field of present) {
        if (!requiredFields.includes(field)) {
          failures.push(`${at}: review carries ${field}, and additionalFields is reject`);
        }
      }

      // Never trust the reference values as lookup input: both are computed.
      const expectedPath = `${REVIEW_ROOT}/${code}/${capability}.md`;
      const expectedScope = `/realJurisdictions/${code}/capabilities/${capability}`;
      if (review.path !== expectedPath) {
        failures.push(`${at}: review.path is ${String(review.path)}; computed ${expectedPath}`);
      }
      if (review.scope !== expectedScope) {
        failures.push(`${at}: review.scope is ${String(review.scope)}; computed ${expectedScope}`);
      }
      if (review.jurisdiction !== code) {
        failures.push(`${at}: review.jurisdiction is ${String(review.jurisdiction)}; containing key is ${code}`);
      }
      if (review.capability !== capability) {
        failures.push(`${at}: review.capability is ${String(review.capability)}; containing key is ${capability}`);
      }
      if (review.status !== decision.status) {
        failures.push(`${at}: review.status ${String(review.status)} does not equal the decision status`);
      }
      if (review.outcome !== "approved") {
        failures.push(`${at}: review.outcome must be the exact string approved`);
      }
      if (typeof review.gitSha !== "string" || !/^[0-9a-f]{40}$/.test(review.gitSha)) {
        failures.push(`${at}: review.gitSha must be a full 40-character lowercase sha`);
      }
      for (const field of ["reviewer", "qualification"] as const) {
        if (typeof review[field] !== "string" || review[field].trim() === "") {
          failures.push(`${at}: review.${field} must be a non-empty string`);
        }
      }
      if (!parseStrictDate(review.reviewedOn)) {
        failures.push(`${at}: review.reviewedOn must be a strict Gregorian YYYY-MM-DD date`);
      } else {
        dates.push({ where: `${at}/review/reviewedOn`, value: review.reviewedOn });
      }

      // The record itself, on disk.
      const recordPath = path.join(repositoryRoot, expectedPath);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(recordPath);
      } catch {
        failures.push(`${at}: no signed record at ${expectedPath}`);
      }
      if (stat && !stat.isFile()) {
        failures.push(`${at}: ${expectedPath} is not a regular file`);
      } else if (stat) {
        const source = fs.readFileSync(recordPath, "utf8");
        const parsed = frontMatter(source);
        if (typeof parsed === "string") {
          failures.push(`${expectedPath}: ${parsed}`);
        } else {
          for (const field of frontMatterFields) {
            if (!(field in parsed)) failures.push(`${expectedPath}: front matter is missing ${field}`);
          }
          for (const field of Object.keys(parsed)) {
            if (!frontMatterFields.includes(field)) {
              failures.push(`${expectedPath}: front matter carries ${field}, which is rejected`);
            }
          }
          for (const field of frontMatterFields) {
            if (field in parsed && String(review[field]) !== parsed[field]) {
              failures.push(
                `${expectedPath}: front-matter ${field} is ${parsed[field]} and the review says ` +
                  `${String(review[field])}; they must be exactly equal`,
              );
            }
          }
        }
        const lines = source.split("\n").filter((line) => line.trim() !== "");
        const signature = `Signed-off-by: ${String(review.reviewer)}`;
        if (lines.at(-1) !== signature) {
          failures.push(`${expectedPath}: the final non-blank line must be exactly "${signature}"`);
        }
      }
    }
  }

  // --- Freshness, on every declared date ------------------------------------
  let oldest = 0;
  let checked = 0;
  for (const { where, value } of dates) {
    const parsed = parseStrictDate(value);
    if (!parsed) {
      failures.push(`freshness: ${where} is ${String(value)}, which is not a strict YYYY-MM-DD date`);
      continue;
    }
    if (!asOf) continue;
    const age = elapsedDays(parsed, asOf);
    checked++;
    if (age < 0) {
      failures.push(`freshness: ${where} is ${String(value)}, which is in the future`);
      continue;
    }
    oldest = Math.max(oldest, age);
    if (age > failAbove) {
      failures.push(`freshness: ${where} is ${age} days old; ${failAbove} is the limit`);
    } else if (age > warnAfter) {
      warnings.push(`freshness: ${where} is ${age} days old; it warns above ${warnAfter}`);
    }
  }

  // --- The register coupling: this list decides which routes may say n/a ----
  //
  // `docs/route-register.json` gives `/files`, `/files/upload` and
  // `/copilot/[scope]` the `own-product-result` profile, whose `notApplicable`
  // for `jurisdiction-unavailable` rests on one fact: every restricted
  // capability here is a Family or Embryo Analysis one, and those three routes
  // surface none of them. G2.2 permits that n/a only while the fact holds.
  //
  // A floor of "at least 12" cannot protect it — a THIRTEENTH capability
  // passes a floor and silently invalidates three declarations. So the list is
  // pinned exactly. If this fails, do not edit the array to match: read the new
  // capability, decide whether any of those three routes surfaces it, and move
  // them back to `product-result` if so. The failure is the question being
  // asked, not a chore.
  const PINNED_CAPABILITIES = [
    "third_party_adult_analysis", "family_heritability", "family_portrait",
    "family_portrait_abo", "family_portrait_rh", "family_portrait_red_hair",
    "family_portrait_lactase_persistence", "family_portrait_earwax",
    "embryo_analysis", "embryo_single_locus", "embryo_statistical_estimate",
    "carrier_match",
  ];
  if (JSON.stringify(capabilities) !== JSON.stringify(PINNED_CAPABILITIES)) {
    const added = capabilities.filter((capability) => !PINNED_CAPABILITIES.includes(capability));
    const gone = PINNED_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
    failures.push(
      "restricted capabilities changed, which decides whether /files, /files/upload and " +
        "/copilot/[scope] may declare jurisdiction-unavailable not-applicable" +
        (added.length > 0 ? `; added ${added.join(", ")}` : "") +
        (gone.length > 0 ? `; removed ${gone.join(", ")}` : "") +
        (added.length === 0 && gone.length === 0 ? "; the order differs" : ""),
    );
  }

  // --- Floor guards: an empty read must not look like a clean product -------
  if (capabilities.length < 12) {
    failures.push(`floor: ${capabilities.length} restricted capabilities read, expected at least 12`);
  }
  if (!catalog || catalog.length < 200) {
    failures.push(`floor: ${catalog?.length ?? 0} catalogue codes read, expected at least 200`);
  }
  if (requiredFields.length !== 10) {
    failures.push(`floor: the signed review contract names ${requiredFields.length} required fields, expected 10`);
  }
  if (dates.length < 10) {
    failures.push(`floor: ${dates.length} declared dates read, expected at least 10`);
  }

  return {
    failures,
    warnings,
    capabilityCount: capabilities.length,
    catalogCodeCount: catalog?.length ?? 0,
    realJurisdictionCount: Object.keys(realJurisdictions).length,
    reviewedDecisionCount,
    checkedDateCount: checked,
    oldestDateAgeDays: oldest,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = runJurisdictionGate(root, process.argv[2]);
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  if (result.failures.length > 0) {
    console.error(`JURISDICTION GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `jurisdiction gate passed: ${result.capabilityCount} restricted capabilities, ` +
      `${result.catalogCodeCount} catalogue codes, ${result.realJurisdictionCount} reviewed jurisdictions, ` +
      `${result.reviewedDecisionCount} signed decisions, ${result.checkedDateCount} dates checked ` +
      `(oldest ${result.oldestDateAgeDays} days). ` +
      `${UNIMPLEMENTED.length} contract checks are not implemented and are named in ${path.basename(fileURLToPath(import.meta.url))}.`,
  );

}
