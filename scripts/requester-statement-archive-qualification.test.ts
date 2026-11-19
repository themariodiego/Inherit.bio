import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The worker source extends the platform's DurableObject; only that base class is replaced.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } },
}));

import { r2AllocationDigest } from "../src/lib/exports/archive-r2-current-fence";
import { scanText } from "./secret-gate";
import {
  CLEANUP_ATTEMPTS, GATEWAY_OPERATIONS, LIVE_ENVIRONMENT_NAMES, OWNER_LIMITS, QUALIFICATION_CASES, QUALIFICATION_EXCLUSIONS,
  QualificationRefusal, RPC_WORST_CASE, allocationDigest, budgetCase, createQualificationLedger, createSignedGatewayProvider,
  disposalSteps, dryPlanReport, proveQualificationBudget, runQualification, selectQualificationMode, stepCost, stepWorstCost,
  sumPriorReceipts, totalOperations,
  worstCleanupAttempt, type FetchLike, type LedgerSnapshot, type QualificationCase, type QualificationResult,
  type QualificationStep, type R2Operations,
} from "./requester-statement-archive-qualification";
import { createInProcessWorker, loadWorkerSource, type InProcessWorker, type R2CallCounts } from "./requester-statement-archive-qualification.fixture";

const ENTRY = "scripts/requester-statement-archive-qualification.run.mts";
const GATEWAY_URL = new URL("https://gateway.example.test/private/case-archive/v1");
const BUCKET = "inherit-export-qualification-test";

