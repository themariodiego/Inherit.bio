/** Public hosted launcher contract. It grants no native capability. */
import assert from "node:assert/strict";
import path from "node:path";
import { z } from "zod";
import { RunHistory, type HistoryEvent } from "./run-history";
import { liveManifestSchema } from "./conductor-inputs";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { browserRecordSchema, viewSchema, actionSchema, verdictSchema } from "./conductor-contract";
import { maximumTokenCost } from "./budget";

export const HOSTED_OWNED_SMOKE_LIMITS = Object.freeze({ wholeMs: 2_880_000, readyMs: 10_000,
  inputMs: 10_000, settlementMs: 5_000, outputBytes: 16 * 1024 * 1024 });
export const HOSTED_OWNED_CORE_PINS = Object.freeze({
  "scripts/comprehension/run-owned-linux.mts": "73814044db8cac3dd2e4e47a4cda01dc979fa45c03a54c838a5c59d4bc55d042",
  "scripts/owned-linux-runtime.ts": "09684ce85ae879498b3fb4d9af45f2fa7bdd43e5b57bd87b02d22352f25c9959",
});
export function hostedSmokeFrame(directory: string) {
  assert(path.isAbsolute(directory) && path.resolve(directory) === directory);
  return { configuration: freshT6ConfigSchema.parse({ maximumInfrastructureCostPerStackMicroDollars: 1_000_000,
    run: { schemaVersion: 1, kind: "smoke", tasks: ["T6", "T7"], personas: 2, t6Variant: "standard",
      effortDirectory: path.join(directory, "effort"), stubRecordRoot: path.join(directory, "records"),
      samplingSeed: "d".repeat(64), limitMicroDollars: 50_000_000, otherCostsMicroDollars: 0,
      provider: { kind: "local-deterministic-stub" }, settings: { maxSteps: 8, maxAttempts: 1,
        timeoutMs: 60_000, sessionSetupTimeoutMs: 900_000, maximumInputTokens: 32_000,
        maximumOutputTokens: 4_000, temperature: 0, graderTemperature: 0,
        price: { inputMicroDollarsPerMillion: 1_000_000, outputMicroDollarsPerMillion: 1_000_000 } } } }) };
}
/** Reject credentials, real providers, unknown fields and any changed bound. */
export function canonicalHostedSmokeFrame(input: unknown, directory: string) {
  assert.deepEqual(input, hostedSmokeFrame(directory), "Only the fixed public key-free frame is admitted");
  const frame = JSON.stringify(input) + "\n";
  assert(Buffer.byteLength(frame) < 65536); return frame;
}
export function hostedOwnedEnvironment(input: { uid: number; gid: number; home: string; actualHome: string; path: string }) {
  assert(Number.isSafeInteger(input.uid) && input.uid > 0 && Number.isSafeInteger(input.gid) && input.gid > 0,
    "Positive native user and group required");
  assert(path.isAbsolute(input.home) && input.home === input.actualHome && path.resolve(input.home) === input.home
    && input.path.length > 0 && !input.path.includes("\0"), "Actual home and executable path required");
  return { PATH: input.path, HOME: input.home, LANG: "C.UTF-8", NODE_ENV: "production" as const, TZ: "UTC" };
}
export function assertHostedSmokeReady(line: string, nonce: string) {
  assert(/^[a-f0-9-]{36}$/.test(nonce) && line === `OWNED_LINUX_READY:${nonce}\n`, "Exact owned readiness required");
}
/** Complete four-session record selection; never upload app logs, keys or owner files. */
export function selectHostedSmokeArtifacts(input: { manifest: unknown; responses: unknown[]; assessment: unknown }, head: string) {
  const record = input.manifest as { status?: unknown; failure?: unknown; model?: { identifier?: unknown; provider?: unknown }; manifest?: unknown };
  const manifest = liveManifestSchema.parse(record.manifest);
  assert(record.status === "completed" && record.failure === "none" && manifest.revision === head && manifest.kind === "smoke"
    && manifest.inference.provider === "local-deterministic-stub" && !manifest.qualifyingEvidence
    && record.model?.identifier === null && record.model.provider === "local-deterministic-stub"
    && manifest.personaIds.length === 2 && new Set(manifest.personaIds).size === 2
    && JSON.stringify(manifest.taskIds) === '["T6","T7"]' && manifest.skipped.length === 0
    && JSON.stringify(manifest.settings) === JSON.stringify(hostedSmokeFrame("/public/unit").configuration.run.settings),
  "Complete exact source-bound key-free smoke required");
  const expected = new Set(manifest.personaIds.flatMap(persona => manifest.taskIds.map(task => `${persona}:${task}`)));
  const sessions = new Set<string>();
  assert(input.responses.length === 4);
  for (const raw of input.responses) {
    const row = raw as { personaId: string; taskId: string; status: string; sessionId: string; costMicroDollars: number };
    assert(row.status === "answered" && expected.delete(`${row.personaId}:${row.taskId}`)
      && typeof row.sessionId === "string" && row.sessionId.length > 0 && !sessions.has(row.sessionId)
      && Number.isSafeInteger(row.costMicroDollars) && row.costMicroDollars >= 0
      && row.costMicroDollars <= 50_000_000, "Four distinct native sessions with bounded dry accounting required");
    sessions.add(row.sessionId);
  }
  assert(expected.size === 0);
  const assessment = input.assessment as { qualifyingEvidence?: unknown; assessable?: unknown };
  assert(assessment.qualifyingEvidence === false && assessment.assessable === false);
  return ["manifest.json", "responses.jsonl", "assessment.json"] as const;
}

