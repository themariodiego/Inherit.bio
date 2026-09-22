import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadPersonas, participantPersonaPrompt, type Persona } from "./personas";
import type { PatternFile } from "./prohibited";
import { digest, freeze, opaque, settingsSchema, taskIds, type Settings } from "./conductor-contract";

export const qualificationBlockers = ["published-identity-pin-policy-unresolved", "external-process-isolation-unproven",
  "production-build-under-test-jurisdiction-unverified", "T6-real-fixture-unready", "T7-real-fixture-unready",
  "T9-real-fixture-unready", "T10-real-fixture-unready",
  "provider-token-and-cost-bounds-unverified"] as const;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const taskSchema = z.object({ id: z.enum(taskIds), prompt: z.string().min(1), account: z.string().min(1),
  fixtures: z.array(z.string().min(1)), withheldVariant: z.object({ prompt: z.string().min(1) }).passthrough().optional(),
}).passthrough();
const bindingsSchema = z.object({ tasks: z.array(taskSchema).length(10) }).passthrough();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    participantPrompts: sha256(JSON.stringify(personas.map(participantPersonaPrompt))), instrumentVersion: sha256("dry-conductor-v1") };
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
