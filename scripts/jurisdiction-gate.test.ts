import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { UNIMPLEMENTED, frontMatter, parseStrictDate, runJurisdictionGate } from "./jurisdiction-gate";

/**
 * Every check is planted, because a gate that has never failed is a gate
 * nobody has tested. The planted repository is real except for the one thing
 * under test: `data/jurisdictions.json` is the true file with one edit, and
 * the signed record is written out only where a test needs one.
 *
 * The signed-review checks are the reason this gate exists, and they are the
 * hardest to trust, because there are zero real determinations to exercise
 * them. So each one is planted against a decision this test constructs: a
 * complete, valid review that passes, and then one field broken at a time.
 * Without that, the first real determination would be the first time any of
 * this code ran.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

type Json = Record<string, unknown>;
const SHA = "a".repeat(40);
const CODE = "ZZ";
const CAPABILITY = "carrier_match";
const RECORD_PATH = `docs/reviews/jurisdictions/${CODE}/${CAPABILITY}.md`;

function validReview(overrides: Json = {}): Json {
  return {
    path: RECORD_PATH,
    reviewer: "A Named Person",
    qualification: "Solicitor, admitted in England and Wales",
    jurisdiction: CODE,
    capability: CAPABILITY,
    scope: `/realJurisdictions/${CODE}/capabilities/${CAPABILITY}`,
    status: "permitted",
    reviewedOn: "2026-09-01",
    gitSha: SHA,
    outcome: "approved",
    ...overrides,
  };
}

function recordFor(review: Json, body = "The determination, in the reviewer's words.\n"): string {
  const order = ["path", "reviewer", "qualification", "jurisdiction", "capability", "scope",
    "status", "reviewedOn", "gitSha", "outcome"];
  const front = order.map((field) => `${field}: ${String(review[field])}`).join("\n");
  return `---\n${front}\n---\n\n${body}\nSigned-off-by: ${String(review.reviewer)}\n`;
}

interface Overrides {
  data?: (file: Json) => void;
  /** Written verbatim to the record path; omit to write one matching the review. */
  record?: string | null;
  review?: Json;
}

/** A repository carrying the real jurisdictions file with one planted change. */
function plant(overrides: Overrides = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "jurisdiction-gate-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "data"), { recursive: true });

  const file = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, "data/jurisdictions.json"), "utf8"),
  ) as Json;

  if (overrides.review) {
    const capabilities: Json = {};
    for (const capability of file.capabilities as string[]) {
      capabilities[capability] = { status: "unreviewed", accessedOn: "2026-09-01", review: null };
    }
    capabilities[CAPABILITY] = {
      status: overrides.review.status ?? "permitted",
      accessedOn: "2026-09-01",
      review: overrides.review,
    };
    (file.realJurisdictions as Json)[CODE] = { capabilities };
  }
  overrides.data?.(file);
  writeFileSync(path.join(root, "data/jurisdictions.json"), JSON.stringify(file));

  if (overrides.review && overrides.record !== null) {
    mkdirSync(path.join(root, `docs/reviews/jurisdictions/${CODE}`), { recursive: true });
    writeFileSync(
      path.join(root, RECORD_PATH),
      overrides.record ?? recordFor(overrides.review),
    );
  }
  return root;
}

const failures = (root: string) => runJurisdictionGate(root, "2026-09-11").failures;

