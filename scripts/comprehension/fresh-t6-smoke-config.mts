import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertCiRuntime } from "../ci-browser-config";
assertCiRuntime(process.env);
assert(process.env.GITHUB_JOB === "fresh-t6", "Separate instrument job required");
const effortDirectory = path.join(process.env.RUNNER_TEMP!, "inherit-t6-effort");
const stubRecordRoot = path.join(process.env.RUNNER_TEMP!, "inherit-t6-records");
await mkdir(effortDirectory, { mode: 0o700 });
await mkdir(stubRecordRoot, { mode: 0o700 });
await writeFile(path.join(process.env.RUNNER_TEMP!, "inherit-t6-smoke.json"), JSON.stringify({
  maximumInfrastructureCostPerStackMicroDollars: 1_000_000,
  run: { schemaVersion: 1, kind: "smoke", tasks: ["T6"], personas: 2, t6Variant: "standard",
    effortDirectory, stubRecordRoot, samplingSeed: "d".repeat(64), limitMicroDollars: 50_000_000,
    otherCostsMicroDollars: 0, provider: { kind: "local-deterministic-stub" },
    settings: { maxSteps: 8, maxAttempts: 1, timeoutMs: 60_000, sessionSetupTimeoutMs: 900_000,
      maximumInputTokens: 32_000, maximumOutputTokens: 4_000, temperature: 0, graderTemperature: 0,
      price: { inputMicroDollarsPerMillion: 1_000_000, outputMicroDollarsPerMillion: 1_000_000 } } },
}), { flag: "wx", mode: 0o600 });
