import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { ScanVerdict } from "../src/lib/scan/malware-scanner";
import { signaturesFresh } from "../src/lib/scan/malware-scanner";

export const CLAMAV_IMAGE = "clamav/clamav@sha256:b14ffd7b2e520c2ff52c33a1a305aa4acb1864f06b24cb408e81bf54e89f8ac6";
export const PROOF_LABEL = "bio.inherit.scanner-proof";
export const sha256 = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

export function syntheticPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(body);
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

export function eicarBytes(): Buffer {
  return Buffer.from(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""), "ascii");
}

export function assertRealVerdict(verdict: ScanVerdict, expected: "OK" | "FOUND", bytes: Uint8Array, now: number): void {
  if ((verdict.verdict !== "OK" && verdict.verdict !== "FOUND") || verdict.verdict !== expected || verdict.sha256 !== sha256(bytes)
    || !/^ClamAV 1\.5\.4$/u.test(verdict.signatures.engine)
    || !Number.isSafeInteger(verdict.signatures.version) || verdict.signatures.version < 1
    || !signaturesFresh(verdict.signatures.publishedAt, now)
    || Object.keys(verdict).sort().join(",") !== "sha256,signatures,verdict"
    || Object.keys(verdict.signatures).sort().join(",") !== "engine,publishedAt,version") {
    throw new Error("real_scanner_verdict_refused");
  }
}

export function assertOwnedContainer(info: unknown, id: string, nonce: string): asserts info is Record<string, unknown> {
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("container_shape_refused");
  const value = info as { Id?: string; Config?: { Labels?: Record<string, string> }; HostConfig?: { Memory?: number; MemorySwap?: number; ReadonlyRootfs?: boolean; PortBindings?: Record<string, Array<{ HostIp: string; HostPort: string }>> } };
  const port = value.HostConfig?.PortBindings;
  if (!/^[a-f0-9]{64}$/u.test(id) || value.Id !== id || value.Config?.Labels?.[PROOF_LABEL] !== nonce
    || value.HostConfig?.Memory !== 4 * 1024 ** 3 || value.HostConfig.MemorySwap !== 4 * 1024 ** 3
    || value.HostConfig.ReadonlyRootfs !== true || !port || Object.keys(port).join(",") !== "3310/tcp"
    || !Array.isArray(port["3310/tcp"]) || port["3310/tcp"].length !== 1 || port["3310/tcp"][0].HostIp !== "127.0.0.1"
    || port["3310/tcp"][0].HostPort !== "45310") throw new Error("container_ownership_or_boundary_refused");
}

export function netBytes(value: string): number {
  const units: Record<string, number> = { B: 1, kB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(B|kB|MB|GB|KiB|MiB|GiB)$/u.exec(value.trim());
  if (!match) throw new Error("network_counter_refused");
  const result = Number(match[1]) * units[match[2]];
  if (!Number.isFinite(result) || result < 0) throw new Error("network_counter_refused");
  return result;
}

/** Read-only metadata observation as the configured user of the exact owned scanner. */
export function signatureAllocationCommand(id: string): string[] {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("owned_id_refused");
  return ["exec", "--user", "clamav:clamav", id, "/usr/bin/find", "-P", "/signatures",
    "-printf", "%y\t%n\t%b\t%s\t%P\\0"];
}

/** GNU find reports allocated 512-byte blocks without reading signature contents. */
export function signatureAllocatedBytes(text: string): number {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024 || !text.endsWith("\0")) throw new Error("signature_metadata_refused");
  const records = text.slice(0, -1).split("\0"), paths = new Set<string>();
  if (!records.length || records.length > 8192) throw new Error("signature_metadata_refused");
  let total = 0;
  for (const record of records) {
    const fields = record.split("\t");
    if (fields.length !== 5) throw new Error("signature_metadata_refused");
    const [type, links, blocks, size, relative] = fields;
    if ((type !== "d" && type !== "f") || ![links, blocks, size].every(value => /^(?:0|[1-9][0-9]{0,15})$/u.test(value!))
      || relative!.length > 1024 || /[\u0000-\u001f\u007f]/u.test(relative!)
      || relative!.startsWith("/") || relative!.split("/").some(part => part === "." || part === "..")
      || relative!.includes("//") || relative!.endsWith("/") || paths.has(relative!)
      || !paths.size && (relative !== "" || type !== "d") || paths.size && relative === "") throw new Error("signature_metadata_refused");
    const count = Number(links), allocated = Number(blocks) * 512, bytes = Number(size);
    if (!Number.isSafeInteger(count) || count < 1 || type === "f" && count !== 1
      || !Number.isSafeInteger(allocated) || !Number.isSafeInteger(bytes)) throw new Error("signature_file_shape_refused");
    paths.add(relative!); total += allocated;
    if (!Number.isSafeInteger(total) || total > 1024 ** 3) throw new Error("signature_budget_exceeded");
  }
  return total;
}


