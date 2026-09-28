/**
 * The operator's run configuration: a local, untracked JSON file named by
 * `INHERIT_COMPREHENSION_CONFIG`. It names the provider endpoint, the
 * credential variable and the exact model identifier. Keep it outside the
 * checkout, like the effort directory.
 *
 * Model identity follows the owner's decision of 25 September 2026
 * (`docs/protocol/decisions.md`): the pinned model identifier and temperature
 * appear only in the run records under `docs/comprehension-runs/<date>/`, as
 * G3.1 requires, and stay out of commit messages, pull-request text, comments
 * and code. So the harness writes the identifier into one place, the `model`
 * block of a real run's `manifest.json`, and nowhere else:
 *
 *  - the run manifest, which the spend journal and traces outside that
 *    directory also store, carries only a non-identifying `label`;
 *  - the label may not contain the identifier or any word of it;
 *  - the identifier reaches the settings digest only through a hash, so a
 *    changed model is a changed set of settings for the stopping rule;
 *  - nothing the runner prints or writes elsewhere contains it, and
 *    `identity-containment.test.ts` holds the repository to that.
 */
import path from "node:path";
import { z } from "zod";
import { digest, settingsSchema, taskIds } from "./conductor-contract";
import { inferenceLabel, liveRunKinds } from "./conductor-inputs";
import type { Provider } from "./inference-worker";

export const STUB_LABEL = "local/deterministic-stub";
const absolute = z.string().refine(value => path.isAbsolute(value), "Absolute path required");

const providerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-deterministic-stub") }).strict(),
  z.object({ kind: z.literal("openai-compatible-chat"), label: inferenceLabel, endpoint: z.string().url(),
    modelIdentifier: z.string().min(1).max(200), apiKeyVariable: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/) }).strict(),
]);
export const runConfigSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(liveRunKinds),
  /** Private directory outside Git: the spend journal and raw traces. */
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

/** A label must not carry the identifier or any of its words, because the
 * label also travels where the identifier may not: the journal and logs. */
export function labelProblem(label: string, identifier: string): string | undefined {
  const words = identifier.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);
  const lower = label.toLowerCase();
  if (lower.includes(identifier.toLowerCase()) || words.some(word => lower.includes(word))) {
    return "The label must not contain the model identifier or any part of it";
  }
  return undefined;
}

export function inferenceOf(config: RunConfig) {
  return { label: config.provider.kind === "local-deterministic-stub" ? STUB_LABEL : config.provider.label,
    provider: config.provider.kind } as const;
}

/** The exact identifier, or null for the stub, which is not a model. */
export function modelIdentifierOf(config: RunConfig): string | null {
  return config.provider.kind === "local-deterministic-stub" ? null : config.provider.modelIdentifier;
}

/** What the settings digest hashes so a changed model or endpoint starts a
 * new stopping-rule sequence. Never written anywhere as it stands. */
export function modelIdentityOf(config: RunConfig): string {
  const provider = config.provider;
  return provider.kind === "local-deterministic-stub" ? provider.kind : `${provider.kind}\n${provider.endpoint}\n${provider.modelIdentifier}`;
}

export function workerProvider(config: RunConfig): Provider {
  const provider = config.provider;
  return provider.kind === "local-deterministic-stub" ? provider
    : { kind: provider.kind, endpoint: provider.endpoint, model: provider.modelIdentifier, apiKeyVariable: provider.apiKeyVariable };
}
