import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadPersonas, participantPersonaPrompt, type Persona } from "./personas";
import { findRepositoryRoot } from "./repository";
import type { PatternFile } from "./prohibited";
import { digest, freeze, opaque, settingsSchema, taskIds, type Settings } from "./conductor-contract";

export const qualificationBlockers = ["pinned-identity-run-record-unbuilt", "external-process-isolation-unproven",
  "production-build-under-test-jurisdiction-unverified", "T6-real-fixture-unready", "T7-real-fixture-unready",
  "T9-real-fixture-unready", "T10-real-fixture-unready",
  "provider-token-and-cost-bounds-unverified"] as const;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const taskSchema = z.object({ id: z.enum(taskIds), prompt: z.string().min(1), account: z.string().min(1),
  fixtures: z.array(z.string().min(1)), withheldVariant: z.object({ prompt: z.string().min(1) }).passthrough().optional(),
}).passthrough();
const bindingsSchema = z.object({ tasks: z.array(taskSchema).length(10) }).passthrough();
const root = findRepositoryRoot();
export const repositoryRoot = root;
export type ConductorInputs = Readonly<{ personas: readonly Persona[]; tasks: readonly z.infer<typeof taskSchema>[];
  rubric: string; patterns: PatternFile; pins: Record<string, string>; inputDigest: string }>;

/** Pin actual source bytes before any adapter opens. These are instrument
 * inputs, never evidence that the corresponding browser fixture is ready. */
export function loadConductorInputs(repository = root): ConductorInputs {
  const read = (name: string) => readFileSync(path.join(repository, name), "utf8");
  const sources = { personas: read("scripts/comprehension/personas.json"), bindings: read("scripts/comprehension/bindings.json"),
    rubric: read("scripts/comprehension/rubric.md"), patterns: read("scripts/comprehension/prohibited-patterns.json"),
    protocol: read("docs/comprehension-protocol.md"), routes: read("docs/route-register.json") };
  const tasks = bindingsSchema.parse(JSON.parse(sources.bindings)).tasks;
  if (tasks.some((task, index) => task.id !== taskIds[index])) throw new Error("Incomplete task binding order");
  const fixtures: Record<string, string> = {};
  for (const task of tasks) for (const name of task.fixtures) {
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("Invalid fixture path");
    fixtures[name] = sha256(read(name));
  }
  const personas = loadPersonas(path.join(repository, "scripts/comprehension/personas.json"));
  const pins = { ...Object.fromEntries(Object.entries(sources).map(([key, text]) => [key, sha256(text)])),
    fixtures: sha256(JSON.stringify(fixtures)), rubricSelection: sha256("shared-preamble-and-exact-task-section-v1"),
    participantPrompts: sha256(JSON.stringify(personas.map(participantPersonaPrompt))), instrumentVersion: sha256("dry-conductor-v1"),
    // The worker renders every participant and grading prompt, so a change to
    // it is a change of settings and starts a new stopping-rule sequence.
    inferenceWorker: sha256(read("scripts/comprehension/inference-worker.ts")) };
  const content = { personas, tasks, rubric: sources.rubric, patterns: JSON.parse(sources.patterns) as PatternFile, pins };
  return freeze({ ...content, inputDigest: computeInputDigest(content) });
}
export function computeInputDigest(content: Pick<ConductorInputs, "personas" | "tasks" | "rubric" | "patterns" | "pins">): string {
  return sha256(JSON.stringify({ personas: content.personas, tasks: content.tasks, rubric: content.rubric,
    patterns: content.patterns, pins: content.pins }));
}
export const manifestSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("instrument-dry-run"),
  qualifyingEvidence: z.literal(false), runId: opaque, revision: z.string().regex(/^[0-9a-f]{40}$/),
  samplingSeed: digest, inputDigest: digest, settingsDigest: digest, settings: settingsSchema,
  t6Variant: z.enum(["standard", "withheld"]), personaIds: z.array(opaque).length(30),
  pins: z.record(z.string(), digest), qualificationBlockers: z.tuple(qualificationBlockers.map(value => z.literal(value)) as [
    z.ZodLiteral<(typeof qualificationBlockers)[number]>, ...z.ZodLiteral<(typeof qualificationBlockers)[number]>[]]),
}).strict();
export type RunManifest = z.infer<typeof manifestSchema>;

