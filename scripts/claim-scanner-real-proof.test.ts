import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertOwnedContainer, assertRealVerdict, boundedCommand, eicarBytes, netBytes,
  PROOF_LABEL, sha256, syntheticPdf } from "./claim-scanner-real-proof";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const id = "a".repeat(64), nonce = "proof-nonce";
const owned = () => ({ Id: id, Config: { Labels: { [PROOF_LABEL]: nonce } }, HostConfig: {
  Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, ReadonlyRootfs: true,
  PortBindings: { "3310/tcp": [{ HostIp: "127.0.0.1", HostPort: "45310" }] },
} });
const bytes = syntheticPdf(), now = Date.UTC(2026, 9, 5, 12);
const valid = () => ({ verdict: "OK" as const, sha256: sha256(bytes),
  signatures: { engine: "ClamAV 1.5.4", version: 1, publishedAt: new Date(now) } });

describe("real scanner proof boundary controls (not a real scanner verdict)", () => {
  it("builds a valid cross-reference table for an empty synthetic one-page PDF", () => {
    const source = bytes.toString("ascii"), start = /startxref\n(\d+)\n%%EOF/u.exec(source);
    expect(source).toContain("/Type /Page /Parent 2 0 R /MediaBox [0 0 72 72]");
    expect(source.slice(Number(start?.[1]))).toMatch(/^xref\n0 5\n/u);
    const entries = [...source.matchAll(/(\d{10}) 00000 n /gu)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(4);
    entries.forEach((offset, index) => expect(source.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`)));
  });
  it("uses the complete standard EICAR file without a private file", () => {
    expect(eicarBytes()).toHaveLength(68);
    expect(sha256(eicarBytes())).toBe("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f");
  });
  it("admits the exact owned private container boundary", () => expect(() => assertOwnedContainer(owned(), id, nonce)).not.toThrow());
  it.each(["identity", "label", "memory", "swap", "readonly", "public", "extra-port"])("refuses planted %s drift before a container mutation", (kind) => {
    const value = owned();
    if (kind === "identity") value.Id = "b".repeat(64);
    if (kind === "label") value.Config.Labels[PROOF_LABEL] = "another-proof";
    if (kind === "memory") value.HostConfig.Memory = 512 * 1024 ** 2;
    if (kind === "swap") value.HostConfig.MemorySwap = -1;
    if (kind === "readonly") value.HostConfig.ReadonlyRootfs = false;
    if (kind === "public") value.HostConfig.PortBindings["3310/tcp"][0].HostIp = "0.0.0.0";
    if (kind === "extra-port") Object.assign(value.HostConfig.PortBindings, { "7357/tcp": [] });
    expect(() => assertOwnedContainer(value, id, nonce)).toThrow();
  });
  it("admits only a byte-bound current real-engine verdict", () => expect(() => assertRealVerdict(valid(), "OK", bytes, now)).not.toThrow());
  it.each(["hash", "engine", "stale", "future", "extra-key"])("refuses planted %s verdict evidence", (kind) => {
    const value = valid();
    if (kind === "hash") value.sha256 = "0".repeat(64);
    if (kind === "engine") value.signatures.engine = "test-double";
    if (kind === "stale") value.signatures.publishedAt = new Date(now - 86_400_001);
    if (kind === "future") value.signatures.publishedAt = new Date(now + 300_001);
    if (kind === "extra-key") Object.assign(value, { signatureName: "should-not-be-kept" });
    expect(() => assertRealVerdict(value, "OK", bytes, now)).toThrow();
  });
  it("refuses an OK result for a requested infection outcome", () => expect(() => assertRealVerdict(valid(), "FOUND", bytes, now)).toThrow());
  it("reads decimal Docker network counters and refuses unknown units", () => {
    expect(netBytes("1.5 MB")).toBe(1_500_000);
    expect(netBytes("1 MiB")).toBe(1_048_576);
    expect(() => netBytes("unknown")).toThrow();
    expect(() => netBytes("-1 B")).toThrow();
  });
  it("retains the first failed command and complete raw streams before refusing it", async () => {
    const output = await mkdtemp(path.join(tmpdir(), "scanner-proof-command-")); temporary.push(output);
    await expect(boundedCommand(output, 1, [process.execPath, "-e", "process.stdout.write('original');process.stderr.write('failure');process.exitCode=7"], 2)).rejects.toThrow("command_1_failed");
    const original = JSON.parse(await readFile(`${output}/command-1.original-result.json`, "utf8"));
    expect(original).toMatchObject({ exit: 7, timedOut: false, groupAbsent: true, readbackPending: true });
    expect(await readFile(original.stdout, "utf8")).toBe("original");
    expect(await readFile(original.stderr, "utf8")).toBe("failure");
    const readback = JSON.parse(await readFile(`${output}/command-1.raw-readback.json`, "utf8"));
    expect(readback[original.stdout]).toMatchObject({ bytes: 8 });
  });
});
