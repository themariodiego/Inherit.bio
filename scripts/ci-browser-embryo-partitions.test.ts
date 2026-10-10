import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertEmbryoCiShard, assertEmbryoJourneyPartition, assertEmbryoJourneyAudits, EMBRYO_BROWSER_JOURNEYS } from "./ci-browser-embryo-partitions";

const journeys = [
  { project: "embryo-ingest", file: "embryo-ingest-journey.spec.ts", cases: 1 },
  { project: "embryo-mixed-qc", file: "embryo-mixed-qc-journey.spec.ts", cases: 1 },
  { project: "chromium", file: "embryo-qc-second-seed-journey.spec.ts", cases: 1 },
  { project: "chromium", file: "reviews-keyless-owner-notice-journey.spec.ts", cases: 1 },
  { project: "chromium", file: "embryo-third-party-journey.spec.ts", cases: 1 },
];
describe("fresh native embryo partitions", () => {
  it("requires all inventoried journeys but permits only one in each fresh job", () => {
    expect(() => assertEmbryoJourneyPartition(journeys, true)).not.toThrow();
    for (const journey of journeys) expect(() => assertEmbryoJourneyPartition([journey], false)).not.toThrow();
    expect(() => assertEmbryoJourneyPartition([], false)).not.toThrow();
    expect(() => assertEmbryoJourneyPartition(journeys, false)).toThrow("at most one");
    for (const invalid of [[], journeys.slice(0, 1), [journeys[0], journeys[0]],
      [journeys[0], { ...journeys[1], file: journeys[0].file }],
      [journeys[0], { ...journeys[1], cases: 2 }]]) expect(() => assertEmbryoJourneyPartition(invalid, true)).toThrow();
    expect(() => assertEmbryoJourneyPartition([{ ...journeys[1], project: "chromium" }], false)).toThrow();
    expect(() => assertEmbryoJourneyPartition([{ ...journeys[2], project: "embryo-ingest" }], false)).toThrow();
    expect(() => assertEmbryoJourneyPartition([journeys[2], journeys[0]], false)).toThrow("at most one");
    expect(() => assertEmbryoJourneyPartition([{ ...journeys[3], project: "embryo-ingest" }], false)).toThrow();
    for (const earlier of journeys.slice(0, 3))
      expect(() => assertEmbryoJourneyPartition([earlier, journeys[3]], false)).toThrow("at most one");
    expect(() => assertEmbryoJourneyPartition(journeys.slice(0, 4), true)).toThrow("at most one");
    expect(() => assertEmbryoJourneyPartition([{ ...journeys[4], project: "embryo-ingest" }], false)).toThrow();
    for (const earlier of journeys.slice(0, 4))
      expect(() => assertEmbryoJourneyPartition([earlier, journeys[4]], false)).toThrow("at most one");
    expect(() => assertEmbryoJourneyPartition([{ project: "chromium", file: "ordinary.spec.ts", cases: 1 }], false)).not.toThrow();
  });
  it("refuses unsharded CI while preserving ordinary local behavior", () => {
    expect(() => assertEmbryoCiShard(null, { CI: "true" })).toThrow("unsharded CI");
    expect(() => assertEmbryoCiShard(1, { CI: "true" })).not.toThrow();
    expect(() => assertEmbryoCiShard(null, {})).not.toThrow();
  });
  it("checks native assignment before Playwright execution and during independent full inventory", () => {
    const run = readFileSync("scripts/run-e2e.ts", "utf8");
    const assignedGuard = "verifyBrowserDurationPartitionListing(assignedDiscovery, plan, shard)";
    expect(run).toContain(assignedGuard);
    expect(run.indexOf(assignedGuard)).toBeLessThan(run.indexOf('spawnSync(command, ["test"'));
    const inventory = readFileSync("scripts/ci-browser-shards.run.mts", "utf8");
    expect(inventory).toContain("browserDurationPlan(full, profile)");
    expect(inventory).toContain("discoverBrowserCases(null, list.path)");
    expect(inventory).toContain("verifyBrowserDurationListings(full, assignments, plan)");
    expect(inventory.indexOf("verifyBrowserDurationListings(full, assignments, plan)"))
      .toBeLessThan(inventory.indexOf('writeFileSync("test-results/ci-browser-manifest.json"'));
  });
});

