import { describe, expect, it, vi } from "vitest";
import { assertEmptyHost, assertSameResources, disposeOwnedStack, infrastructureChildEnvironment,
  infrastructureReservation, ownedStack, type Resource, type ResourceIO } from "./fresh-t6-resources";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SpendJournal } from "./budget";

const resources = (id: string): Resource[] => [
  ...["db", "storage", "kong"].map(name => ({ kind: "container" as const,
    name: `supabase_${name}_sequence`, identity: `${name}-${id}`, project: "sequence" })),
  { kind: "network", name: "supabase_network_sequence", identity: `net-${id}`, project: "sequence" },
  { kind: "volume", name: "supabase_db_sequence", identity: `created-${id}`, project: "sequence" },
];
const fakeIO = (snapshots: Resource[][]) => ({ inventory: vi.fn(async () => snapshots.shift()!), command: vi.fn(async () => "") } satisfies ResourceIO);

describe("fresh T6 exact resource ownership (synthetic IO only)", () => {
  it("closes one exact owned stack before allowing a distinct second persona stack", async () => {
    const release = vi.fn(async () => {}), stop = vi.fn(async () => {});
    const first = resources("a"), second = resources("b");
    const io = fakeIO([first, [], second, []]);
    await disposeOwnedStack(first, io, stop, release);
    expect(stop).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    await disposeOwnedStack(second, io, stop, release);
    expect(stop).toHaveBeenCalledTimes(2); expect(release).toHaveBeenCalledTimes(2);
    expect(first.map(item => item.identity).some(id => second.some(item => item.identity === id))).toBe(false);
  });
  it.each(["container", "volume", "network"] as const)("refuses replacement %s identity before deletion", async kind => {
    const original = resources("a"), crossed = structuredClone(original);
    crossed.find(item => item.kind === kind)!.identity = "replacement";
    const stop = vi.fn(async () => {}), release = vi.fn(async () => {});
    await expect(disposeOwnedStack(original, fakeIO([crossed]), stop, release)).rejects.toThrow("identity changed");
    expect(stop).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });
  it("retains the lock when stop fails or leaves even one owned resource", async () => {
    const original = resources("a"), release = vi.fn(async () => {});
    await expect(disposeOwnedStack(original, fakeIO([original]), async () => { throw new Error("uncertain"); }, release)).rejects.toThrow("uncertain");
    await expect(disposeOwnedStack(original, fakeIO([original, [original[0]]]), async () => {}, release)).rejects.toThrow("existing");
    expect(release).not.toHaveBeenCalled();
  });
  it("refuses a prior stack, browser runtime, missing service, duplicate or unrelated resource", () => {
    expect(() => assertEmptyHost(resources("old"))).toThrow("existing");
    expect(() => assertEmptyHost([{ kind: "container", name: "inherit-ci-browser-runtime", identity: "old", project: "unassigned" }])).toThrow("existing");
    expect(() => ownedStack(resources("a").slice(1))).toThrow("Incomplete");
    expect(() => ownedStack([...resources("a"), resources("a")[0]])).toThrow("Duplicate");
    expect(() => ownedStack([...resources("a"), { kind: "volume", name: "unrelated", identity: "x", project: "sequence" }])).toThrow("Unregistered");
    expect(() => assertSameResources(resources("a"), resources("b"))).toThrow("changed");
  });
  it("bounds every stack including build bootstrap before setup", () => {
    expect(infrastructureReservation(2, 1_000_000, 3_000_000)).toBe(3_000_000);
    for (const args of [[2, 1_000_000, 2_999_999], [0, 1, 2], [31, 1, 100], [1, 0, 100]])
      expect(() => infrastructureReservation(...args as [number, number, number])).toThrow();
  });
  it("scrubs inference and application credentials from infrastructure children", () => {
    const clean = infrastructureChildEnvironment({ PATH: "/bin", HOME: "/home/runner", CI: "true", COMPREHENSION_MODEL_API_KEY: "EXAMPLE_NO_REAL_CREDENTIAL",
      SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_NO_REAL_CREDENTIAL", UNRELATED_PROVIDER_KEY: "EXAMPLE_NO_REAL_CREDENTIAL", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "EXAMPLE_NO_REAL_CREDENTIAL" });
    expect(clean).toEqual({ NODE_ENV: "production", PATH: "/bin", HOME: "/home/runner", CI: "true" });
  });
});

const config = { maximumInfrastructureCostPerStackMicroDollars: 100, run: { schemaVersion: 1, kind: "smoke", tasks: ["T6"], personas: 2,
  effortDirectory: "/tmp/private-effort", stubRecordRoot: "/tmp/private-records", samplingSeed: "d".repeat(64),
  limitMicroDollars: 1000, otherCostsMicroDollars: 300, provider: { kind: "local-deterministic-stub" },
  settings: { temperature: 0, maxSteps: 8, maxAttempts: 1, timeoutMs: 60000, sessionSetupTimeoutMs: 900000,
    maximumInputTokens: 32000, maximumOutputTokens: 4000, price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } } } };
it("keeps T7, ordinary tasks, withheld fixtures and full-round claims out of this separate launcher", () => {
  expect(freshT6ConfigSchema.safeParse(config).success).toBe(true);
  for (const changed of [{ tasks: ["T7"] }, { tasks: ["T1", "T6"] }, { t6Variant: "withheld" }, { kind: "live-run" }, { limitMicroDollars: 599, otherCostsMicroDollars: 300 }])
    expect(freshT6ConfigSchema.safeParse({ ...config, run: { ...config.run, ...changed } }).success).toBe(false);
});
it("manual workflow executes only the separate stub launcher with two personas and no paid key or ordinary CI hook", () => {
  const workflow = readFileSync(".github/workflows/participant-c-smoke.yml", "utf8");
  expect(workflow).toContain("workflow_dispatch:"); expect(workflow).toContain("fresh-t6:");
  expect(workflow).toContain("run-fresh-t6.mts"); expect(workflow).not.toMatch(/secrets\.|COMPREHENSION_MODEL_API_KEY|run-upload-browser/);
  const ordinary = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(ordinary).not.toContain("run-fresh-t6");
});

it("retains each uncertain stack maximum across effort-journal reopen and repeated runs before any model reservation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inherit-t6-budget-"));
  const filename = path.join(directory, "spend.jsonl");
  let journal = await SpendJournal.open(filename, 1000, 100);
  try {
    await journal.reserve("fresh-build-run-one", 100);
    await journal.reserve("fresh-stack-persona-one", 100);
    expect(journal.remaining).toBe(700);
    await journal.close();
    journal = await SpendJournal.open(filename, 1000, 100);
    expect(journal.remaining).toBe(700);
    await journal.reserve("fresh-build-run-two", 100);
    await journal.reserve("fresh-stack-persona-two", 100);
    expect(journal.remaining).toBe(500);
    await expect(journal.reserve("model-attempt-over-cap", 501)).rejects.toThrow("refused");
    expect(journal.remaining).toBe(500);
  } finally { await journal.close(); await rm(directory, { recursive: true }); }
});
