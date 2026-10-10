import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createLiveManifest, loadConductorInputs } from "./conductor-inputs";
import { assertOperatorHostEnvironment, assertOwnedLinuxInitialMemory } from "../owned-linux-runtime";
import { assertHostedSmokeReady, canonicalHostedSmokeFrame, hostedOwnedEnvironment, hostedSmokeFrame,
  HOSTED_OWNED_CORE_PINS, HOSTED_OWNED_SMOKE_LIMITS, selectHostedSmokeArtifacts, verifyHostedSmokeArtifact } from "./hosted-owned-smoke";
const directory = "/public/owned-smoke", head = "a".repeat(40), tree = "b".repeat(40);
const nonce = "00000000-0000-4000-8000-000000000001";
function records() {
  const inputs = loadConductorInputs(), settings = hostedSmokeFrame(directory).configuration.run.settings;
  const manifest = createLiveManifest(inputs, { kind: "smoke", runId: "synthetic-smoke-control", revision: head,
    samplingSeed: "d".repeat(64), settings, taskIds: ["T6", "T7"], personaIds: inputs.personas.slice(0, 2).map(row => row.id),
    inference: { label: "local/deterministic-stub", provider: "local-deterministic-stub" }, modelIdentity: "local-deterministic-stub",
    build: { baseUrl: "http://localhost:3100", buildId: "public-unit", jurisdiction: "TEST-LOCAL" }, skipped: [], blockers: [] });
  return { manifest: { status: "completed", failure: "none", manifest, model: { identifier: null, provider: "local-deterministic-stub" } },
    responses: manifest.personaIds.flatMap(personaId => manifest.taskIds.map(taskId => ({ personaId, taskId,
      sessionId: `${personaId}-${taskId}`, status: "answered", costMicroDollars: 17,
      completed: false, path: ["/overview"], actions: 0, entries: 0, answer: "Public deterministic control.",
      verdict: { passed: false, prohibited: false, noRouteFound: false },
      regrade: { passed: false, prohibited: false, noRouteFound: false } }))),
    assessment: { assessable: false, qualifyingEvidence: false } };
}
function artifact() {
  const selected = records(), manifest = selected.manifest.manifest, runId = manifest.runId;
  const spend: object[] = [{ kind: "budget", version: 1, limit: 50_000_000, otherCosts: 0 },
    { kind: "reserve", id: `fresh-build-${nonce}`, maximum: 1_000_000 }];
  const events: object[] = [{ kind: "start", manifest }];
  for (const row of selected.responses) {
    const { personaId, taskId, sessionId, completed, path, actions, entries, answer, verdict, regrade } = row;
    const history = [{ view: { path: "/overview", visibleText: "Public synthetic control", controls: [] } }];
    const processIds = ["participant", "grader", "regrader"].map(role => `${sessionId}-${role}`);
    events.push({ kind: "session-open", runId, personaId, taskId, sessionId });
    spend.push({ kind: "reserve", id: `fresh-stack-${sessionId}`, maximum: 1_000_000 });
    for (const [index, role] of ["participant", "grader", "regrader"].entries()) {
      const id = `${sessionId}-call-${index}`, actual = index === 0 ? 7 : 5;
      spend.push({ kind: "reserve", id, maximum: 36_000 }, { kind: "settle", id, actual });
      events.push({ kind: "attempt", runId, id, slot: `${id}-slot`, processId: processIds[index], role, attempt: 1, maximum: 36_000 },
        { kind: "usage", runId, id, certain: true, actual });
    }
    events.push({ kind: "session", runId, personaId, taskId, sessionId, evidence: { kind: "live-run", qualifyingEvidence: false,
      record: { completed, path, actions, entries, confirmationExclusions: [] }, history,
      response: { personaId, taskId, sessionId, completed, actions, entries, answer, verdict, regrade }, processIds } },
    { kind: "trace", runId, sessionId, phase: "ended", value: { closed: true, history, answer, processIds } });
  }
  events.push({ kind: "finish", runId, status: "completed", instrumentClean: false, failure: "none" });
  return { terminal: { schemaVersion: 1, head, tree, uid: 1001, gid: 1001, bootId: nonce, nonce,
    corePins: HOSTED_OWNED_CORE_PINS, ready: true, exitCode: 0, signal: null, timedOut: false, closed: true,
    groupAbsent: true, refusal: false, qualifyingEvidence: false, paidInference: false }, records: selected,
    history: [JSON.stringify({ kind: "instrument-only-history", version: 1 }), ...events.map(event => JSON.stringify(event))].join("\n") + "\n",
    spend: spend.map(event => JSON.stringify(event)).join("\n") + "\n" };
}

