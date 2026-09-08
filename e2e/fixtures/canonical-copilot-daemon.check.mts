import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import https from "node:https";
import { startCanonicalCopilotDaemon } from "./canonical-copilot-daemon";
import { startCopilotFixture } from "./canonical-copilot-browser";

// Standalone synthetic fixture check only: no application, DB, browser or cloud.
const scratch = path.join(process.cwd(), "work"); mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(path.join(scratch, "copilot-fixture-check-"));
const previousControl = process.env.CANONICAL_COPILOT_CONTROL_URL;
let daemon: Awaited<ReturnType<typeof startCanonicalCopilotDaemon>> | undefined;
let fixture: Awaited<ReturnType<typeof startCopilotFixture>> | undefined;
try {
  const keyPath = path.join(directory, "key.pem"), certificatePath = path.join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath,
    "-out", certificatePath, "-subj", "/CN=synthetic-copilot", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  daemon = await startCanonicalCopilotDaemon({ controlPort: 0, controlHost: "127.0.0.1", modelAddress: "127.0.0.1", keyPath, certificatePath });
  process.env.CANONICAL_COPILOT_CONTROL_URL = `http://127.0.0.1:${daemon.controlPort}`;
  fixture = await startCopilotFixture(8126);
  const post = (messages: unknown[], route = "/v1/chat/completions") => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = https.request({ host: "127.0.0.1", port: 8126, path: route, method: "POST", ca: readFileSync(certificatePath),
      headers: { "content-type": "application/json" } }, response => {
      const parts: Buffer[] = []; response.on("data", chunk => parts.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(parts).toString("utf8") }));
    });
    request.on("error", reject); request.end(JSON.stringify({ stream: true, messages }));
  });
  for (const pauseBefore of ["tool", "answer"] as const) {
    const prompt = `Synthetic boundary ${pauseBefore}`;
    const answer = "One complete answer — including Unicode’s apostrophe.";
    await fixture.configure({ prompt, tool: { name: "get_report", arguments: { slug: "synthetic-report" } }, answer, pauseBefore });
    let firstSettled = false;
    const first = post([{ role: "user", content: prompt }]).then(value => { firstSettled = true; return value; });
    if (pauseBefore === "tool") { await fixture.waitUntilPaused(); assert.equal(firstSettled, false); await fixture.release(); }
    const tool = await first; assert.equal(tool.status, 200);
    const chunks = tool.body.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const call = chunks.flatMap(chunk => chunk.choices[0].delta.tool_calls ?? [])[0];
    assert.equal(call.function.name, "get_report");
    assert.deepEqual(JSON.parse(call.function.arguments), { slug: "synthetic-report" });
    let answerSettled = false;
    const last = post([{ role: "user", content: prompt }, { role: "tool", tool_call_id: call.id,
      content: JSON.stringify({ sources: [{ file_id: "synthetic-only", covered: true }] }) }]).then(value => { answerSettled = true; return value; });
    if (pauseBefore === "answer") { await fixture.waitUntilPaused(); assert.equal(answerSettled, false); await fixture.release(); }
    const completed = await last; assert.equal(completed.status, 200);
    const text = completed.body.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)).choices[0].delta.content ?? "").join("");
    assert.equal(text, answer);
  }
  const snapshot = await fixture.snapshot(); assert.equal(snapshot.calls, 4); assert.equal(snapshot.denied, 0);
  assert.deepEqual(snapshot.requests.map(row => row.stage), ["tool", "answer", "tool", "answer"]);
  assert.equal((await post([{ role: "user", content: "not configured" }])).status, 409);
  assert.equal((await post([], "/unexpected")).status, 404);
  const after = await fixture.snapshot(); assert.equal(after.calls, 6); assert.equal(after.denied, 1);
  console.log(JSON.stringify({ exactTool: "PASS", pauseBeforeTool: "PASS", pauseBeforeAnswer: "PASS", completeUnicode: "PASS", unexpectedRequestsRejectedAndCounted: "PASS", fixtureRequests: 6, appOrDatabaseRequests: 0 }));
} finally {
  await fixture?.stop(); await daemon?.stop();
  if (previousControl === undefined) delete process.env.CANONICAL_COPILOT_CONTROL_URL;
  else process.env.CANONICAL_COPILOT_CONTROL_URL = previousControl;
  rmSync(directory, { recursive: true, force: true });
}
