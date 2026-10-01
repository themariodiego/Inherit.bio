import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { ciBrowserSourceIdentity } from "../../scripts/ci-browser-shards-io";
import { checkedQcSeed, fixtureHash, QC_SEEDS } from "../../scripts/ci-browser/embryo-qc-two-seed";
import type { provePublishedQcCrossSurface } from "./embryo-qc-cross-surface";

/** Only bounded synthetic figure/QC metadata leaves the native job: no
 * contacts, legal bodies, credentials, raw calls, keys or provider locators. */
export function saveQcSeedReceipt(seed: "a" | "b", test: TestInfo, runtimeOwner: string,
  capture: Awaited<ReturnType<typeof provePublishedQcCrossSurface>>) {
  const registered = QC_SEEDS[seed], source = ciBrowserSourceIdentity();
  assert(test.project.name === registered.project && path.basename(test.file) === registered.spec
    && test.config.shard?.total === 6, "Exact native QC project and partition required");
  const receipt = checkedQcSeed({ schemaVersion: 1, seed, ...source, index: test.config.shard.current, total: 6,
    caseId: `${test.testId}:${test.project.name}`, project: test.project.name, spec: registered.spec,
    fixture: registered.fixture, fixtureSha256: fixtureHash(registered.fixture), runtimeOwner,
    cohortId: capture.publication.cohort.id, publicationRevision: capture.publication.cohort.publication_revision,
    sources: capture.sources.map(row => ({ subjectId: row.subjectId,
      ordinal: capture.publication.embryos.find(embryo => embryo.id === row.embryoId)!.sample_ordinal, qc: row.qc })),
    surfaces: capture.surfaces.map(row => ({ route: row.route, ordinal: row.route === "/embryos/compare" ? null
      : capture.publication.embryos.find(embryo => row.url === `/embryos/${embryo.id}`)!.sample_ordinal, figures: row.figures })),
  });
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/embryo-qc-seed.json", JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
}
