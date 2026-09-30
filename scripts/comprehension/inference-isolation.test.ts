import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { inferenceResultSchema, participantResultSchema, verdictSchema, type Settings } from "./conductor-contract";
import { loadConductorInputs, taskRubric } from "./conductor-inputs";
import { childEnvironment, isolatedProcesses, probeIsolation } from "./inference-isolation";
import { firstJsonObject, participantReply, renderGrader, renderParticipant } from "./inference-worker";

// Authored instrument inputs only. Nothing here is a participant answer.
const inputs = loadConductorInputs();
const settings: Settings = { temperature: 0, maxSteps: 8, maxAttempts: 1, timeoutMs: 20_000,
  maximumInputTokens: 24_000, maximumOutputTokens: 400,
  price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } };
const view = { path: "/overview", controls: ["c1", "c2"],
  visibleText: "# Your overview\n[c1 link] Settings\n[c2 link] Type 2 diabetes report\nA sentence that is long enough to quote back." };
const participant = { persona: "You are a synthetic participant.", task: inputs.tasks[0].prompt, history: [{ view }] };
const grading = { rubric: taskRubric(inputs.rubric, "T5"), answer: "No. It only reads positions in the file." };
const servers: http.Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });

async function fakeProvider(reply: (body: Record<string, unknown>) => unknown) {
  const seen: { authorization?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", chunk => { text += chunk; });
    request.on("end", () => {
      const body = JSON.parse(text) as Record<string, unknown>;
      seen.push({ authorization: request.headers.authorization, body });
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply(body)));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { seen, provider: { kind: "openai-compatible-chat" as const, endpoint, model: "synthetic-test-label",
    apiKeyVariable: "COMPREHENSION_TEST_KEY" } };
}
const parent = { PATH: process.env.PATH, COMPREHENSION_TEST_KEY: "synthetic-test-credential", UNRELATED_VARIABLE: "not-forwarded" };

async function call(open: ReturnType<typeof isolatedProcesses>, role: "participant" | "grader", payload: unknown) {
  const process_ = await open({ id: "p1", role }, AbortSignal.timeout(30_000));
  try { return await process_.invoke(payload as never, settings, AbortSignal.timeout(30_000)); }
  finally { await process_.close(); }
}

describe("isolated inference processes", () => {
  it("runs the deterministic stub in a child process and returns schema-valid, bounded replies", async () => {
    const open = isolatedProcesses({ kind: "local-deterministic-stub" });
    const action = inferenceResultSchema.parse(await call(open, "participant", participant));
    expect(participantResultSchema.parse(action.value)).toEqual({ kind: "click", target: "c2" });
    expect(action.usage.inputTokens).toBeLessThanOrEqual(settings.maximumInputTokens);
    const verdict = inferenceResultSchema.parse(await call(open, "grader", grading));
    expect(verdictSchema.parse(verdict.value)).toMatchObject({ prohibited: false });
    expect(verdict.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it("gives each child an empty directory outside the checkout and only the allowed environment", async () => {
    const stub = await probeIsolation({ kind: "local-deterministic-stub" }, { ...parent });
    expect(stub).toEqual({ cwdOutsideRepository: true, environmentKeys: ["LANG", "PATH"], allowedKeysOnly: true });
    const { provider } = await fakeProvider(() => ({}));
    const real = await probeIsolation(provider, { ...parent, HTTPS_PROXY: "http://127.0.0.1:9" });
    expect(real.environmentKeys).toEqual(["COMPREHENSION_TEST_KEY", "HTTPS_PROXY", "LANG", "NODE_USE_ENV_PROXY", "PATH"]);
    expect(real.environmentKeys).not.toContain("UNRELATED_VARIABLE");
    expect(real.allowedKeysOnly).toBe(true);
    expect(() => childEnvironment(provider, { PATH: "/bin" })).toThrow("COMPREHENSION_TEST_KEY is not set");
  }, 60_000);

  it("sends a grader only the rubric slice and the verbatim answer, and digests the request without the model", async () => {
    const { seen, provider } = await fakeProvider(() => ({ choices: [{ message: { content: 'Verdict: {"passed":true,"prohibited":false,"noRouteFound":false,"why":"x"}' } }],
      usage: { prompt_tokens: 900, completion_tokens: 20 } }));
    const result = inferenceResultSchema.parse(await call(isolatedProcesses(provider, parent), "grader", grading));
    expect(result.value).toEqual({ passed: true, prohibited: false, noRouteFound: false });
    expect(result.usage).toEqual({ complete: true, inputTokens: 900, outputTokens: 20 });
    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBe("Bearer synthetic-test-credential");
    const { model, ...sampling } = seen[0].body;
    expect(model).toBe("synthetic-test-label");
    expect(result.requestDigest).toBe(createHash("sha256").update(JSON.stringify(sampling)).digest("hex"));
    const user = (sampling.messages as { role: string; content: string }[]).find(message => message.role === "user")!.content;
    expect(user).toBe(renderGrader(grading, settings)[1].content);
    expect(user).toContain(grading.answer);
    expect((user.match(/^## T[0-9]+ —/gm) ?? [])).toEqual(["## T5 —"]);
    expect(JSON.stringify(sampling)).not.toContain(participant.persona);
    expect(JSON.stringify(sampling)).not.toContain("/overview");
  }, 60_000);

  it("keeps the whole reservation when a provider reply omits certain usage", async () => {
    const { provider } = await fakeProvider(() => ({ choices: [{ message: { content: '{"kind":"finish","answer":"x"}' } }] }));
    await expect(call(isolatedProcesses(provider, parent), "participant", participant)).rejects.toThrow("failure");
  }, 60_000);

  it("allows exactly one call per acquired process", async () => {
    const process_ = await isolatedProcesses({ kind: "local-deterministic-stub" })({ id: "once", role: "grader" }, AbortSignal.timeout(5000));
    try {
      await process_.invoke(grading, settings, AbortSignal.timeout(30_000));
      await expect(process_.invoke(grading, settings, AbortSignal.timeout(30_000))).rejects.toThrow("One call");
    } finally { await process_.close(); }
  }, 60_000);
});

describe("prompt rendering inside the worker", () => {
  it("fits a long page into the pinned byte bound and shows past steps as one line each", () => {
    const long = { ...view, visibleText: `${view.visibleText}\n${"words ".repeat(20_000)}` };
    const history = [{ view, action: { kind: "click", target: "c1" } }, { view: long }];
    const messages = renderParticipant({ ...participant, history }, settings);
    const size = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0);
    expect(size).toBeLessThanOrEqual(settings.maximumInputTokens);
    expect(messages[1].content).toContain('1. on /overview you clicked "Settings"');
    expect(messages[1].content).toContain("[page text cut here to fit]");
    expect(renderParticipant({ ...participant, history: Array.from({ length: 8 }, () => ({ view, action: { kind: "click", target: "c1" } })) }, settings)[1].content)
      .toContain("This is your last step");
  });

  it("keeps only the fields the conductor accepts for the chosen kind", () => {
    expect(firstJsonObject('noise {"a":{"b":"}"}} tail')).toEqual({ a: { b: "}" } });
    expect(participantReply('I will click. {"kind":"click","target":"c2","reason":"it says diabetes"}')).toEqual({ kind: "click", target: "c2" });
    expect(participantReply("no json here")).toEqual({ kind: "invalid" });
    expect(participantResultSchema.safeParse(participantReply('{"kind":"delete-everything"}')).success).toBe(false);
  });
});
