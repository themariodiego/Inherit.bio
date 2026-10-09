import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reserveOfflineOutput, writeReservedOfflineHistoryFile } from "./ci-browser-duration-history-io";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "inherit-history-reservation-test-"));
  const input = path.join(root, "saved"), parent = path.join(root, "owned-parent"), output = path.join(parent, "proposal");
  mkdirSync(input, { mode: 0o700 }); mkdirSync(parent, { mode: 0o700 });
  writeFileSync(path.join(input, "sentinel.json"), "unchanged", { flag: "wx", mode: 0o600 });
  return { root, input, parent, output, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
describe("owned output reservation survives only its bound identities", () => {
  it("writes both fixed files exclusively under the same retained owned directory", () => {
    const value = fixture();
    try {
      const output = reserveOfflineOutput(value.output, [value.input]);
      writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", "profile");
      writeReservedOfflineHistoryFile(output, "history-source-audit.json", "audit");
      expect(readFileSync(path.join(output, "history-source-audit.json"), "utf8")).toBe("audit");
      expect(() => writeReservedOfflineHistoryFile(output, "history-source-audit.json", "replace")).toThrow();
      expect(readFileSync(path.join(output, "history-source-audit.json"), "utf8")).toBe("audit");
    } finally { value.cleanup(); }
  });
  it("refuses a directory replaced between the first and second write", () => {
    const value = fixture();
    try {
      const output = reserveOfflineOutput(value.output, [value.input]);
      writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", "profile");
      const retained = path.join(value.parent, "retained"); renameSync(output, retained); mkdirSync(output, { mode: 0o700 });
      expect(() => writeReservedOfflineHistoryFile(output, "history-source-audit.json", "audit")).toThrow("identity changed");
      expect(existsSync(path.join(output, "history-source-audit.json"))).toBe(false);
      expect(readFileSync(path.join(retained, "browser-duration-profile-v2.proposal.json"), "utf8")).toBe("profile");
    } finally { value.cleanup(); }
  });
  it("refuses a symlink redirect into protected evidence before the second write", () => {
    const value = fixture();
    try {
      const output = reserveOfflineOutput(value.output, [value.input]);
      writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", "profile");
      renameSync(output, path.join(value.parent, "retained")); symlinkSync(value.input, output);
      expect(() => writeReservedOfflineHistoryFile(output, "history-source-audit.json", "audit")).toThrow();
      expect(existsSync(path.join(value.input, "history-source-audit.json"))).toBe(false);
      expect(readFileSync(path.join(value.input, "sentinel.json"), "utf8")).toBe("unchanged");
    } finally { value.cleanup(); }
  });
  it("refuses a replaced parent even when the original output inode is moved back", () => {
    const value = fixture();
    try {
      const output = reserveOfflineOutput(value.output, [value.input]);
      const retainedParent = path.join(value.root, "retained-parent"); renameSync(value.parent, retainedParent); mkdirSync(value.parent, { mode: 0o700 });
      renameSync(path.join(retainedParent, "proposal"), output);
      expect(() => writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", "profile")).toThrow("identity changed");
      expect(existsSync(path.join(output, "browser-duration-profile-v2.proposal.json"))).toBe(false);
    } finally { value.cleanup(); }
  });
  it("refuses writing an existing directory which this process never reserved", () => {
    const value = fixture();
    try {
      mkdirSync(value.output, { mode: 0o700 });
      expect(() => writeReservedOfflineHistoryFile(value.output, "history-source-audit.json", "audit")).toThrow("reservation is required");
      expect(existsSync(path.join(value.output, "history-source-audit.json"))).toBe(false);
    } finally { value.cleanup(); }
  });
});
