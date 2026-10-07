import { afterEach, describe, expect, it } from "vitest";
import { linkSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { admitRestoredCache, aptArchiveNames, cacheKey, normalizeAptDownloads, sha256, validateManifest, verifyAptMetadata, verifyCache, type FontManifest, type FontPackage } from "./ci-browser-font-cache";

const original = readFileSync(new URL("../data/ci/browser-font-packages.json", import.meta.url));
const manifest = JSON.parse(original.toString()) as FontManifest;
const directories: string[] = [];
afterEach(() => { for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-cache-"));
  directories.push(directory);
  const pins = structuredClone(manifest);
  for (const p of pins.packages) {
    const body = Buffer.from(`synthetic font archive ${p.name}`);
    p.bytes = body.length;
    p.sha256 = sha256(body);
    writeFileSync(path.join(directory, path.basename(p.filename)), body);
  }
  return { directory, pins };
}
function metadata(pin: FontPackage) {
  return `Package: ${pin.name}\nVersion: ${pin.version}\nArchitecture: ${pin.architecture}\nFilename: ${pin.filename}\nSize: ${pin.bytes}\nSHA256: ${pin.sha256}\n`;
}
const policy = (p: FontPackage) => `${p.name}:\n  Installed: (none)\n  Candidate: ${p.version}\n`;
const uris = () => manifest.packages.map((p) => `'http://azure.archive.ubuntu.com/ubuntu/${p.filename}' ${p.name}_${p.version.replace(":", "%3a")}_${p.architecture}.deb ${p.bytes} MD5Sum:unused`).join("\n");

describe("font archive cache admission", () => {
  it("admits the complete nine-file byte-verified cache", () => {
    const { directory, pins } = fixture();
    expect(() => verifyCache(directory, pins)).not.toThrow();
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(manifest.packages.reduce((sum, p) => sum + p.bytes, 0)).toBe(21_086_590);
  });
  it("refuses a cache miss without an archive read", () => {
    const { directory, pins } = fixture();
    rmSync(directory, { recursive: true });
    expect(() => verifyCache(directory, pins)).toThrow();
  });
  it("bypasses primary-key prefix matches, misses and corrupt exact hits before APT authentication", () => {
    const { directory, pins } = fixture();
    let authenticated = 0;
    const authenticate = () => { authenticated++; return "verified"; };
    for (const hit of [undefined, "", "false", "TRUE"]) expect(admitRestoredCache(directory, pins, hit, authenticate).ready).toBe(false);
    expect(authenticated).toBe(0);
    expect(admitRestoredCache(directory, pins, "true", authenticate)).toEqual({ ready: true, value: "verified" });
    expect(authenticated).toBe(1);
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), Buffer.alloc(pins.packages[0].bytes));
    expect(admitRestoredCache(directory, pins, "true", authenticate).ready).toBe(false);
    expect(authenticated).toBe(1);
  });
  it("bypasses an authenticated newer candidate before any seeding", () => {
    const { directory, pins } = fixture();
    const pin = pins.packages[0];
    const result = admitRestoredCache(directory, pins, "true", () => verifyAptMetadata(pin, metadata(pin), policy({ ...pin, version: `${pin.version}+security1` })));
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("Unexpected candidate-drift admission");
    expect(result.reason).toContain("candidate version drift");
  });
  it("refuses an incomplete set and unexpected additional archive", () => {
    const { directory, pins } = fixture();
    const file = path.join(directory, path.basename(pins.packages[0].filename));
    rmSync(file);
    expect(() => verifyCache(directory, pins)).toThrow(/complete pinned set/);
    writeFileSync(file, Buffer.from(`synthetic font archive ${pins.packages[0].name}`));
    writeFileSync(path.join(directory, "unexpected.deb"), "extra");
    expect(() => verifyCache(directory, pins)).toThrow(/complete pinned set/);
  });
  it("refuses same-size corrupt archive bytes", () => {
    const { directory, pins } = fixture();
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), Buffer.alloc(pins.packages[0].bytes, 0));
    expect(() => verifyCache(directory, pins)).toThrow(/digest mismatch/);
  });
  it("refuses wrong-size archive bytes", () => {
    const { directory, pins } = fixture();
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), "truncated");
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
  });
  it("refuses symlink and hardlink archives even with matching content", () => {
    const { directory, pins } = fixture();
    const first = path.join(directory, path.basename(pins.packages[0].filename));
    const external = path.join(mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-external-")), "font.deb");
    directories.push(path.dirname(external));
    writeFileSync(external, readFileSync(first));
    rmSync(first); symlinkSync(external, first);
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
    rmSync(first); linkSync(external, first);
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
  });
  it("refuses a cache directory symlink", () => {
    const { directory, pins } = fixture();
    const parent = mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-link-")); directories.push(parent);
    const alias = path.join(parent, "cache"); symlinkSync(directory, alias);
    expect(() => verifyCache(alias, pins)).toThrow(/real canonical directory/);
  });
  it("refuses path traversal, a fourth-party package and invalid digests", () => {
    for (const update of [{ filename: "../font.deb" }, { name: "unreviewed-font" }, { sha256: "invented" }]) {
      const pins = structuredClone(manifest); Object.assign(pins.packages[0], update);
      expect(() => validateManifest(pins)).toThrow();
    }
  });
  it("binds exact manifest, frozen dependency lock and Playwright version in the key", () => {
    const key = cacheKey(original, Buffer.from("lock-one"));
    expect(cacheKey(original, Buffer.from("lock-two"))).not.toBe(key);
    const drift = structuredClone(manifest); drift.playwrightVersion = "1.62.2";
    expect(cacheKey(Buffer.from(JSON.stringify(drift)), Buffer.from("lock-one"))).not.toBe(key);
    drift.packages[0].sha256 = "a".repeat(64);
    expect(cacheKey(Buffer.from(JSON.stringify(drift)), Buffer.from("lock-one"))).not.toBe(key);
    expect(key).toMatch(/^font-debs-v1-Linux-noble-amd64-pw1\.62\.1-/);
  });
  it("requires every refreshed signed metadata field to match the pin", () => {
    for (const pin of manifest.packages) expect(() => verifyAptMetadata(pin, metadata(pin), policy(pin))).not.toThrow();
    const pin = manifest.packages[0];
    for (const update of [{ filename: "pool/other.deb" }, { bytes: pin.bytes + 1 }, { sha256: "a".repeat(64) }, { architecture: "arm64" }]) {
      expect(() => verifyAptMetadata(pin, metadata({ ...pin, ...update }), policy(pin))).toThrow(/metadata differs/);
    }
  });
  it("bypasses newer candidates rather than forcing the reviewed old version", () => {
    const pin = manifest.packages[0];
    expect(() => verifyAptMetadata(pin, metadata(pin), policy({ ...pin, version: `${pin.version}+security1` }))).toThrow(/candidate version drift/);
    expect(() => verifyAptMetadata(pin, metadata(pin), `${pin.name}:\n  Candidate: (none)\n`)).toThrow(/candidate version drift/);
  });
  it("requires consistent metadata when multiple authenticated records exist", () => {
    const pin = manifest.packages[0];
    expect(() => verifyAptMetadata(pin, `${metadata(pin)}\n${metadata(pin)}`, policy(pin))).not.toThrow();
    expect(() => verifyAptMetadata(pin, `${metadata(pin)}\n${metadata({ ...pin, sha256: "a".repeat(64) })}`, policy(pin))).toThrow(/metadata differs/);
  });
  it("uses APT's actual epoch-encoded filenames and leaves dependency rows untouched", () => {
    const names = aptArchiveNames(manifest, `${uris()}\n'http://archive.ubuntu.com/ubuntu/pool/main/u/unrelated/unrelated.deb' unrelated.deb 42 MD5Sum:unused`);
    expect(names.size).toBe(9);
    expect(names.get("fonts-unifont")).toBe("fonts-unifont_1%3a15.1.01-1build1_all.deb");
  });
  it("normalizes authenticated APT download filenames without accepting duplicate or corrupt archives", () => {
    const { directory, pins } = fixture();
    const pin = pins.packages[2];
    const canonical = path.join(directory, path.basename(pin.filename));
    const encoded = path.join(directory, `${pin.name}_${pin.version.replace(":", "%3a")}_${pin.architecture}.deb`);
    renameSync(canonical, encoded);
    expect(() => normalizeAptDownloads(directory, pins)).not.toThrow();
    writeFileSync(encoded, readFileSync(canonical));
    expect(() => normalizeAptDownloads(directory, pins)).toThrow(/ambiguous/);
    rmSync(encoded); writeFileSync(canonical, Buffer.alloc(pin.bytes));
    expect(() => normalizeAptDownloads(directory, pins)).toThrow(/digest mismatch/);
  });
  it("refuses incomplete, duplicate, foreign-host and path-escaping APT routes", () => {
    for (const text of [uris().split("\n").slice(1).join("\n"), `${uris()}\n${uris().split("\n")[0]}`, uris().replace("azure.archive.ubuntu.com", "attacker.invalid"), uris().replace("fonts-freefont-ttf_20211204+svn4273-2_all.deb 5640794", "../font.deb 5640794")]) {
      expect(() => aptArchiveNames(manifest, text)).toThrow();
    }
  });
});