/** Fixed output paths in the existing owned tmpfs; no new mounts or daemon settings. */
export function clamdDiagnosticCommands(id: string): { prepare: string[]; start: string[]; snapshot: string[] } {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("owned_id_refused");
  const directory = "/tmp/inherit-clamd-original";
  const prepare = `umask 077; set -C; mkdir -m 700 ${directory} && : >${directory}/stdout && : >${directory}/stderr`;
  const start = `umask 077; exec 3>>${directory}/stdout 4>>${directory}/stderr; `
    + `/usr/sbin/clamd --config-file=/proof/clamd.conf --foreground >&3 2>&4; code=$?; `
    + `exec 3>&- 4>&-; set -C; printf '%s\\n' "$code" >${directory}/exit; exit "$code"`;
  const snapshot = `set -e; directory=${directory}; `
    + `test "$(/usr/bin/find -P "$directory" -maxdepth 0 -printf '%y %U %m %n')" = 'd 1000 700 2'; `
    + `for file in stdout stderr; do `
    + `test "$(/usr/bin/find -P "$directory/$file" -maxdepth 0 -printf '%y %U %m %n')" = 'f 1000 600 1'; `
    + `test "$(/usr/bin/find -P "$directory/$file" -maxdepth 0 -printf '%s')" -le 4194304; done; `
    + `code=unobserved; if test -e "$directory/exit"; then `
    + `test "$(/usr/bin/find -P "$directory/exit" -maxdepth 0 -printf '%y %U %m %n')" = 'f 1000 600 1'; `
    + `test "$(/usr/bin/find -P "$directory/exit" -maxdepth 0 -printf '%s')" -le 4; `
    + `if IFS= read -r value <"$directory/exit"; then code=$value; fi; fi; `
    + `printf 'daemon-wait-status:%s\\n' "$code"; /bin/cat "$directory/stdout"; /bin/cat "$directory/stderr" >&2`;
  const exec = ["exec", "--user", "clamav:clamav", id, "/bin/sh", "-c"];
  return { prepare: [...exec, prepare], start: ["exec", "-d", ...exec.slice(1), start], snapshot: [...exec, snapshot] };
}

/** A shell wait result written after daemon descriptors close, observed before any owned stop. */
export function parseClamdWaitStatus(stdout: string): number | null {
  const header = stdout.slice(0, stdout.indexOf("\n") + 1);
  if (header === "daemon-wait-status:unobserved\n") return null;
  const value = /^daemon-wait-status:((?:0|[1-9][0-9]{0,2}))\n$/u.exec(header);
  if (!value || Number(value[1]) > 255) throw new Error("daemon_status_observation_refused");
  return Number(value[1]);
}

export interface CommandRecord {
  argv: string[]; startedAt: string; endedAt: string; elapsedMs: number;
  exit: number | null; signal: string | null; timedOut: boolean; commandError: string | null;
  cleanupError: string | null; groupAbsent: boolean | null; rawCloseErrors: string[];
  stdout: string; stderr: string; readbackPending: boolean;
  rawOriginalIdentities: Array<{ dev: number; ino: number; size: number; nlink: number; uid: number; mode: number }>;
}