it("sends only the canonical fixed public frame with all original limits", () => {
  const frame = hostedSmokeFrame(directory);
  expect(canonicalHostedSmokeFrame(frame, directory)).toBe(JSON.stringify(frame) + "\n");
  expect(HOSTED_OWNED_SMOKE_LIMITS).toEqual({ wholeMs: 2880000, readyMs: 10000, inputMs: 10000, settlementMs: 5000, outputBytes: 16777216 });
});
it.each(["credential", "provider", "retry", "budget", "task", "steps", "deadline", "unknown", "path"])("refuses %s frame widening", mode => {
  const frame = structuredClone(hostedSmokeFrame(directory)) as unknown as { configuration: { run: Record<string, unknown> }; credential?: string; extra?: boolean };
  if (mode === "credential") frame.credential = "synthetic-refused-input";
  if (mode === "provider") frame.configuration.run.provider = { kind: "openai-compatible-chat" };
  if (mode === "retry") (frame.configuration.run.settings as Record<string, unknown>).maxAttempts = 2;
  if (mode === "budget") frame.configuration.run.limitMicroDollars = 50_000_001;
  if (mode === "task") frame.configuration.run.tasks = ["T6"];
  if (mode === "steps") (frame.configuration.run.settings as Record<string, unknown>).maxSteps = 9;
  if (mode === "deadline") (frame.configuration.run.settings as Record<string, unknown>).sessionSetupTimeoutMs = 900_001;
  if (mode === "unknown") frame.extra = true;
  if (mode === "path") frame.configuration.run.effortDirectory = "/different/public";
  expect(() => canonicalHostedSmokeFrame(frame, directory)).toThrow();
});
it("scrubs hosted/app/provider variables and uses the actual positive user/home", () => {
  const env = hostedOwnedEnvironment({ uid: 1001, gid: 1001, home: "/home/runner", actualHome: "/home/runner", path: "/public/bin" });
  expect(Object.keys(env).sort()).toEqual(["HOME", "LANG", "NODE_ENV", "PATH", "TZ"]);
  expect(() => assertOperatorHostEnvironment(env)).not.toThrow();
  for (const field of ["uid", "gid"] as const) for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => hostedOwnedEnvironment({ uid: 1001, gid: 1001, home: "/home/runner", actualHome: "/home/runner", path: "/bin", [field]: value })).toThrow();
  expect(() => hostedOwnedEnvironment({ uid: 1001, gid: 1001, home: "/other", actualHome: "/home/runner", path: "/bin" })).toThrow();
  expect(() => assertOperatorHostEnvironment({ ...env, CI: "true" })).toThrow();
  expect(() => assertOwnedLinuxInitialMemory("MemTotal: 5767168 kB\nMemAvailable: 4194303 kB\n")).toThrow();
});
it("accepts only exact nonce readiness before EOF input", () => {
  expect(() => assertHostedSmokeReady(`OWNED_LINUX_READY:${nonce}\n`, nonce)).not.toThrow();
  for (const line of ["", `OWNED_LINUX_READY:${nonce}`, `OWNED_LINUX_READY:${nonce}\nextra`, `OWNED_LINUX_READY:${"0".repeat(36)}\n`])
    expect(() => assertHostedSmokeReady(line, nonce)).toThrow();
});
it("pins both unchanged authority entrypoints to actual committed source bytes", () => {
  for (const [file, hash] of Object.entries(HOSTED_OWNED_CORE_PINS))
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(hash);
});
it("selects all four distinct answered sessions without claiming scientific or paid evidence", () => {
  expect(selectHostedSmokeArtifacts(records(), head)).toEqual(["manifest.json", "responses.jsonl", "assessment.json"]);
  expect(verifyHostedSmokeArtifact(artifact(), head, tree)).toEqual({ source: head, sessions: 4, qualifyingEvidence: false, paidInference: false });
});
it.each(["missing", "duplicate", "foreign", "skipped", "source", "paid", "unfinished", "open-resource", "root"])("refuses %s native artifact", mode => {
  const value = structuredClone(artifact());
  if (mode === "missing") value.records.responses.pop();
  if (mode === "duplicate") value.records.responses[1] = value.records.responses[0];
  if (mode === "foreign") value.records.responses[0].personaId = "foreign-public-persona";
  if (mode === "skipped") value.records.responses[0].status = "skipped";
  if (mode === "source") value.terminal.head = "c".repeat(40);
  if (mode === "paid") value.terminal.paidInference = true;
  if (mode === "unfinished") value.history = value.history.slice(0, value.history.lastIndexOf('{"kind":"finish"'));
  if (mode === "open-resource") value.terminal.groupAbsent = false;
  if (mode === "root") value.terminal.uid = 0;
  expect(() => verifyHostedSmokeArtifact(value, head, tree)).toThrow();
});

