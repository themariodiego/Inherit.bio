import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import path from "node:path";
import { runConfigSchema, type RunConfig } from "./run-config";

export const PRIVATE_CONFIG_MAX_BYTES = 64 * 1024;
export const PRIVATE_CONFIG_REFUSAL = "Private run configuration refused. Use an owned 0600 file outside Git.";

function ownedFile(value: BigIntStats): void {
  const owner = process.getuid?.();
  if (owner === undefined || !Number.isSafeInteger(owner) || !value.isFile()
    || value.nlink !== BigInt(1) || value.uid !== BigInt(owner) || (value.mode & BigInt(0o7777)) !== BigInt(0o600)
    || value.size < BigInt(1) || value.size > BigInt(PRIVATE_CONFIG_MAX_BYTES)) throw new Error(PRIVATE_CONFIG_REFUSAL);
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid
    && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function parentsOutsideGit(file: string): string[] {
  const identities: string[] = [];
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const value = lstatSync(directory, { bigint: true });
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(PRIVATE_CONFIG_REFUSAL);
    identities.push(JSON.stringify([directory, ...[value.dev, value.ino, value.uid, value.gid, value.mode]
      .map(identity => identity.toString())]));
    try {
      lstatSync(path.join(directory, ".git"), { bigint: true });
      throw new Error(PRIVATE_CONFIG_REFUSAL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (path.dirname(directory) === directory) return identities;
  }
}

/** Read only this private file. No journal, credential, browser or provider is opened.
 * Mutable input bytes are cleared; returned strings are not an erasure proof. */
export function loadPrivateConfiguration<T>(file: string, parse: (value: unknown) => T): T {
  let fd: number | undefined;
  let bytes: Buffer | undefined;
  let config: T | undefined;
  let refused = false;
  try {
    if (!path.isAbsolute(file) || path.resolve(file) !== file || realpathSync(file) !== file)
      throw new Error(PRIVATE_CONFIG_REFUSAL);
    const parentIdentities = parentsOutsideGit(file);
    const named = lstatSync(file, { bigint: true }); ownedFile(named);
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const openedFd = fd;
    const original = fstatSync(openedFd, { bigint: true }); ownedFile(original);
    if (!sameFile(named, original)) throw new Error(PRIVATE_CONFIG_REFUSAL);
    // The owned-file check proves this is an exact integer between 1 and 65536.
    const size = Number(original.size);
    bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(openedFd, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    const current = () => {
      const opened = fstatSync(openedFd, { bigint: true }); ownedFile(opened);
      const visible = lstatSync(file, { bigint: true }); ownedFile(visible);
      if (count !== size || !sameFile(original, opened) || !sameFile(original, visible)
        || realpathSync(file) !== file
        || JSON.stringify(parentsOutsideGit(file)) !== JSON.stringify(parentIdentities))
        throw new Error(PRIVATE_CONFIG_REFUSAL);
    };
    current();
    // Keep BOM rejection from the original JSON.parse(readFileSync(..., "utf8")).
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count));
    config = parse(JSON.parse(text));
    current();
  } catch {
    // Parser, schema and filesystem diagnostics must not print private values.
    refused = true;
  } finally {
    try { bytes?.fill(0); }
    catch { refused = true; }
    if (fd !== undefined) {
      try { closeSync(fd); }
      catch { refused = true; }
    }
  }
  if (refused || config === undefined) throw new Error(PRIVATE_CONFIG_REFUSAL);
  return config;
}

export function loadPrivateRunConfig(file: string): RunConfig {
  return loadPrivateConfiguration(file, value => runConfigSchema.parse(value));
}
