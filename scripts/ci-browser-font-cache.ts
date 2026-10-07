import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync } from "node:fs";
import path from "node:path";

export interface FontPackage {
  name: string;
  version: string;
  architecture: string;
  filename: string;
  bytes: number;
  sha256: string;
}
export interface FontManifest {
  schemaVersion: number;
  distribution: string;
  release: string;
  codename: string;
  architecture: string;
  playwrightVersion: string;
  packages: FontPackage[];
}

const fontNames = ["fonts-freefont-ttf", "fonts-ipafont-gothic", "fonts-tlwg-loma-otf", "fonts-unifont", "fonts-wqy-zenhei", "xfonts-cyrillic", "xfonts-encodings", "xfonts-scalable", "xfonts-utils"];
export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateManifest(manifest: FontManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.distribution !== "ubuntu" || manifest.release !== "24.04" || manifest.codename !== "noble" || manifest.architecture !== "amd64" || !/^\d+\.\d+\.\d+$/.test(manifest.playwrightVersion)) throw new Error("unsupported font cache platform");
  if (JSON.stringify(manifest.packages.map((p) => p.name).sort()) !== JSON.stringify([...fontNames].sort())) throw new Error("font cache must contain exactly the nine Chromium font packages");
  for (const p of manifest.packages) {
    if (!/^[\w.+:~-]+$/.test(p.version) || !["all", "amd64"].includes(p.architecture) || !/^pool\/(main|universe)\/[a-z]\/[a-z0-9-]+\/[a-z0-9+._~-]+\.deb$/.test(p.filename) || !path.basename(p.filename).startsWith(`${p.name}_`) || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > 10_000_000 || !/^[a-f0-9]{64}$/.test(p.sha256)) throw new Error(`invalid font package pin: ${p.name}`);
  }
  if (manifest.packages.reduce((sum, p) => sum + p.bytes, 0) > 25_000_000) throw new Error("font archive cache exceeds its byte bound");
}

export function cacheKey(manifestBytes: Buffer, lockBytes: Buffer): string {
  const manifest = JSON.parse(manifestBytes.toString()) as FontManifest;
  validateManifest(manifest);
  return `font-debs-v1-Linux-${manifest.codename}-${manifest.architecture}-pw${manifest.playwrightVersion}-${sha256(manifestBytes)}-${sha256(lockBytes)}`;
}

export function verifyArchive(file: string, pin: FontPackage): void {
  const before = lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size !== pin.bytes) throw new Error(`invalid archive identity/size: ${pin.name}`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== pin.bytes) throw new Error(`archive changed before read: ${pin.name}`);
    if (sha256(readFileSync(fd)) !== pin.sha256) throw new Error(`archive digest mismatch: ${pin.name}`);
    const after = fstatSync(fd);
    const named = lstatSync(file);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || named.dev !== after.dev || named.ino !== after.ino || named.nlink !== 1) throw new Error(`archive changed during read: ${pin.name}`);
  } finally { closeSync(fd); }
}

export function verifyCache(directory: string, manifest: FontManifest): void {
  validateManifest(manifest);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || realpathSync(directory) !== path.resolve(directory)) throw new Error("font cache directory must be a real canonical directory");
  const expected = manifest.packages.map((p) => path.basename(p.filename)).sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) throw new Error("font cache archive set differs from the complete pinned set");
  for (const p of manifest.packages) verifyArchive(path.join(directory, path.basename(p.filename)), p);
}

export function admitRestoredCache<T>(directory: string, manifest: FontManifest, exactHit: string | undefined, authenticate: () => T): { ready: true; value: T } | { ready: false; reason: string } {
  if (exactHit !== "true") return { ready: false, reason: "no exact-key cache hit" };
  try {
    verifyCache(directory, manifest);
    return { ready: true, value: authenticate() };
  } catch (error) { return { ready: false, reason: String(error) }; }
}

export function normalizeAptDownloads(directory: string, manifest: FontManifest): void {
  for (const p of manifest.packages) {
    const canonical = path.basename(p.filename);
    const aliases = new Set([canonical, `${p.name}_${p.version.replace(":", "%3a")}_${p.architecture}.deb`, `${p.name}_${p.version}_${p.architecture}.deb`]);
    const matches = readdirSync(directory).filter((name) => aliases.has(name));
    if (matches.length !== 1) throw new Error(`ambiguous downloaded archive: ${p.name}`);
    verifyArchive(path.join(directory, matches[0]), p);
    if (matches[0] !== canonical) renameSync(path.join(directory, matches[0]), path.join(directory, canonical));
  }
  verifyCache(directory, manifest);
}

function paragraphs(text: string): Record<string, string>[] {
  return text.trim().split(/\n\s*\n/).map((block) => Object.fromEntries(block.split("\n").filter((line) => /^[A-Za-z][A-Za-z0-9-]*: /.test(line)).map((line) => { const at = line.indexOf(": "); return [line.slice(0, at), line.slice(at + 2)]; })));
}

// apt-cache reads the lists authenticated by the preceding successful stock
// apt-get update --error-on=any. Newer candidates deliberately bypass the cache.
export function verifyAptMetadata(pin: FontPackage, show: string, policy: string): void {
  if (policy.match(/^\s*Candidate:\s*(\S+)\s*$/m)?.[1] !== pin.version) throw new Error(`Ubuntu candidate version drift: ${pin.name}`);
  const records = paragraphs(show).filter((p) => p.Package === pin.name && p.Version === pin.version && p.Architecture === pin.architecture);
  if (!records.length || records.some((p) => p.Filename !== pin.filename || p.Size !== String(pin.bytes) || p.SHA256 !== pin.sha256)) throw new Error(`authenticated Ubuntu metadata differs: ${pin.name}`);
}

// Ask APT for its actual archive name (including percent-encoded epochs).
// Dependency rows are left to the unchanged complete Playwright installer.
export function aptArchiveNames(manifest: FontManifest, printUris: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of printUris.split("\n")) {
    const row = line.match(/^'([^']+)' (\S+) (\d+) \S+$/);
    if (!row) continue;
    const url = new URL(row[1]);
    const pin = manifest.packages.find((p) => url.pathname === `/ubuntu/${p.filename}`);
    if (!pin) continue;
    if (!["http:", "https:"].includes(url.protocol) || !["archive.ubuntu.com", "azure.archive.ubuntu.com", "security.ubuntu.com"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || Number(row[3]) !== pin.bytes || !/^[a-z0-9+._%~-]+\.deb$/.test(row[2]) || decodeURIComponent(row[2]) !== `${pin.name}_${pin.version}_${pin.architecture}.deb` || result.has(pin.name)) throw new Error(`unexpected APT archive route: ${pin.name}`);
    result.set(pin.name, row[2]);
  }
  if (result.size !== manifest.packages.length) throw new Error("APT did not resolve all nine pinned font archives");
  return result;
}