it("uses a genuine anonymous FIFO and exact canonical public EOF through the same handoff", async () => {
  const { spawnSync } = await import("node:child_process");
  const childCode = `import os,stat,sys
assert stat.S_ISFIFO(os.fstat(0).st_mode)
assert os.getpgrp()==os.getppid()
sys.stderr.write(${JSON.stringify(`OWNED_LINUX_READY:${nonce}\n`)})
sys.stderr.flush()
raw=sys.stdin.buffer.read()
assert raw.decode()==${JSON.stringify('{"public":true}\n')}
print('public-fifo-eof-pass')`;
  const script = `import importlib.util,os,sys
os.setsid()
spec=importlib.util.spec_from_file_location('public_handoff','scripts/comprehension/hosted-owned-pipe.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sys.exit(module.handoff([sys.executable,'-c',${JSON.stringify(childCode)}],'${nonce}'))`;
  const result = spawnSync("python3", ["-B", "-c", script], { input: '{"public":true}\n', timeout: 15000,
    encoding: "utf8", env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "test" }, maxBuffer: 8192 });
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
  expect(result.stdout).toBe("public-fifo-eof-pass\n");
  expect(result.stderr).toBe(`OWNED_LINUX_READY:${nonce}\n`);
});
it.each(["wrong-ready", "oversize"])("the real FIFO handoff refuses %s before forwarding input", async mode => {
  const { spawnSync } = await import("node:child_process");
  const ready = mode === "wrong-ready" ? "OWNED_LINUX_READY:foreign-public-nonce\n" : `OWNED_LINUX_READY:${nonce}\n`;
  const childCode = `import sys
sys.stderr.write(${JSON.stringify(ready)})
sys.stderr.flush()
sys.stdin.buffer.read()
print('must-not-forward')`;
  const script = `import importlib.util,os,sys
os.setsid()
spec=importlib.util.spec_from_file_location('public_handoff','scripts/comprehension/hosted-owned-pipe.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
try: module.handoff([sys.executable,'-c',${JSON.stringify(childCode)}],'${nonce}')
except ValueError: sys.exit(17)
sys.exit(1)`;
  const result = spawnSync("python3", ["-B", "-c", script], { input: mode === "oversize" ? "x".repeat(65537) + "\n" : '{"public":true}\n',
    timeout: 15000, encoding: "utf8", maxBuffer: 8192, env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "test" } });
  expect(result.error).toBeUndefined(); expect(result.status).toBeNull(); expect(result.signal).toBe("SIGKILL"); expect(result.stdout).toBe("");
});

it.each(["closed", "foreign-run", "foreign-open", "foreign-ended", "clean", "stack-session", "build-id", "request-spend", "foreign-spend", "record-response"])("refuses real-shape %s cross-binding drift", mode => {
  const value = artifact();
  const history = value.history.trimEnd().split("\n").map(line => JSON.parse(line));
  const spend = value.spend.trimEnd().split("\n").map(line => JSON.parse(line));
  if (mode === "closed") history.find(row => row.phase === "ended").value.closed = false;
  if (mode === "foreign-run") history.at(-1).runId = "foreign-public-run";
  if (mode === "foreign-open") history.find(row => row.kind === "session-open").taskId = "T5";
  if (mode === "foreign-ended") history.find(row => row.phase === "ended").sessionId = "foreign-public-session";
  if (mode === "clean") history.at(-1).instrumentClean = true;
  if (mode === "stack-session") spend.find(row => row.id?.startsWith("fresh-stack-")).id = "fresh-stack-foreign-public-session";
  if (mode === "build-id") spend[1].id = "fresh-build";
  if (mode === "request-spend") spend.find(row => row.kind === "settle").actual++;
  if (mode === "foreign-spend") spend.push({ kind: "reserve", id: "foreign-public-cost", maximum: 1 });
  if (mode === "record-response") history.find(row => row.kind === "session").evidence.response.answer = "different-public-answer";
  value.history = history.map(row => JSON.stringify(row)).join("\n") + "\n";
  value.spend = spend.map(row => JSON.stringify(row)).join("\n") + "\n";
  expect(() => verifyHostedSmokeArtifact(value, head, tree)).toThrow();
});
it("retains the foreground timeout in the actual owned group and the original TERM/5s/KILL bounds", () => {
  const pipe = readFileSync("scripts/comprehension/hosted-owned-pipe.py", "utf8");
  expect(pipe).toContain('["timeout", "--foreground", "--signal=TERM", "--kill-after=5s", "2700"');
  expect(pipe).toContain('os.getpgrp() != os.getpid()');
  expect(pipe).toContain('os.killpg(os.getpgrp(), signal.SIGTERM)');
  expect(pipe).toContain('child.wait(timeout=5)');
  expect(pipe).toContain('os.killpg(os.getpgrp(), signal.SIGKILL)');
});
