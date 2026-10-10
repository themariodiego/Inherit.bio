import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { APP_LAUNCHER_DIAGNOSTIC_PREFIX, appLauncherDiagnosticLine, type AppLauncherDiagnostic } from "./app-launcher-diagnostic";
import { forwardMailRelayDiagnostics, forwardProfileDiagnostics, profileDiagnosticFilter } from "./profile-diagnostic-filter";

const record: AppLauncherDiagnostic = { mode: "inside", port: 3100, stage: "next-app",
  outcome: "child-exit", exitCode: 1, signal: null };
const line = appLauncherDiagnosticLine(record)!;
it("retains exactly the fixed native startup facts across every stream chunk split", () => {
  for (let split = 0; split <= line.length + 1; split++) {
    const emit = vi.fn(), filter = profileDiagnosticFilter(emit), bytes = Buffer.from(line + "\n");
    filter.write(bytes.subarray(0, split)); filter.write(bytes.subarray(split)); filter.end();
    expect(emit.mock.calls).toEqual([[line]]);
  }
});
it.each([
  { ...record, message: "private-token" }, { ...record, mode: "private-token" },
  { ...record, port: 443 }, { ...record, stage: "private-token" }, { ...record, outcome: "private-token" },
  { ...record, exitCode: -1 }, { ...record, exitCode: 256 }, { ...record, signal: "private-token" },
  { ...record, mode: "mail", port: 3100 }, null, [],
])("rejects private strings, additional fields and invalid native facts %#", value => {
  expect(appLauncherDiagnosticLine(value)).toBeNull();
  const emit = vi.fn(), filter = profileDiagnosticFilter(emit);
  filter.write(APP_LAUNCHER_DIAGNOSTIC_PREFIX + JSON.stringify(value) + "\n"); filter.end();
  expect(emit).not.toHaveBeenCalled();
});
it("does not inspect serialization hooks or accessors", () => {
  const get = vi.fn(() => "private-token"), serialize = vi.fn(() => "private-token");
  expect(appLauncherDiagnosticLine({ ...record, toJSON: serialize })).toBeNull();
  const value = { ...record }; Object.defineProperty(value, "stage", { get });
  expect(appLauncherDiagnosticLine(value)).toBeNull();
  expect(get).not.toHaveBeenCalled(); expect(serialize).not.toHaveBeenCalled();
});
it("drops raw output, duplicate keys, noncanonical frames and oversize suffixes at both pipe boundaries", () => {
  const inside = new PassThrough(), host = new PassThrough(), output: string[] = [];
  const closeInside = forwardProfileDiagnostics([inside], value => host.write(value + "\n"));
  const closeHost = forwardProfileDiagnostics([host], value => output.push(value));
  const duplicate = APP_LAUNCHER_DIAGNOSTIC_PREFIX + '{"mode":"private-token",' + JSON.stringify(record).slice(1);
  try {
    inside.write("Authorization: private-token\n" + duplicate + "\n");
    inside.write("x".repeat(2048) + line + "\n");
    inside.write(APP_LAUNCHER_DIAGNOSTIC_PREFIX + JSON.stringify(record, null, 1) + "\n");
    inside.write(line + "\n"); expect(output).toEqual([line]);
    closeInside(); closeHost(); inside.write(line + "\n"); expect(output).toEqual([line]);
  } finally { closeInside(); closeHost(); inside.destroy(); host.destroy(); }
});
it("forwards only canonical mail startup facts from stderr through both launcher hops", () => {
  const stderr = new PassThrough(), host = new PassThrough(), output: string[] = [];
  const closeMail = forwardMailRelayDiagnostics(stderr, value => host.write(value + "\n"));
  const closeHost = forwardProfileDiagnostics([host], value => output.push(value));
  const ready = appLauncherDiagnosticLine({ ...record, mode: "mail", port: null,
    stage: "runtime-proof", outcome: "ready", exitCode: null })!;
  const refused = appLauncherDiagnosticLine({ ...record, mode: "mail", port: null,
    stage: "mail-relay", outcome: "refused", exitCode: null })!;
  try {
    stderr.write(ready.slice(0, 17)); stderr.write(ready.slice(17) + "\n");
    stderr.write(refused + "\n");
    expect(output).toEqual([ready, refused]);
    closeMail(); stderr.write(ready + "\n"); expect(output).toEqual([ready, refused]);
  } finally { closeMail(); closeHost(); stderr.destroy(); host.destroy(); }
});
it("never retains relay bodies, private logs, other modes or unrelated diagnostic stages", () => {
  const stderr = new PassThrough(), emit = vi.fn(), close = forwardMailRelayDiagnostics(stderr, emit);
  const mail = { ...record, mode: "mail" as const, port: null, stage: "mail-relay" as const };
  try {
    stderr.write('Authorization: private-token\n{"id":1,"headers":{"authorization":"private-token"},"body":"private-body"}\n');
    stderr.write(line + "\n");
    stderr.write(appLauncherDiagnosticLine({ ...mail, stage: "next-app" }) + "\n");
    stderr.write(APP_LAUNCHER_DIAGNOSTIC_PREFIX + JSON.stringify({ ...mail, message: "private-token" }) + "\n");
    stderr.write(APP_LAUNCHER_DIAGNOSTIC_PREFIX + JSON.stringify(mail, null, 1) + "\n");
    const valid = appLauncherDiagnosticLine(mail)!;
    stderr.write("x".repeat(2048) + valid + "\n");
    stderr.write(valid); stderr.emit("close"); stderr.write("\n");
    expect(emit).not.toHaveBeenCalled();
  } finally { close(); stderr.destroy(); }
});
it("keeps relay diagnostics on stderr and preserves the original readiness and privilege guards", () => {
  const source = readFileSync(new URL("./server.mts", import.meta.url), "utf8");
  expect(source).toContain('forwardMailRelayDiagnostics(relay.stderr, line => process.stderr.write(line + "\\n"))');
  expect(source).not.toContain("forwardMailRelayDiagnostics(relay.stdout");
  expect(source).toContain('assert(process.getuid!() > 0);\n    assert.match(readFileSync("/proc/self/status", "utf8"), /^CapEff:\\s+0+$/m);\n    if (mode === "mail") diagnostic("ready");');
  expect(source).toContain('const timer = setTimeout(() => reject(new Error("Mail relay readiness failed")), 10_000);');
  expect(source).toContain('server.listen(8124, "127.0.0.1", () => { diagnostic("ready"); process.stdout.write("MAIL_RELAY_READY\\n"); });');
  expect(source).toContain('server.on("error", () => { diagnostic("refused"); stop(true); });');
});