/** Save the original command outcome before raw readback and any caller postcheck. */
export async function boundedCommand(directory: string, ordinal: number, argv: string[], seconds: number,
  tick?: () => Promise<void>): Promise<{ stdout: string; record: CommandRecord }> {
  const prefix = `${directory}/command-${ordinal}`;
  const stdoutPath = `${prefix}.stdout`, stderrPath = `${prefix}.stderr`;
  const output: FileHandle[] = [];
  let child: ReturnType<typeof spawn> | null = null;
  let result: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };
  const started = performance.now();
  const record: CommandRecord = { argv, startedAt: new Date().toISOString(), endedAt: "", elapsedMs: 0,
    exit: null, signal: null, timedOut: false, commandError: null, cleanupError: null, groupAbsent: null,
    rawCloseErrors: [], stdout: stdoutPath, stderr: stderrPath, readbackPending: true, rawOriginalIdentities: [] };
  let watch: ReturnType<typeof setTimeout> | undefined;
  try {
    output.push(await open(stdoutPath, "wx", 0o600));
    output.push(await open(stderrPath, "wx", 0o600));
    const spawned = spawn(argv[0], argv.slice(1), { detached: true, stdio: ["ignore", output[0].fd, output[1].fd],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: directory, LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "test" } });
    child = spawned;
    const kill = () => { if (child?.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") record.cleanupError = String(error);
    } } };
    watch = setTimeout(() => { record.timedOut = true; kill(); }, seconds * 1000);
    let busy = false, tickPromise: Promise<void> | undefined;
    const interval = tick ? setInterval(() => {
      if (busy) return; busy = true;
      tickPromise = tick().catch((error: unknown) => { record.commandError = String(error); kill(); }).finally(() => { busy = false; });
    }, 1000) : undefined;
    try { result = await new Promise((resolve, reject) => {
      spawned.once("error", reject); spawned.once("close", (code, signal) => resolve({ code, signal }));
    }); } finally { if (interval) clearInterval(interval); await tickPromise; }
    if (spawned.pid) {
      try { process.kill(-spawned.pid, 0); record.groupAbsent = false; kill(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") record.groupAbsent = true;
        else record.cleanupError = String(error); }
      if (record.groupAbsent === false) {
        const until = performance.now() + 5000;
        while (performance.now() < until) {
          try { process.kill(-spawned.pid, 0); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") { record.groupAbsent = true; break; }
            record.cleanupError = String(error); break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    }
  } catch (error) { record.commandError ??= String(error); }
  finally {
    if (watch) clearTimeout(watch);
    for (const file of output) {
      try { await file.sync(); } catch (error) { record.rawCloseErrors.push(String(error)); }
      try { const s = await file.stat(); record.rawOriginalIdentities.push({ dev: s.dev, ino: s.ino, size: s.size,
        nlink: s.nlink, uid: s.uid, mode: s.mode }); } catch (error) { record.rawCloseErrors.push(String(error)); }
      try { await file.close(); } catch (error) { record.rawCloseErrors.push(String(error)); }
    }
  }
  record.endedAt = new Date().toISOString(); record.elapsedMs = performance.now() - started;
  record.exit = result.code; record.signal = result.signal;
  await saveJson(`${prefix}.original-result.json`, record);
  const data: Record<string, unknown> = {};
  let stdout = "";
  for (const [index, p] of [stdoutPath, stderrPath].entries()) {
    let fd: FileHandle | null = null;
    try { const s = await lstat(p), original = record.rawOriginalIdentities[index];
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 4 * 1024 ** 2 || !original
        || s.dev !== original.dev || s.ino !== original.ino || s.size !== original.size
        || s.uid !== original.uid || s.mode !== original.mode) throw new Error("raw_boundary_refused");
      fd = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await fd.stat(); if (opened.dev !== s.dev || opened.ino !== s.ino || opened.nlink !== 1) throw new Error("raw_open_identity_refused");
      const bytes = await fd.readFile(), end = await fd.stat(), namedEnd = await lstat(p);
      if (end.dev !== opened.dev || end.ino !== opened.ino || end.size !== opened.size || end.nlink !== 1
        || namedEnd.dev !== end.dev || namedEnd.ino !== end.ino || namedEnd.nlink !== 1 || namedEnd.size !== end.size)
        throw new Error("raw_read_identity_refused");
      data[p] = { bytes: bytes.length, sha256: sha256(bytes) };
      if (p === stdoutPath) stdout = bytes.toString("utf8");
    } catch (error) { data[p] = { error: String(error) }; record.rawCloseErrors.push(String(error)); }
    finally { if (fd) { try { await fd.close(); } catch (error) { record.rawCloseErrors.push(String(error)); } } }
  }
  await saveJson(`${prefix}.raw-readback.json`, data);
  if (record.exit !== 0 || record.signal || record.timedOut || record.commandError || record.cleanupError
    || record.rawCloseErrors.length || record.groupAbsent !== true) throw new Error(`command_${ordinal}_failed`);
  return { stdout, record };
}

export async function saveJson(file: string, value: unknown): Promise<void> {
  const fd = await open(file, "wx", 0o600);
  try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
}