describe("the jurisdiction gate holds the signed-review contract", () => {
  it("passes on this repository, having actually read it", () => {
    const result = runJurisdictionGate(REPOSITORY_ROOT, "2026-09-11");
    expect(result.failures).toEqual([]);
    expect(result.capabilityCount).toBe(12);
    expect(result.catalogCodeCount).toBe(249);
    // The measurement that makes priorities 4 and 5 unreachable in production.
    expect(result.realJurisdictionCount).toBe(0);
    expect(result.reviewedDecisionCount).toBe(0);
    expect(result.checkedDateCount).toBeGreaterThan(10);
  });

  it("reports the contract checks it does not implement, rather than implying none", () => {
    expect(UNIMPLEMENTED.length).toBe(2);
    expect(UNIMPLEMENTED.join(" ")).toContain("gitSha");
  });

  it("accepts a complete signed review, so the failures below are about the defect", () => {
    expect(failures(plant({ review: validReview() }))).toEqual([]);
  });

  it("fails when a permitted decision carries no review at all", () => {
    const root = plant({ review: validReview() });
    const file = JSON.parse(readFileSync(path.join(root, "data/jurisdictions.json"), "utf8")) as Json;
    ((file.realJurisdictions as Json)[CODE] as Json).capabilities = {
      ...(((file.realJurisdictions as Json)[CODE] as Json).capabilities as Json),
      [CAPABILITY]: { status: "permitted", accessedOn: "2026-09-01", review: null },
    };
    writeFileSync(path.join(root, "data/jurisdictions.json"), JSON.stringify(file));
    expect(failures(root).join("\n")).toContain("requires the signed review reference object");
  });

  it.each([
    ["path", { path: "docs/reviews/jurisdictions/ZZ/somewhere_else.md" }, "review.path is"],
    ["scope", { scope: "/realJurisdictions/ZZ/capabilities/wrong" }, "review.scope is"],
    ["jurisdiction", { jurisdiction: "QQ" }, "review.jurisdiction is"],
    ["capability", { capability: "embryo_analysis" }, "review.capability is"],
    ["outcome", { outcome: "looks fine" }, "must be the exact string approved"],
    ["gitSha", { gitSha: "abc123" }, "full 40-character lowercase sha"],
    ["reviewer", { reviewer: "   " }, "review.reviewer must be a non-empty string"],
    ["qualification", { qualification: "" }, "review.qualification must be a non-empty string"],
    ["reviewedOn", { reviewedOn: "2026-13-45" }, "strict Gregorian"],
  ])("fails when review.%s is wrong", (_field, override, expected) => {
    const review = validReview(override as Json);
    expect(failures(plant({ review, record: recordFor(review) })).join("\n")).toContain(expected);
  });

  it("fails on an extra review field, because additionalFields is reject", () => {
    const review = validReview({ note: "added later" });
    expect(failures(plant({ review, record: recordFor(review) })).join("\n"))
      .toContain("review carries note");
  });

  it("fails when the signed record named by the review does not exist", () => {
    expect(failures(plant({ review: validReview(), record: null })).join("\n"))
      .toContain("no signed record at");
  });

  it("fails when the record's front matter disagrees with the review", () => {
    const review = validReview();
    const record = recordFor({ ...review, reviewer: "Somebody Else" });
    // The sign-off still matches the front matter, so only the comparison
    // against the review can catch this - which is the point of doing both.
    expect(failures(plant({ review, record })).join("\n")).toContain("they must be exactly equal");
  });

  it("fails when the record is not signed off by the named reviewer", () => {
    const review = validReview();
    const record = recordFor(review).replace(/Signed-off-by: .*/, "Signed-off-by: Nobody");
    expect(failures(plant({ review, record })).join("\n")).toContain("final non-blank line");
  });

  it("fails when the record has no front matter at all", () => {
    const review = validReview();
    expect(failures(plant({ review, record: "Just prose.\n\nSigned-off-by: A Named Person\n" })).join("\n"))
      .toContain("no leading front matter");
  });

  it("fails when an unreviewed decision carries a review object anyway", () => {
    const root = plant({ review: validReview() });
    const file = JSON.parse(readFileSync(path.join(root, "data/jurisdictions.json"), "utf8")) as Json;
    const capabilities = ((file.realJurisdictions as Json)[CODE] as Json).capabilities as Json;
    capabilities.embryo_analysis = { status: "unreviewed", accessedOn: "2026-09-01", review: validReview() };
    writeFileSync(path.join(root, "data/jurisdictions.json"), JSON.stringify(file));
    expect(failures(root).join("\n")).toContain("an unreviewed decision must carry review null");
  });

  it("fails when a real jurisdiction decides only some capabilities", () => {
    const root = plant({ review: validReview() });
    const file = JSON.parse(readFileSync(path.join(root, "data/jurisdictions.json"), "utf8")) as Json;
    ((file.realJurisdictions as Json)[CODE] as Json).capabilities = { [CAPABILITY]: {
      status: "permitted", accessedOn: "2026-09-01", review: validReview() } };
    writeFileSync(path.join(root, "data/jurisdictions.json"), JSON.stringify(file));
    expect(failures(root).join("\n")).toContain("coverage: realJurisdictions/ZZ decides 1 of 12");
  });

  it("fails when the default every unreviewed code falls through to is not a denial", () => {
    const root = plant({ data: (file) => {
      const defaults = (file.defaultRealJurisdiction as Json).capabilities as Json;
      (defaults[CAPABILITY] as Json).status = "permitted";
    } });
    expect(failures(root).join("\n")).toContain("default deny");
  });

  it("fails when the test pseudo-jurisdiction stops declaring itself production-forbidden", () => {
    const root = plant({ data: (file) => {
      ((file.testJurisdictions as Json)["TEST-LOCAL"] as Json).productionAllowed = true;
    } });
    expect(failures(root).join("\n")).toContain("must declare productionAllowed false");
  });

  // The boundaries are 0-300 pass, 301-365 warn, 366+ fail. 2025-10-26 is 320
  // days before the as-of date and 2024-01-01 is far past the limit; the first
  // draft of this used a date that was only 284 days old and warned about
  // nothing, which is the arithmetic being checked rather than assumed.
  it("fails a date past the contract's limit and warns before it", () => {
    const root = plant({ data: (file) => { file.accessedAt = "2024-01-01"; } });
    expect(failures(root).join("\n")).toContain("days old");
    const warned = plant({ data: (file) => { file.accessedAt = "2025-10-26" } });
    const result = runJurisdictionGate(warned, "2026-09-11");
    expect(result.failures).toEqual([]);
    expect(result.warnings.join("\n")).toContain("it warns above");
  });

  it("fails a future date rather than treating it as fresh", () => {
    const root = plant({ data: (file) => { file.accessedAt = "2099-01-01"; } });
    expect(failures(root).join("\n")).toContain("in the future");
  });

  it("fails loudly rather than passing when the file has been emptied", () => {
    const root = plant({ data: (file) => {
      file.capabilities = [];
      (file.realJurisdictionCatalog as Json).codes = [];
    } });
    expect(failures(root).join("\n")).toContain("floor:");
  });

  it("parses only the front matter the contract allows", () => {
    expect(frontMatter("no front matter")).toBe("no leading front matter");
    expect(frontMatter("---\na: 1\na: 2\n---\n")).toContain("duplicate front-matter key");
    expect(frontMatter('---\na: "quoted"\n---\n')).toEqual({ a: "quoted" });
  });

  it("refuses a date that is not a real calendar day", () => {
    expect(parseStrictDate("2026-02-30")).toBeNull();
    expect(parseStrictDate("2026-9-1")).toBeNull();
    expect(parseStrictDate("2026-09-01")).toBeInstanceOf(Date);
  });
});
