import * as fs from "node:fs/promises";
import { chmod, link, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReceiptWriter, readCredentials } from "./io";
import { credentials, NOW } from "./fixtures";
import { PREVIEW_PROJECT } from "./contract";
import { type ProbeReceipt } from "./receipt";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function privateFile() {
  const dir = await mkdtemp(path.join(tmpdir(), "inherit-empty-probe-test-")); directories.push(dir);
  await chmod(dir, 0o700);
  const filename = path.join(dir, "synthetic.json");
  await writeFile(filename, JSON.stringify(credentials()), { mode: 0o600 });
  return { dir, filename };
}
function receipt(): ProbeReceipt { return { schemaVersion: 1, previewProject: PREVIEW_PROJECT,
  startedAt: new Date(NOW).toISOString(), finishedAt: null, declaredBytes: 512, sourceBytesSent: 0, patchRequests: 0,
  appIssuanceRequests: 0, providerRequests: 0, events: [], conclusion: "running", cleanup: "not-created", failurePhase: null,
  issuedUploadId: null,
  physicalFragmentCleanupProven: false, appIntegrationProven: false, capacityProven: false }; }

describe("protected diagnostic files", () => {
  it("reads owned private input without exposing credentials through errors", async () => {
    const { filename } = await privateFile();
    expect(await readCredentials(filename, NOW)).toEqual(credentials());
    await writeFile(filename, "private malformed credential");
    await expect(readCredentials(filename, NOW)).rejects.toThrow(/^probe_contract_refused$/);
  });

  it("rejects broad file or directory permissions", async () => {
    const { filename, dir } = await privateFile();
    await chmod(filename, 0o640);
    await expect(readCredentials(filename, NOW)).rejects.toThrow("probe_contract_refused");
    await chmod(filename, 0o600); await chmod(dir, 0o750);
    await expect(readCredentials(filename, NOW)).rejects.toThrow("probe_contract_refused");
    await expect(createReceiptWriter(path.join(dir, "receipt.json"))).rejects.toThrow("probe_contract_refused");
  });

  it("rejects symlinks, hard links, relative paths and oversized files", async () => {
    const { filename, dir } = await privateFile();
    const other = path.join(dir, "other.json");
    await symlink(filename, other);
    await expect(readCredentials(other, NOW)).rejects.toThrow("probe_contract_refused");
    await rm(other); await link(filename, other);
    await expect(readCredentials(other, NOW)).rejects.toThrow("probe_contract_refused");
    await rm(other); await writeFile(filename, Buffer.alloc(32_769));
    await expect(readCredentials(filename, NOW)).rejects.toThrow("probe_contract_refused");
    await expect(readCredentials("relative.json", NOW)).rejects.toThrow("probe_contract_refused");
  });

  it("refuses protected files inside a Git checkout or linked worktree", async () => {
    const { filename, dir } = await privateFile();
    await writeFile(path.join(dir, ".git"), "gitdir: synthetic-only");
    await expect(readCredentials(filename, NOW)).rejects.toThrow("probe_contract_refused");
    await expect(createReceiptWriter(path.join(dir, "receipt.json"))).rejects.toThrow("probe_contract_refused");
  });

  it("creates one protected receipt, rejects overwrite, and replaces snapshots without stale bytes", async () => {
    const { filename, dir } = await privateFile();
    await expect(createReceiptWriter(filename)).rejects.toThrow("probe_contract_refused");
    const output = path.join(dir, "receipt.json"), writer = await createReceiptWriter(output);
    try {
      const value = receipt();
      await writer.save({ ...value, finishedAt: new Date(NOW + 1000).toISOString(), conclusion: "probe-stopped" });
      await writer.save(value);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(value);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      await expect(writer.save({ ...value, credential: "secret" } as ProbeReceipt)).rejects.toThrow();
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(value);
    } finally { await writer.close(); }
    expect(await readCredentials(filename, NOW)).toEqual(credentials());
  });

  it("retains the previous complete receipt when atomic replacement fails", async () => {
    const { dir } = await privateFile(), output = path.join(dir, "receipt.json");
    const writer = await createReceiptWriter(output), value = receipt();
    try {
      await writer.save(value);
      vi.mocked(fs.rename).mockRejectedValueOnce(new Error("private disk detail"));
      await expect(writer.save({ ...value, cleanup: "creation-outcome-uncertain" })).rejects.toThrow(/^probe_contract_refused$/);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(value);
      expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    } finally { await writer.close(); }
  });
});