function refusalCode(run: () => unknown): string {
  try { run(); } catch (error) { if (error instanceof QualificationRefusal) return error.code; throw error; }
  return "not-refused";
}
const caseById = (id: string) => {
  const found = QUALIFICATION_CASES.find(c => c.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const minus = (a: R2CallCounts, b: R2CallCounts): R2Operations => ({ classA: a.classA - b.classA, classB: a.classB - b.classB, delete: a.delete - b.delete });

async function harness() {
  const key = randomBytes(32), bindingSha256 = randomBytes(32).toString("hex");
  const worker = createInProcessWorker(await loadWorkerSource(), { bucket: BUCKET, bindingSha256, transportKey: key.toString("base64") });
  return { key, bindingSha256, worker, configuration: { bucket: BUCKET, bindingSha256 } };
}

/** Wraps the in-process worker so one chosen request's answer is replaced after the worker handled it, or before. */
function faulty(worker: InProcessWorker, fault: (operation: string, caseId: string, phase: string) => "forward-then-fail" | "drop" | null) {
  let current = { caseId: "", phase: "" };
  const fetch: FetchLike = async (input, init) => {
    let operation = "";
    try { operation = (JSON.parse(String(init.body)) as { operation?: string }).operation ?? ""; } catch { operation = ""; }
    const action = fault(operation, current.caseId, current.phase);
    if (action === "drop") return new Response("dropped", { status: 500 });
    const response = await worker.fetch(input, init);
    if (action === "forward-then-fail") { await response.body?.cancel(); return new Response("lost", { status: 500 }); }
    return response;
  };
  return { fetch, onDispatch: (_: QualificationStep, phase: string, caseId: string) => { current = { caseId, phase }; } };
}

describe("closed plan and the budget proof", () => {
  it("proves the real 23-case plan fits the owner limits with two cleanup attempts reserved for every written allocation", () => {
    const proof = proveQualificationBudget();
    expect(OWNER_LIMITS).toEqual({ operations: 2_500, storedBytes: 10_000_000 });
    expect(QUALIFICATION_CASES.map(c => c.id)).toEqual(Array.from({ length: 23 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`));
    expect(proof.expected).toEqual({ classA: 29, classB: 174, delete: 14 });
    expect(proof.expectedTotal).toBe(217);
    expect(proof.worst).toEqual({ classA: 67, classB: 435, delete: 40 });
    expect(proof.worstTotal).toBe(542);
    expect(proof.worstStoredBytes).toBe(8_094_209);
    expect(proof.expectedPeakStoredBytes).toBe(4_000_000);
    expect(proof.expectedGatewayRequests).toBe(317);
    expect(proof.operationsHeadroom).toBe(2_500 - 542);
    expect(proof.storedBytesHeadroom).toBe(10_000_000 - 8_094_209);
    expect(worstCleanupAttempt()).toEqual({ classA: 1, classB: 11, delete: 1 });
    for (const budget of proof.cases) {
      expect(budget.worstCleanup).toEqual({ classA: CLEANUP_ATTEMPTS * budget.writtenAllocations, classB: 11 * CLEANUP_ATTEMPTS * budget.writtenAllocations,
        delete: CLEANUP_ATTEMPTS * budget.writtenAllocations });
      expect(budget.worstTotal).toBeGreaterThanOrEqual(budget.expectedTotal);
    }
    const perCase = Object.fromEntries(proof.cases.map(b => [b.id, [b.expected.classA, b.expected.classB, b.expected.delete, b.expectedPeakStoredBytes]]));
    expect(perCase).toEqual({
      Q01: [0, 0, 0, 0], Q02: [0, 0, 0, 0], Q03: [0, 0, 0, 0], Q04: [0, 0, 0, 0], Q05: [0, 0, 0, 0], Q06: [0, 0, 0, 0], Q07: [0, 0, 0, 0],
      Q08: [2, 12, 1, 1_024], Q09: [2, 12, 1, 4_000_000], Q10: [0, 1, 0, 0], Q11: [2, 12, 1, 1_024], Q12: [0, 2, 0, 0],
      Q13: [2, 12, 1, 1_024], Q14: [2, 12, 1, 1_024], Q15: [1, 10, 1, 0], Q16: [2, 11, 1, 1_024], Q17: [2, 11, 1, 1_024],
      Q18: [2, 13, 1, 1_024], Q19: [3, 13, 1, 1_024], Q20: [3, 12, 1, 1_024], Q21: [2, 13, 1, 1_024], Q22: [2, 13, 1, 1_024],
      Q23: [2, 15, 1, 1_024],
    });
  });

  it("refuses a plan whose worst case exceeds the operation limit, including prior attempts", () => {
    expect(proveQualificationBudget(QUALIFICATION_CASES, { operations: 542, storedBytes: 10_000_000 }).operationsHeadroom).toBe(0);
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, { operations: 541, storedBytes: 10_000_000 })))
      .toBe("budget_plan_operations_refused");
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, OWNER_LIMITS, { operations: 1_959, storedBytes: 0 })))
      .toBe("budget_plan_operations_refused");
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, { operations: 2_501, storedBytes: 10_000_000 })))
      .toBe("budget_limits_refused");
  });

  it("refuses a plan that could store more than the byte limit, including prior attempts", () => {
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, { operations: 2_500, storedBytes: 8_094_208 })))
      .toBe("budget_plan_stored_bytes_refused");
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, OWNER_LIMITS, { operations: 0, storedBytes: 1_905_792 })))
      .toBe("budget_plan_stored_bytes_refused");
    expect(refusalCode(() => proveQualificationBudget(QUALIFICATION_CASES, { operations: 2_500, storedBytes: 10_000_001 })))
      .toBe("budget_limits_refused");
  });

  it("admits only the gateway's Class A, Class B and delete operations and refuses any other step", () => {
    expect(Object.keys(RPC_WORST_CASE).sort()).toEqual([...GATEWAY_OPERATIONS].sort());
    for (const cost of Object.values(RPC_WORST_CASE)) expect(Object.keys(cost).sort()).toEqual(["classA", "classB", "delete"]);
    const everyStep = [...QUALIFICATION_CASES.flatMap(c => c.steps),
      ...(["payload", "marker", "absent"] as const).flatMap(from => disposalSteps(0, from, "k1", "k2"))];
    for (const step of everyStep) {
      const expected = stepCost(step), worst = stepWorstCost(step);
      expect(expected.classA <= worst.classA && expected.classB <= worst.classB && expected.delete <= worst.delete, JSON.stringify(step)).toBe(true);
    }
    const invented = { ...caseById("Q08"), id: "Q99", steps: [{ op: "listObjects", alloc: 0, expect: "refused" } as unknown as QualificationStep] };
    expect(refusalCode(() => budgetCase(invented))).toBe("plan_step_refused");
    const oversized: QualificationCase = { ...caseById("Q08"), id: "Q98", payloadBytes: 4_000_001 };
    expect(refusalCode(() => budgetCase(oversized))).toBe("plan_case_refused");
    const secondMissing: QualificationCase = { ...caseById("Q12"), id: "Q97", allocations: 1 };
    expect(refusalCode(() => budgetCase(secondMissing))).toBe("plan_step_refused");
  });

  it("cites a real line of a real repository file for every case and every exclusion", () => {
    const citations = [...QUALIFICATION_CASES.flatMap(c => c.citations), ...QUALIFICATION_EXCLUSIONS.flatMap(e => e.citations)];
    expect(QUALIFICATION_CASES.every(c => c.citations.length > 0)).toBe(true);
    for (const citation of citations) {
      const match = /^([^:]+):(\d+)(?:-(\d+))?$/u.exec(citation);
      expect(match, citation).not.toBeNull();
      const [, file, first, last] = match!;
      expect(existsSync(file), citation).toBe(true);
      const lines = readFileSync(file, "utf8").split("\n").length;
      expect(Number(first), citation).toBeGreaterThan(0);
      expect(Number(last ?? first), citation).toBeGreaterThanOrEqual(Number(first));
      expect(Number(last ?? first), citation).toBeLessThanOrEqual(lines);
    }
  });

  it("derives allocations exactly as the application's current-object fence does", () => {
    const key = "export/00000000-0000-4000-8000-000000000001";
    expect(allocationDigest(BUCKET, key)).toBe(r2AllocationDigest(BUCKET, key));
  });
});

describe("run-time ledger", () => {
  const cleanup = 26;
  it("reserves cleanup with the case, keeps body steps out of it, and refuses a case whose worst case would exceed the limit", () => {
    const ledger = createQualificationLedger({ operations: 35, storedBytes: 100_000 });
    ledger.openCase("A", { body: 3, cleanup, storedBytes: 4_096 });
    expect(ledger.snapshot()).toMatchObject({ reservedBody: 3, reservedCleanup: cleanup, openCase: "A" });
    // A body step may not draw on the cleanup reservation, even though it has room.
    expect(refusalCode(() => ledger.authorize("body", { classA: 0, classB: 3, delete: 1 }, 0))).toBe("ledger_body_reservation_exhausted");
    ledger.authorize("body", { classA: 1, classB: 0, delete: 0 }, 2_048);
    ledger.settle({ classA: 1, classB: 0, delete: 0 });
    ledger.closeBody();
    expect(refusalCode(() => ledger.authorize("body", { classA: 0, classB: 1, delete: 0 }, 0))).toBe("ledger_dispatch_refused");
    for (let i = 0; i < 4; i++) { ledger.authorize("cleanup", { classA: 0, classB: 1, delete: 0 }, 0); ledger.settle({ classA: 0, classB: 1, delete: 0 }); }
    ledger.closeCase();
    expect(ledger.snapshot()).toMatchObject({ debitedTotal: 5, reservedBody: 0, reservedCleanup: 0, openCase: null });
    // 5 spent + 3 body + 26 cleanup = 34 fits; 5 + 4 + 26 = 35 fits; 5 + 5 + 26 = 36 does not.
    expect(refusalCode(() => ledger.openCase("B", { body: 5, cleanup, storedBytes: 0 }))).toBe("budget_case_operations_refused");
    ledger.openCase("C", { body: 4, cleanup, storedBytes: 0 });
    expect(ledger.snapshot().reservedCleanup).toBe(cleanup);
  });

  it("refuses a case whose stored bytes could exceed the limit and never returns bytes after a deletion", () => {
    const ledger = createQualificationLedger({ operations: 2_500, storedBytes: 5_000 });
    ledger.openCase("A", { body: 1, cleanup: 0, storedBytes: 3_000 });
    ledger.authorize("body", { classA: 1, classB: 0, delete: 0 }, 3_000);
    ledger.settle({ classA: 1, classB: 0, delete: 0 });
    ledger.closeBody(); ledger.closeCase();
    expect(ledger.snapshot().storedBytesBound).toBe(3_000);
    expect(refusalCode(() => ledger.openCase("B", { body: 1, cleanup: 0, storedBytes: 2_001 }))).toBe("budget_case_stored_bytes_refused");
  });

  it("refuses a debit above the authorization, a second open case and limits above the owner's", () => {
    const ledger = createQualificationLedger();
    ledger.openCase("A", { body: 1, cleanup: 13, storedBytes: 0 });
    expect(refusalCode(() => ledger.openCase("B", { body: 1, cleanup: 0, storedBytes: 0 }))).toBe("ledger_case_already_open");
    ledger.authorize("body", { classA: 0, classB: 1, delete: 0 }, 0);
    expect(refusalCode(() => ledger.settle({ classA: 1, classB: 0, delete: 0 }))).toBe("ledger_settle_exceeds_authorization");
    expect(refusalCode(() => createQualificationLedger({ operations: 2_501, storedBytes: 1 }))).toBe("budget_limits_refused");
  });
});

describe("full plan against the actual worker source in process", () => {
  let result: QualificationResult, worker: InProcessWorker, secrets: string[];
  const perCase = new Map<string, R2Operations>();
  beforeAll(async () => {
    const h = await harness();
    worker = h.worker;
    secrets = [GATEWAY_URL.href, GATEWAY_URL.host, h.key.toString("base64"), h.key.toString("base64url"), h.key.toString("hex"),
      BUCKET, h.bindingSha256];
    const provider = createSignedGatewayProvider({ url: GATEWAY_URL, key: h.key, fetch: worker.fetch });
    let before: R2CallCounts = { ...worker.bucket.calls };
    result = await runQualification({ provider, configuration: h.configuration, onCase: done => {
      perCase.set(done.id, minus(worker.bucket.calls, before)); before = { ...worker.bucket.calls };
    } });
  }, 60_000);

  it("passes every case and debits exactly the R2 calls the worker made, per case and in total", () => {
    const proof = proveQualificationBudget();
    expect(result.receipt.status).toBe("PASS");
    expect(result.receipt.cases.map(c => c.status)).toEqual(QUALIFICATION_CASES.map(() => "passed"));
    expect(result.receipt.ledger.debited).toEqual(worker.bucket.calls);
    expect(result.receipt.ledger.debited).toEqual(proof.expected);
    for (const [index, c] of result.receipt.cases.entries()) {
      expect(c.debitedOperations, c.id).toEqual(perCase.get(c.id));
      expect(c.debitedOperations, c.id).toEqual(proof.cases[index].expected);
      const stepTotal = c.steps.reduce((sum, s) => sum + totalOperations(s.operations), 0);
      expect(stepTotal, c.id).toBe(totalOperations(c.debitedOperations));
    }
    expect(result.receipt.gatewayRequests).toBe(worker.requests());
    expect(result.receipt.gatewayRequests).toBe(proof.expectedGatewayRequests);
  });

  it("leaves nothing stored, peaks at the planned bytes and keeps the stored-bytes bound under the limit", () => {
    expect(worker.bucket.objects.size).toBe(0);
    expect(worker.bucket.peakStoredBytes).toBe(proveQualificationBudget().expectedPeakStoredBytes);
    expect(result.receipt.ledger.storedBytesBound).toBeLessThanOrEqual(proveQualificationBudget().worstStoredBytes);
    expect(result.receipt.possiblyStoredBytesAtEnd).toBe(0);
    expect(result.receipt.outstandingAllocations).toBe(0);
    expect(result.outstandingObjectKeys).toEqual([]);
  });

  it("writes receipts with no URL, key, bucket, digest, object key or other secret-shaped value", () => {
    const text = JSON.stringify(result.receipt, null, 2);
    for (const secret of secrets) expect(text.includes(secret), "configured value in receipt").toBe(false);
    expect(text).not.toMatch(/export\/|https?:\/\/|inherit-export-/u);
    expect(text).not.toMatch(/[0-9a-f]{32,}/iu);
    // A long token mixing upper case, lower case and digits, as base64 keys and signatures do.
    expect(text).not.toMatch(/(?=[\w+/-]*\d)(?=[\w+/-]*[A-Z])(?=[\w+/-]*[a-z])[\w+/-]{32,}/u);
    expect(scanText(text, "receipt.json")).toEqual([]);
    // Positive control: a real signature from this transport is caught by the shape check above.
    expect(createHmac("sha256", "control").update("control").digest("base64url"))
      .toMatch(/(?=[\w+/-]*\d)(?=[\w+/-]*[A-Z])(?=[\w+/-]*[a-z])[\w+/-]{32,}/u);
    expect(sumPriorReceipts([text])).toEqual({ operations: 217, storedBytes: 0 });
  });
});

describe("unexpected results and cleanup", () => {
  it("stops at the first unexpected result, cleans up what the case wrote and starts no later case", async () => {
    const h = await harness();
    // The worker begins the claim, but the caller sees a lost answer in the middle of Q16's body.
    const wrapper = faulty(h.worker, (operation, caseId, phase) => caseId === "Q16" && phase === "body" && operation === "beginCleanup" ? "forward-then-fail" : null);
    const provider = createSignedGatewayProvider({ url: GATEWAY_URL, key: h.key, fetch: wrapper.fetch });
    const cases = [caseById("Q08"), caseById("Q16"), caseById("Q13")];
    const { receipt } = await runQualification({ provider, configuration: h.configuration, cases, onDispatch: wrapper.onDispatch });
    expect(receipt.status).toBe("STOPPED");
    expect(receipt.cases.map(c => [c.id, c.status])).toEqual([["Q08", "passed"], ["Q16", "unexpected"], ["Q13", "not-started"]]);
    const stopped = receipt.cases[1];
    expect(caseById("Q16").steps.length).toBeGreaterThan(2);
    expect(stopped.steps.filter(s => s.phase === "body").map(s => s.observed)).toEqual(["created", "uncertain:status"]);
    // Cleanup first releases the claim the lost answer may have left held, then disposes of the payload.
    const cleanup = stopped.steps.filter(s => s.phase === "cleanup");
    expect(cleanup.slice(0, 2).map(s => [s.operation, s.observed])).toEqual([["endCleanup", "true"], ["describeConfiguration", "configuration"]]);
    expect(cleanup.at(-2)?.observed).toBe("absent");
    expect(stopped.cleanedAllocations).toBe(1);
    expect(receipt.cases[2].steps).toEqual([]);
    expect(h.worker.bucket.objects.size).toBe(0);
    // The lost answer's request reached the worker and makes no R2 call, so the debit still equals the real calls.
    expect(receipt.ledger.debited).toEqual(h.worker.bucket.calls);
  });

  it("reports cleanup that cannot finish as incomplete, within its reservation, after its second attempt", async () => {
    const h = await harness();
    const wrapper = faulty(h.worker, (operation, _caseId, phase) => phase === "cleanup" && operation === "deleteCurrent" ? "drop" : null);
    const provider = createSignedGatewayProvider({ url: GATEWAY_URL, key: h.key, fetch: wrapper.fetch });
    const ledger = createQualificationLedger();
    const { receipt, outstandingObjectKeys } = await runQualification({ provider, configuration: h.configuration, ledger,
      cases: [caseById("Q08"), caseById("Q13")], claimTtlMs: 1_000, onDispatch: wrapper.onDispatch });
    expect(receipt.status).toBe("CLEANUP_INCOMPLETE");
    expect(receipt.cases.map(c => c.status)).toEqual(["cleanup-incomplete", "not-started"]);
    expect(receipt.cases[0].cleanupAttempts).toBe(CLEANUP_ATTEMPTS);
    expect(outstandingObjectKeys).toHaveLength(1);
    expect(receipt.outstandingAllocations).toBe(1);
    expect(receipt.possiblyStoredBytesAtEnd).toBeGreaterThan(0);
    // The dropped deletions never reached the worker; the ledger still debited their worst case.
    expect(receipt.ledger.debited).toEqual({ ...h.worker.bucket.calls, classB: h.worker.bucket.calls.classB + 6,
      delete: h.worker.bucket.calls.delete + 2 });
    expect(receipt.ledger.debitedTotal).toBeLessThanOrEqual(budgetCase(caseById("Q08")).worstTotal);
    expect([...h.worker.bucket.objects.values()].map(o => o.bytes.byteLength)).toEqual([0]);
    expect(sumPriorReceipts([JSON.stringify(receipt)]).storedBytes).toBe(receipt.possiblyStoredBytesAtEnd);
  }, 30_000);

  it("reserves each case's cleanup before the case's first request and keeps it through the body", async () => {
    const h = await harness();
    const ledger = createQualificationLedger();
    const seen: { caseId: string; phase: string; snapshot: LedgerSnapshot }[] = [];
    const provider = createSignedGatewayProvider({ url: GATEWAY_URL, key: h.key, fetch: h.worker.fetch });
    const cases = [caseById("Q08"), caseById("Q22")];
    const { receipt } = await runQualification({ provider, configuration: h.configuration, cases, ledger,
      onDispatch: (_step, phase, caseId) => seen.push({ caseId, phase, snapshot: ledger.snapshot() }) });
    expect(receipt.status).toBe("PASS");
    for (const plan of cases) {
      const budget = budgetCase(plan), body = seen.filter(s => s.caseId === plan.id && s.phase === "body");
      expect(body.length).toBe(plan.steps.length);
      expect(body[0].snapshot.reservedCleanup).toBe(totalOperations(budget.worstCleanup));
      expect(body[0].snapshot.reservedBody + body[0].snapshot.inflight).toBe(totalOperations(budget.worstBody));
      for (const s of body) expect(s.snapshot.reservedCleanup).toBe(totalOperations(budget.worstCleanup));
      const cleanup = seen.filter(s => s.caseId === plan.id && s.phase === "cleanup");
      expect(cleanup.length).toBeGreaterThan(0);
      expect(cleanup.every(s => s.snapshot.reservedBody === 0)).toBe(true);
    }
  });

  it("refuses the whole plan before any request when it cannot fit", async () => {
    const h = await harness();
    const fetch = vi.fn<FetchLike>(h.worker.fetch);
    const provider = createSignedGatewayProvider({ url: GATEWAY_URL, key: h.key, fetch });
    await expect(runQualification({ provider, configuration: h.configuration, limits: { operations: 541, storedBytes: 10_000_000 } }))
      .rejects.toThrow("budget_plan_operations_refused");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("dry plan and live mode", () => {
  const values = (): Record<string, string> => ({
    INHERIT_TEST_STATEMENT_GATEWAY_URL: GATEWAY_URL.href,
    INHERIT_TEST_STATEMENT_GATEWAY_KEY: randomBytes(32).toString("base64"),
    INHERIT_TEST_STATEMENT_R2_BUCKET: BUCKET,
    INHERIT_TEST_STATEMENT_R2_BINDING_SHA256: randomBytes(32).toString("hex"),
  });
  const refusal = (run: () => unknown) => {
    try { run(); } catch (error) { if (error instanceof QualificationRefusal) return error; throw error; }
    throw new Error("not refused");
  };

  it("is a dry plan by default that reads no environment and sends nothing", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const untouchable = () => { throw new Error("environment read in dry mode"); };
    expect(selectQualificationMode([], untouchable)).toEqual({ mode: "dry-plan", priorReceipts: [] });
    const report = dryPlanReport();
    expect(report.contacted).toBe(false);
    expect(report.totals.worstTotal).toBe(542);
    expect(report.cases).toHaveLength(23);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("stays dry when every variable is present but --live is not given", () => {
    const env = values(), read = vi.fn((name: string) => env[name]);
    expect(selectQualificationMode([], read).mode).toBe("dry-plan");
    expect(read).not.toHaveBeenCalled();
    expect(refusal(() => selectQualificationMode([`--receipts=${path.join(tmpdir(), "r.json")}`], read)).code).toBe("qualification_receipts_require_live");
    expect(refusal(() => selectQualificationMode(["--unknown"], read)).code).toBe("qualification_argument_refused");
  });

  it("refuses --live when any one variable is missing, naming it and printing no value", () => {
    expect(refusal(() => selectQualificationMode(["--live"], () => undefined)).code).toBe("qualification_live_receipts_required");
    for (const missing of LIVE_ENVIRONMENT_NAMES) {
      const env = values(); delete env[missing];
      const error = refusal(() => selectQualificationMode(["--live", "--receipts=r.json"], name => env[name]));
      expect(error.code).toBe("qualification_live_environment_missing");
      expect(error.names).toEqual([missing]);
      for (const value of Object.values(env)) expect(error.message.includes(value)).toBe(false);
    }
    const empty = values(); empty.INHERIT_TEST_STATEMENT_R2_BUCKET = "";
    expect(refusal(() => selectQualificationMode(["--live", "--receipts=r.json"], name => empty[name])).names).toEqual(["INHERIT_TEST_STATEMENT_R2_BUCKET"]);
  });

  it("refuses --live with an invalid value, naming the variable only", () => {
    const cases: [string, string][] = [
      ["INHERIT_TEST_STATEMENT_GATEWAY_URL", "http://gateway.example.test/private/case-archive/v1"],
      ["INHERIT_TEST_STATEMENT_GATEWAY_URL", "https://gateway.example.test/private/case-archive/v1?x=1"],
      ["INHERIT_TEST_STATEMENT_GATEWAY_KEY", randomBytes(31).toString("base64")],
      ["INHERIT_TEST_STATEMENT_R2_BUCKET", "inherit-embryo-other"],
      ["INHERIT_TEST_STATEMENT_R2_BINDING_SHA256", "A".repeat(64)],
    ];
    for (const [name, value] of cases) {
      const env = { ...values(), [name]: value };
      const error = refusal(() => selectQualificationMode(["--live", "--receipts=r.json"], n => env[n]));
      expect(error.code).toBe("qualification_live_environment_invalid");
      expect(error.names).toEqual([name]);
      expect(error.message.includes(value)).toBe(false);
    }
    const env = values(), live = selectQualificationMode(["--live", "--receipts=r.json"], n => env[n]);
    expect(live.mode).toBe("live");
    if (live.mode === "live") {
      expect(live.configuration).toEqual({ bucket: env.INHERIT_TEST_STATEMENT_R2_BUCKET, bindingSha256: env.INHERIT_TEST_STATEMENT_R2_BINDING_SHA256 });
      expect(Buffer.from(live.key).toString("base64")).toBe(env.INHERIT_TEST_STATEMENT_GATEWAY_KEY);
    }
    expect(refusalCode(() => createSignedGatewayProvider({ url: new URL("https://gateway.example.test/other"), key: randomBytes(32) })))
      .toBe("provider_configuration_refused");
  });

  it("runs the entry dry with the network disabled, and refuses a live run with a missing variable without printing values", () => {
    const blocked = "data:text/javascript,globalThis.fetch=()=>{throw new Error('network_refused_in_test')}";
    // Only what Node and tsx need; none of the four gateway variables.
    const base: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmpdir() };
    const dry = spawnSync(process.execPath, ["--import", "tsx", "--import", blocked, ENTRY],
      { encoding: "utf8", env: base as NodeJS.ProcessEnv, timeout: 60_000 });
    expect(dry.status, dry.stderr).toBe(0);
    const report = JSON.parse(dry.stdout) as ReturnType<typeof dryPlanReport>;
    expect(report.contacted).toBe(false);
    expect(report.totals).toEqual(JSON.parse(JSON.stringify(dryPlanReport().totals)));

    const directory = mkdtempSync(path.join(tmpdir(), "statement-qualification-"));
    try {
      const env = values(); const sentinel = Object.values(env);
      delete env.INHERIT_TEST_STATEMENT_R2_BINDING_SHA256;
      const receipts = path.join(directory, "receipt.json");
      const live = spawnSync(process.execPath, ["--import", "tsx", "--import", blocked, ENTRY, "--live", `--receipts=${receipts}`],
        { encoding: "utf8", env: { ...base, ...env } as NodeJS.ProcessEnv, timeout: 60_000 });
      expect(live.status).toBe(2);
      expect(JSON.parse(live.stderr.trim())).toEqual({ refused: "qualification_live_environment_missing",
        names: ["INHERIT_TEST_STATEMENT_R2_BINDING_SHA256"] });
      for (const value of sentinel) expect(`${live.stdout}${live.stderr}`.includes(value)).toBe(false);
      expect(existsSync(receipts)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);

  it("adds earlier attempts' spent operations and unproved bytes to the same budget", () => {
    const prior = (debitedTotal: number, classB: number, possiblyStoredBytesAtEnd: number) => JSON.stringify({
      version: "requester-statement-archive-qualification-receipt-v1", possiblyStoredBytesAtEnd,
      ledger: { debited: { classA: 0, classB, delete: 0 }, debitedTotal, storedBytesBound: 0 } });
    expect(sumPriorReceipts([prior(100, 100, 0), prior(50, 50, 1_024)])).toEqual({ operations: 150, storedBytes: 1_024 });
    expect(refusalCode(() => sumPriorReceipts([prior(99, 100, 0)]))).toBe("prior_receipt_refused");
    expect(refusalCode(() => sumPriorReceipts(["{}"]))).toBe("prior_receipt_refused");
    expect(refusalCode(() => dryPlanReport({ operations: 1_959, storedBytes: 0 }))).toBe("budget_plan_operations_refused");
  });
});