/** A live run's kind. Only a `live-run` of all 30 personas on all ten tasks
 * counts toward G3.3's stopping rule; `calibration` measures cost on a small
 * slice before any full run, and `smoke` proves the harness end to end. */
export const liveRunKinds = ["live-run", "calibration", "smoke"] as const;
export const providerKinds = ["local-deterministic-stub", "openai-compatible-chat"] as const;
/** A non-identifying label such as `provider-a/config-1`. It travels with the
 * run manifest into the journal and logs; the exact identifier appears only in
 * the committed run record's `model` block (run-config.ts, run-record.ts). */
export const inferenceLabel = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const sha40 = z.string().regex(/^[0-9a-f]{40}$/);
export const liveManifestSchema = z.object({ schemaVersion: z.literal(1), kind: z.enum(liveRunKinds),
  qualifyingEvidence: z.boolean(), runId: opaque, revision: sha40, samplingSeed: digest, inputDigest: digest,
  settingsDigest: digest, settings: settingsSchema, t6Variant: z.enum(["standard", "withheld"]),
  personaIds: z.array(opaque).min(1).max(30), taskIds: z.array(z.enum(taskIds)).min(1).max(10),
  pins: z.record(z.string(), digest),
  inference: z.object({ label: inferenceLabel, provider: z.enum(providerKinds) }).strict(),
  build: z.object({ baseUrl: z.string().regex(/^http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}$/),
    buildId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), jurisdiction: z.literal("TEST-LOCAL") }).strict(),
  skipped: z.array(z.object({ taskId: z.enum(taskIds), reason: z.string().min(1).max(1000) }).strict()),
  blockers: z.array(z.string().regex(/^[A-Za-z0-9-]{1,80}$/)),
}).strict().superRefine((manifest, context) => {
  if (manifest.qualifyingEvidence !== (manifest.blockers.length === 0)) {
    context.addIssue({ code: "custom", message: "Qualifying evidence requires an empty blocker list" });
  }
  if (new Set(manifest.taskIds).size !== manifest.taskIds.length || new Set(manifest.personaIds).size !== manifest.personaIds.length) {
    context.addIssue({ code: "custom", message: "Duplicate task or persona" });
  }
  if (manifest.skipped.some(skip => !manifest.taskIds.includes(skip.taskId))) {
    context.addIssue({ code: "custom", message: "A skipped task must be one of the run's tasks" });
  }
});
export type LiveManifest = z.infer<typeof liveManifestSchema>;
export type AnyManifest = RunManifest | LiveManifest;
export const isFullRun = (manifest: AnyManifest) =>
  manifest.kind === "instrument-dry-run" || (manifest.kind === "live-run" && manifest.taskIds.length === 10 && manifest.personaIds.length === 30);
export const expectedSessions = (manifest: AnyManifest) =>
  manifest.personaIds.length * (manifest.kind === "instrument-dry-run" ? 10 : manifest.taskIds.length);

/** Tasks whose bound account no seed can build yet, with the binding's own
 * reason. These are recorded as skipped, never as passed or failed answers. */
export function seedSkips(repository = root): { taskId: (typeof taskIds)[number]; reason: string }[] {
  const bindings = z.object({
    accounts: z.array(z.object({ id: z.string(), seed: z.unknown().optional(), seedBlockedBy: z.string().optional() }).passthrough()),
    tasks: z.array(z.object({ id: z.enum(taskIds), account: z.string() }).passthrough()),
  }).passthrough().parse(JSON.parse(readFileSync(path.join(repository, "scripts/comprehension/bindings.json"), "utf8")));
  return bindings.tasks.flatMap(task => {
    const account = bindings.accounts.find(candidate => candidate.id === task.account);
    if (!account) throw new Error(`Task ${task.id} names an unbound account`);
    return account.seed === null && account.seedBlockedBy
      ? [{ taskId: task.id, reason: `${account.id} cannot be seeded: ${account.seedBlockedBy}` }] : [];
  });
}

