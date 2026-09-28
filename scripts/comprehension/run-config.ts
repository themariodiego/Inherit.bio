/**
 * The operator's run configuration: a local, untracked JSON file named by
 * `INHERIT_COMPREHENSION_CONFIG`. It is the only place a provider endpoint,
 * credential variable name and exact model identifier appear.
 *
 * Model identity has two halves, and the tension is deliberate:
 *
 *  - The brief (G3.1) says the run artifact records the pinned model
 *    identifier. The owner decided on 25 September that it may appear in the
 *    run records under `docs/comprehension-runs/<date>/`.
 *  - The standing rule for this work forbids model identifiers anywhere that
 *    is committed or pushed.
 *
 * This harness follows the stricter rule. A committed record carries only a
 * non-identifying label (`provider-a/config-1`) and a salted SHA-256
 * commitment to the identifier and endpoint. The exact identifier and the salt
 * go to `<effortDirectory>/identity/<runId>.json`, a private file outside any
 * Git checkout, which proves which model ran without publishing it. Every
 * record carries the blocker `pinned-identifier-held-locally-not-in-record`
 * until the owner chooses how G3.1's wording is met.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { digest, settingsSchema, taskIds } from "./conductor-contract";
import { inferenceLabel, liveRunKinds } from "./conductor-inputs";
import type { Provider } from "./inference-worker";
import { privateDirectory } from "./instrument-journal";

export const IDENTITY_BLOCKER = "pinned-identifier-held-locally-not-in-record";
export const STUB_LABEL = "local/deterministic-stub";
const absolute = z.string().refine(value => path.isAbsolute(value), "Absolute path required");

const providerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-deterministic-stub") }).strict(),
  z.object({ kind: z.literal("openai-compatible-chat"), label: inferenceLabel, endpoint: z.string().url(),
    modelIdentifier: z.string().min(1).max(200), apiKeyVariable: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    // Generated once per model configuration and kept with it, so the same
    // configuration commits to the same value across runs.
    identitySalt: digest }).strict(),
]);
export const runConfigSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(liveRunKinds),
  /** Private directory outside Git: the spend journal, raw traces and identity files. */
  effortDirectory: absolute,
  tasks: z.array(z.enum(taskIds)).min(1).max(10).optional(),
  personas: z.number().int().min(1).max(30).optional(),
  samplingSeed: digest,
  t6Variant: z.enum(["standard", "withheld"]).optional(),
  settings: settingsSchema,
  limitMicroDollars: z.number().int().positive().max(50_000_000),
  otherCostsMicroDollars: z.number().int().nonnegative(),
  /** For a paid full run: the calibration record whose measured cost bounds it. */
  calibration: z.string().optional(),
  /** Where a stub run's record goes. A real provider's record always goes under docs/comprehension-runs. */
  stubRecordRoot: absolute.optional(),
  provider: providerSchema,
}).strict().superRefine((config, context) => {
  if (config.provider.kind === "openai-compatible-chat") {
    const problem = labelProblem(config.provider.label, config.provider.modelIdentifier);
    if (problem) context.addIssue({ code: "custom", path: ["provider", "label"], message: problem });
    if (config.kind === "live-run" && !config.calibration) {
      context.addIssue({ code: "custom", path: ["calibration"], message: "A paid full run needs a calibration record first" });
    }
  } else if (!config.stubRecordRoot) {
    context.addIssue({ code: "custom", path: ["stubRecordRoot"], message: "A stub run records outside docs/comprehension-runs" });
  }
});
export type RunConfig = z.infer<typeof runConfigSchema>;

/** A label must not carry the identifier or any of its words. */
export function labelProblem(label: string, identifier: string): string | undefined {
  const words = identifier.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);
  const lower = label.toLowerCase();
  if (lower.includes(identifier.toLowerCase()) || words.some(word => lower.includes(word))) {
    return "The label must not contain the model identifier or any part of it";
  }
  return undefined;
}

export function identityCommitment(config: RunConfig): string {
  const provider = config.provider;
  if (provider.kind === "local-deterministic-stub") return createHash("sha256").update("inherit-comprehension-stub-v1").digest("hex");
  return createHash("sha256")
    .update(`inherit-comprehension-identity-v1\n${provider.identitySalt}\n${provider.modelIdentifier}\n${provider.endpoint}`).digest("hex");
}

export function inferenceOf(config: RunConfig) {
  return { label: config.provider.kind === "local-deterministic-stub" ? STUB_LABEL : config.provider.label,
    provider: config.provider.kind, identityCommitment: identityCommitment(config) } as const;
}

export function workerProvider(config: RunConfig): Provider {
  const provider = config.provider;
  return provider.kind === "local-deterministic-stub" ? provider
    : { kind: provider.kind, endpoint: provider.endpoint, model: provider.modelIdentifier, apiKeyVariable: provider.apiKeyVariable };
}

/** Strings that must never appear in a committed record. */
export function forbiddenInRecord(config: RunConfig): string[] {
  return config.provider.kind === "local-deterministic-stub" ? [] : [config.provider.modelIdentifier, config.provider.identitySalt];
}

/** The exact identity, only in the private effort directory. */
export async function writeIdentityFile(config: RunConfig, runId: string, temperature: { participant: number; grader: number }) {
  await privateDirectory(config.effortDirectory);
  const directory = path.join(config.effortDirectory, "identity");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = path.join(directory, `${runId}.json`);
  const provider = config.provider;
  await writeFile(file, JSON.stringify({ runId, commitment: identityCommitment(config),
    ...(provider.kind === "openai-compatible-chat" ? { label: provider.label, endpoint: provider.endpoint,
      modelIdentifier: provider.modelIdentifier, identitySalt: provider.identitySalt } : { label: STUB_LABEL }),
    temperature, recordedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return file;
}