export function verifyHostedSmokeArtifact(value: unknown, head: string, tree: string) {
  const artifact = z.object({ terminal: z.object({ schemaVersion: z.literal(1), head: z.literal(head), tree: z.literal(tree),
    uid: z.number().int().positive().safe(), gid: z.number().int().positive().safe(), bootId: z.string().uuid(), nonce: z.string().uuid(),
    corePins: z.record(z.string(), z.string()), ready: z.literal(true), exitCode: z.literal(0), signal: z.null(),
    timedOut: z.literal(false), closed: z.literal(true), groupAbsent: z.literal(true), refusal: z.literal(false),
    qualifyingEvidence: z.literal(false), paidInference: z.literal(false) }).strict(),
    records: z.object({ manifest: z.unknown(), responses: z.array(z.unknown()), assessment: z.unknown() }).strict(),
    history: z.string().min(1).max(16 * 1024 * 1024), spend: z.string().min(1).max(16 * 1024 * 1024) }).strict().parse(value);
  assert.deepEqual(artifact.terminal.corePins, HOSTED_OWNED_CORE_PINS);
  selectHostedSmokeArtifacts(artifact.records, head);
  const history = new RunHistory();
  assert(artifact.history.endsWith("\n"));
  const [header, ...events] = artifact.history.slice(0, -1).split("\n");
  assert(header === JSON.stringify({ kind: "instrument-only-history", version: 1 }));
  for (const line of events) history.apply(JSON.parse(line));
  assert(!history.unfinished && !history.resourceStopRequired);
  const starts = history.events.filter(event => event.kind === "start");
  const finishes = history.events.filter(event => event.kind === "finish");
  assert(starts.length === 1 && finishes.length === 1 && finishes[0].status === "completed"
    && finishes[0].failure === "none" && finishes[0].instrumentClean === false);
  assert.deepEqual(starts[0].manifest, (artifact.records.manifest as { manifest: unknown }).manifest);
  const runId = starts[0].manifest.runId;
  assert(history.events.every(event => event.kind === "start" || ("runId" in event && event.runId === runId)));
  const opened = history.events.filter(event => event.kind === "session-open");
  const sessions = history.events.filter(event => event.kind === "session");
  const ended = history.events.filter((event): event is Extract<HistoryEvent, { kind: "trace" }> => event.kind === "trace" && event.phase === "ended");
  assert(opened.length === 4 && sessions.length === 4 && ended.length === 4);
  const attempts = history.events.filter(event => event.kind === "attempt");
  const usages = history.events.filter(event => event.kind === "usage");
  assert(attempts.length === usages.length && usages.every(usage => usage.certain && usage.actual !== null));
  const expectedMaximum = maximumTokenCost(starts[0].manifest.settings.maximumInputTokens,
    starts[0].manifest.settings.maximumOutputTokens, starts[0].manifest.settings.price);
  const boundAttempts = new Set<string>();
  for (const raw of artifact.records.responses) {
    const row = z.object({ personaId: z.string(), taskId: z.string(), sessionId: z.string(),
      completed: z.boolean(), path: z.array(z.string()), actions: z.number(), entries: z.number(), answer: z.string(),
      verdict: verdictSchema, regrade: verdictSchema, costMicroDollars: z.number() }).passthrough().parse(raw);
    const identity = { runId, personaId: row.personaId, taskId: row.taskId, sessionId: row.sessionId };
    const open = opened.find(event => event.sessionId === row.sessionId);
    const session = sessions.find(event => event.sessionId === row.sessionId);
    const end = ended.find(event => event.sessionId === row.sessionId);
    assert(open && session && end);
    assert.deepEqual(open, { kind: "session-open", ...identity });
    assert.deepEqual({ runId: session.runId, personaId: session.personaId, taskId: session.taskId, sessionId: session.sessionId }, identity);
    const evidence = z.object({ kind: z.literal("live-run"), qualifyingEvidence: z.literal(false), record: browserRecordSchema,
      history: z.array(z.object({ view: viewSchema, action: actionSchema.optional() }).strict()).min(1).max(8),
      response: z.unknown(), processIds: z.array(z.string()).min(3).max(10) }).strict().parse(session.evidence);
    assert.deepEqual(evidence.record, { completed: row.completed, path: row.path, actions: row.actions,
      entries: row.entries, confirmationExclusions: [] });
    const response = { personaId: row.personaId, taskId: row.taskId, sessionId: row.sessionId, completed: row.completed,
      actions: row.actions, entries: row.entries, answer: row.answer, verdict: row.verdict, regrade: row.regrade };
    assert.deepEqual(evidence.response, response);
    const closure = z.object({ closed: z.literal(true), history: z.unknown(), answer: z.string(),
      processIds: z.array(z.string()) }).strict().parse(end.value);
    assert.deepEqual(closure.history, evidence.history);
    assert.deepEqual(closure.processIds, evidence.processIds); assert(closure.answer === row.answer);
    const during = history.events.slice(history.events.indexOf(open) + 1, history.events.indexOf(session));
    const calls = during.filter(event => event.kind === "attempt");
    assert(calls.length >= 3 && calls.length <= 10 && calls.every(call => call.attempt === 1 && call.maximum === expectedMaximum));
    assert.deepEqual(calls.map(call => call.role), [...calls.slice(0, -2).map(() => "participant"), "grader", "regrader"]);
    assert.deepEqual(calls.map(call => call.processId), evidence.processIds);
    for (const call of calls) { assert(!boundAttempts.has(call.id)); boundAttempts.add(call.id); }
    assert(row.costMicroDollars === calls.reduce((sum, call) => {
      const usage = usages.find(event => event.id === call.id); assert(usage?.actual !== null && usage?.actual !== undefined);
      return sum + usage.actual;
    }, 0));
  }
  assert(boundAttempts.size === attempts.length);
  assert(artifact.spend.endsWith("\n"));
  const [budget, ...entries] = artifact.spend.slice(0, -1).split("\n").map(line => JSON.parse(line));
  assert.deepEqual(budget, { kind: "budget", version: 1, limit: 50_000_000, otherCosts: 0 });
  const calls = new Map<string, { maximum: number; actual?: number }>();
  let remaining = 50_000_000;
  for (const raw of entries) {
    const entry = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reserve"), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), maximum: z.number().int().positive().safe() }).strict(),
      z.object({ kind: z.literal("settle"), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), actual: z.number().int().nonnegative().safe() }).strict(),
    ]).parse(raw);
    if (entry.kind === "reserve") {
      assert(!calls.has(entry.id) && entry.maximum <= remaining); remaining -= entry.maximum;
      calls.set(entry.id, { maximum: entry.maximum });
    } else {
      const call = calls.get(entry.id);
      assert(call && call.actual === undefined && entry.actual <= call.maximum);
      call.actual = entry.actual; remaining += call.maximum - entry.actual;
    }
  }
  const stacks = [...calls].filter(([id]) => id.startsWith("fresh-build-") || id.startsWith("fresh-stack-"));
  const builds = stacks.filter(([id]) => /^fresh-build-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
  assert(stacks.length === 5 && builds.length === 1
    && stacks.every(([, call]) => call.maximum === 1_000_000 && call.actual === undefined));
  assert.deepEqual(stacks.filter(([id]) => id.startsWith("fresh-stack-")).map(([id]) => id).sort(),
    artifact.records.responses.map(raw => `fresh-stack-${(raw as { sessionId: string }).sessionId}`).sort());
  assert(calls.size === attempts.length + 5);
  for (const attempt of attempts) {
    const call = calls.get(attempt.id), usage = usages.find(event => event.id === attempt.id);
    assert(call && usage && call.maximum === attempt.maximum && call.actual === usage.actual);
  }

  return { source: head, sessions: artifact.records.responses.length, qualifyingEvidence: false, paidInference: false };
}