describe("permanent genuine embryo audit preflight", () => {
  const real = () => Object.fromEntries(Object.values(EMBRYO_BROWSER_JOURNEYS)
    .map(file => [file, readFileSync(`e2e/${file}`, "utf8")]));
  it("requires all real network audits and the connected populated all-pass audit", () => {
    expect(() => assertEmbryoJourneyAudits(real())).not.toThrow();
    for (const file of Object.values(EMBRYO_BROWSER_JOURNEYS)) {
      const current = real();
      current[file] = current[file].replace('from "./audited-test"', 'from "@playwright/test"');
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("genuine state network audit");
      current[file] += '\n// import { test } from "./audited-test";';
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("genuine state network audit");
    }
    const name = EMBRYO_BROWSER_JOURNEYS["embryo-ingest"];
    for (const replacement of ["unconnectedAudit", "auditPublishedEmbryoSurfaces.toString"]) {
      const current = real();current[name] = current[name].replace("await auditPublishedEmbryoSurfaces(", `await ${replacement}(`);
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("populated surface audit");
    }
    const second = EMBRYO_BROWSER_JOURNEYS["embryo-qc-seed"];
    for (const replacement of [(text: string) => text.replace("http://localhost:3105", "http://localhost:3100"),
      (text: string) => text.replace('saveQcSeedReceipt("b"', 'saveQcSeedReceipt("a"'),
      (text: string) => text.replace('qcSeed: "b"', 'qcSeed: "a"'),
      (text: string) => text.replace('qcSeed: "b"', 'qcSeed: selectedSeed'),
      (text: string) => text.replace('ownerEmail: "qc-seed-b@e2e.local"', 'ownerEmail: "participant-c@e2e.local"'),
      (text: string) => text.replace("await seedParticipantC(", "await unconnectedSeed(")]) {
      const current = real();current[second] = replacement(current[second]);
      expect(() => assertEmbryoJourneyAudits(current)).toThrow();
    }
    const missing = real();delete missing[name];
    expect(() => assertEmbryoJourneyAudits(missing)).toThrow("source inventory");
    expect(() => assertEmbryoJourneyAudits({ ...real(), "unknown.spec.ts": "" })).toThrow("source inventory");
    const positive = EMBRYO_BROWSER_JOURNEYS["future-person-keyless"];
    for (const symbol of ["seedParticipantC", "withEmbryoJourney", "syntheticHistoricalTransfer", "saveNativeMatchingDetails",
      "expectFullDocumentReceipts", "openSyntheticReviewPdf", "sendSyntheticDeliveredCallback", "nativeReviewRequest"]) {
      const current = real();current[positive] = current[positive].replace(`await ${symbol}(`, "await unconnectedPositiveFixture(");
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("connected native producer");
    }
    const wrongOrigin = real();wrongOrigin[positive] = wrongOrigin[positive].replace('test.use({baseURL:"http://localhost:3105"})', 'test.use({baseURL:"http://localhost:3100"})');
    expect(() => assertEmbryoJourneyAudits(wrongOrigin)).toThrow("isolated 3105 origin");
  });
  it("checks source before execution and in the independent inventory and aggregation entry point", () => {
    const run = readFileSync("scripts/run-e2e.ts", "utf8");
    expect(run.indexOf("assertEmbryoJourneyAudits(Object.fromEntries")).toBeLessThan(run.indexOf('spawnSync(command, ["test"'));
    const inventory = readFileSync("scripts/ci-browser-shards.run.mts", "utf8");
    expect(inventory.indexOf("assertEmbryoJourneyAudits(Object.fromEntries")).toBeLessThan(inventory.indexOf("const source = ciBrowserSourceIdentity()"));
  });

  it("refuses planted gaps in the genuine first read and held second assignment", () => {
    const positive = EMBRYO_BROWSER_JOURNEYS["future-person-keyless"];
    const changes = [
      { change: (text: string) => text.replace('openSyntheticReviewPdf(review,"photo")', 'openSyntheticReviewPdf(fresh,"photo")'), error: "first reviewer" },
      { change: (text: string) => text.replace('openSyntheticReviewPdf(review,"birth")', 'openSyntheticReviewPdf(review,"photo")'), error: "first reviewer" },
      { change: (text: string) => text.replace('expectFullDocumentReceipts(claim,reviewer,papers)', 'expectFullDocumentReceipts(claim,second,papers)'), error: "first reviewer" },
      { change: (text: string) => text.replace('record.evidence.birthRecordDocumentId]){', 'record.evidence.photoIdentityDocumentId]){'), error: "held document GET refusals" },
      { change: (text: string) => text.replace('nativeReviewRequest(fresh,`/api/legal-evidence/${reviewId(document)}/review-download`)', 'unconnectedHeldRequest(fresh,`/api/legal-evidence/${reviewId(document)}/review-download`)'), error: "connected native producer" },
      { change: (text: string) => text.replace('expect(response.status).toBe(404);expect(response.body).toEqual({error:"not_found"});\n        expect(response.cache)', 'expect(response.status).toBe(200);expect(response.body).toEqual({error:"not_found"});\n        expect(response.cache)'), error: "held document GET refusals" },
      { change: (text: string) => text.replace('expect(await secondDocumentProof()).toBe("0/0/0/0");\n      const hold', 'expect(await secondDocumentProof()).toBe("0/0/0/1");\n      const hold'), error: "held document GET refusals" },
      { change: (text: string) => text.replace('private.claim_review_chunk_receipts receipt', 'private.claim_review_receipt_sessions receipt'), error: "held document GET refusals" },
      { change: (text: string) => text.replace("reviewer_account_id='${second}' and document_id is not null", "reviewer_account_id='${reviewer}' and document_id is not null"), error: "held document GET refusals" },
      { change: (text: string) => text.replace('expect(await secondDocumentProof()).toBe("0/0/0/0");expect(await keylessEffectProof(claim)).toBe(hold);', 'expect(await secondDocumentProof()).toBe("0/0/0/0");'), error: "held document GET refusals" },
      { change: (text: string) => text.replace('expect(await secondDocumentProof()).toBe("0/0/0/0");expect(await keylessEffectProof(claim)).toBe(hold);', 'expect(await secondDocumentProof()).toBe("0/0/0/0"); // expect(await keylessEffectProof(claim)).toBe(hold);'), error: "held document GET refusals" },
      { change: (text: string) => text.replace('nativeReviewRequest(fresh,`/api/legal-evidence/${reviewId(document)}/review-download`)', 'nativeReviewRequest(fresh,`/api/legal-evidence/${reviewId(document)}/review-download`,{})'), error: "held document GET refusals" },
    ];
    for (const {change,error} of changes) {
      const current = real(), source = current[positive];current[positive] = change(source);
      expect(current[positive]).not.toBe(source);
      expect(() => assertEmbryoJourneyAudits(current)).toThrow(error);
    }
  });
});
