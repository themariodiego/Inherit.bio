import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { APP_LAUNCHER_DIAGNOSTIC_PREFIX, appLauncherDiagnosticLine, type AppLauncherDiagnostic } from "./app-launcher-diagnostic";
import { forwardProfileDiagnostics, profileDiagnosticFilter } from "./profile-diagnostic-filter";

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