/** Model configuration is part of "the same settings" for the stopping rule:
 * a changed label, provider, endpoint or model starts a new sequence. The
 * model identity enters only as a hash, so the manifest never carries it. */
export function liveSettingsDigest(inputDigest: string, manifest: Pick<LiveManifest, "settings" | "t6Variant" | "inference">,
  modelIdentity: string): string {
  return sha256(JSON.stringify({ inputs: inputDigest, settings: manifest.settings, t6Variant: manifest.t6Variant,
    inference: manifest.inference, model: sha256(modelIdentity) }));
}

export function createLiveManifest(inputs: ConductorInputs, input: { kind: (typeof liveRunKinds)[number]; runId: string;
  revision: string; samplingSeed: string; settings: Settings; t6Variant?: "standard" | "withheld";
  taskIds: readonly (typeof taskIds)[number][]; personaIds: readonly string[];
  inference: LiveManifest["inference"]; modelIdentity: string; build: LiveManifest["build"];
  skipped: LiveManifest["skipped"]; blockers: readonly string[] }): Readonly<LiveManifest> {
  if (computeInputDigest(inputs) !== inputs.inputDigest) throw new Error("Instrument input digest mismatch");
  const settings = settingsSchema.parse(input.settings), t6Variant = input.t6Variant ?? "standard";
  const known = new Set(inputs.personas.map(persona => persona.id));
  if (input.personaIds.some(id => !known.has(id))) throw new Error("Unknown persona");
  const settingsDigest = liveSettingsDigest(inputs.inputDigest, { settings, t6Variant, inference: input.inference }, input.modelIdentity);
  const blockers = [...new Set([...input.blockers, ...(input.kind === "live-run" ? [] : [`${input.kind}-is-not-a-full-run`]),
    ...(input.inference.provider === "local-deterministic-stub" ? ["stub-provider-is-not-evidence"] : []),
    ...input.skipped.map(skip => `${skip.taskId}-skipped`)])].sort();
  return freeze(liveManifestSchema.parse({ schemaVersion: 1, kind: input.kind, qualifyingEvidence: blockers.length === 0,
    runId: input.runId, revision: input.revision, samplingSeed: input.samplingSeed, inputDigest: inputs.inputDigest,
    settingsDigest, settings, t6Variant, personaIds: [...input.personaIds], taskIds: [...input.taskIds], pins: inputs.pins,
    inference: input.inference, build: input.build, skipped: input.skipped, blockers }));
}

export function createManifest(inputs: ConductorInputs, input: { runId: string; revision: string; samplingSeed: string;
  settings: Settings; t6Variant?: "standard" | "withheld" }) {
  if (computeInputDigest(inputs) !== inputs.inputDigest) throw new Error("Instrument input digest mismatch");
  const settings = settingsSchema.parse(input.settings), t6Variant = input.t6Variant ?? "standard";
  const value = manifestSchema.parse({ schemaVersion: 1, kind: "instrument-dry-run", qualifyingEvidence: false,
    runId: input.runId, revision: input.revision, samplingSeed: input.samplingSeed, inputDigest: inputs.inputDigest,
    settingsDigest: sha256(JSON.stringify({ inputs: inputs.inputDigest, settings, t6Variant })), settings,
    t6Variant, personaIds: inputs.personas.map(persona => persona.id), pins: inputs.pins, qualificationBlockers });
  return freeze(value);
}

/** The shared instrument's preamble plus its exact task block, with no task
 * metadata, page state, persona, completion flag or prior verdict appended. */
export function taskRubric(rubric: string, taskId: (typeof taskIds)[number]): string {
  const sections = [...rubric.matchAll(/^## (T[1-9]|T10) —/gm)];
  if (sections.length !== 10 || sections.some((section, index) => section[1] !== taskIds[index])) {
    throw new Error("Missing or reordered grading instrument section");
  }
  const index = taskIds.indexOf(taskId), start = sections[index].index;
  return rubric.slice(0, sections[0].index) + rubric.slice(start, sections[index + 1]?.index ?? rubric.length);
}
