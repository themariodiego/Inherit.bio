import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, statfs, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { clamdScanner } from "../src/lib/scan/clamd";
import { MAXIMUM_SCANNED_BYTES } from "../src/lib/scan/malware-scanner";
import { CLAMAV_IMAGE, PROOF_LABEL, assertOwnedContainer, assertRealVerdict, boundedCommand,
  clamdDiagnosticCommands, parseClamdWaitStatus, eicarBytes, netBytes, saveJson, sha256, signatureAllocatedBytes, signatureAllocationCommand, syntheticPdf } from "./claim-scanner-real-proof";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePaths = ["AGENTS.md", "package.json", "pnpm-lock.yaml", ".github/workflows/claim-scanner-real-proof.yml",
  "scripts/claim-scanner-real-proof.run.mts", "scripts/claim-scanner-real-proof.ts", "scripts/claim-scanner-real-proof.test.ts", "scripts/env-gate.test.ts",
  "src/lib/scan/clamd.ts", "src/lib/scan/malware-scanner.ts", "src/lib/scan/test-double-scanner.ts",
  "src/lib/scan/clamd.test.ts", "src/lib/scan/test-double-scanner.test.ts", "src/lib/legal/jurisdictions.ts",
  ".env.example", "docs/self-hosting.md", "docs/claim-scanner-real-proof.md", "docs/test-diff-register.md"];

async function sourceSnapshot() {
  const rows = [];
  for (const name of sourcePaths) {
    const file = path.join(root, name), before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("source_shape_refused");
    const bytes = await readFile(file), after = await lstat(file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("source_changed_during_read");
    rows.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return rows;
}

async function portOpen(timeoutMs = 1000, observe?: (value: Record<string, unknown>) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString(), started = performance.now();
    const socket = net.createConnection({ host: "127.0.0.1", port: 45310 });
    let settled = false;
    const done = (value: boolean, response: string, error?: string) => {
      if (settled) return; settled = true;
      observe?.({ command: "TCP_CONNECT", host: "127.0.0.1", port: 45310, startedAt, endedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started, capMilliseconds: timeoutMs, connected: value, response, error: error ?? null });
      socket.destroy(); resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false, "timeout"));
    socket.once("connect", () => done(true, "connected"));
    socket.once("error", (error) => done(false, "error", (error as NodeJS.ErrnoException).code));
  });
}

async function signatureRows(directory: string) {
  const rows: Array<{ path: string; bytes: number; allocated: number }> = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), st = await lstat(file);
      if (st.isSymbolicLink()) throw new Error("signature_symlink_refused");
      if (st.isDirectory()) await walk(file);
      else if (st.isFile() && st.nlink === 1) rows.push({ path: path.relative(directory, file), bytes: st.size, allocated: st.blocks * 512 });
      else throw new Error("signature_file_shape_refused");
    }
  }
  await walk(directory); return rows;
}

async function main(): Promise<void> {
  if (process.platform !== "linux" || process.arch !== "x64" || process.env.GITHUB_ACTIONS !== "true"
    || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.env.INHERIT_TEST_JURISDICTION !== "1"
    || process.env.NODE_ENV !== "test" || process.env.VERCEL_ENV !== "development"
    || ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SUPABASE_DB_URL", "RESEND_API_KEY", "BYOK_ENCRYPTION_KEY"]
      .some((key) => process.env[key])) throw new Error("isolated_hosted_context_required");
  const temporary = process.env.RUNNER_TEMP;
  if (!temporary || !path.isAbsolute(temporary) || await portOpen()) throw new Error("temporary_or_port_refused");
  const available = /MemAvailable:\s+(\d+) kB/u.exec(await readFile("/proc/meminfo", "utf8"));
  const disk = await statfs(temporary);
  if (!available || Number(available[1]) * 1024 < 4.5 * 1024 ** 3 || disk.bavail * disk.bsize < 6 * 1024 ** 3)
    throw new Error("hosted_resource_headroom_refused");
  const output = await mkdtemp(path.join(temporary, "inherit-real-scanner-")); await chmod(output, 0o700);
  // This path is synthetic-only. A failure remains available for the always() artifact step.
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `proof-output=${output}\n`, { flag: "a" });
  const nonce = crypto.randomUUID(), name = `inherit-real-scanner-${nonce}`, network = `inherit-scanner-${nonce}`;
  const signatures = path.join(output, "signatures"), config = path.join(output, "config");
  let ordinal = 0, id: string | null = null, networkCreated = false;
  let before: Awaited<ReturnType<typeof sourceSnapshot>> | null = null;
  let originalIds: string | null = null, originalVolumes: string | null = null;
  let signatureIdentity: { dev: number; ino: number } | null = null;
  const cleanupErrors: string[] = [];
  let failure: string | null = null;
  const observations: Record<string, unknown> = {};
  let readinessOriginal: { capSeconds: number; diagnosticSnapshotLimit: number; diagnosticSnapshotMinimumIntervalMs: number; startedAt: string; endedAt?: string; probes: Record<string, unknown>[]; snapshots: Record<string, unknown>[] } | null = null;
  const command = async (args: string[], timeout = 30, tick?: () => Promise<void>) =>
    (await boundedCommand(output, ++ordinal, args, timeout, tick)).stdout.trim();
  const docker = (args: string[], timeout = 30, tick?: () => Promise<void>) => command(["docker", ...args], timeout, tick);
  const inspect = async (reference: string) => {
    const rows = JSON.parse(await docker(["inspect", reference])) as unknown[];
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("inspect_shape_refused");
    return rows[0];
  };
  const own = async () => {
    if (!id) throw new Error("owned_id_missing"); const info = await inspect(id); assertOwnedContainer(info, id, nonce); return info;
  };
  try {
    before = await sourceSnapshot(); await saveJson(`${output}/source-before.json`, before);
    originalIds = await docker(["ps", "-aq", "--no-trunc"]);
    originalVolumes = await docker(["volume", "ls", "-q"]);
    await saveJson(`${output}/inventory-before.json`, { containers: originalIds, volumes: originalVolumes });
    await docker(["pull", "--platform", "linux/amd64", CLAMAV_IMAGE], 180);
    const image = JSON.parse(await docker(["image", "inspect", CLAMAV_IMAGE])) as Array<{ Architecture: string; Os: string; RepoDigests: string[];
      Config?: { Volumes?: Record<string, unknown>; Entrypoint?: string[] } }>;
    if (image.length !== 1 || image[0].Architecture !== "amd64" || image[0].Os !== "linux"
      || !image[0].RepoDigests.includes(CLAMAV_IMAGE) || Object.keys(image[0].Config?.Volumes ?? {}).length
      || image[0].Config?.Entrypoint?.join(",") !== "/init") throw new Error("pinned_image_shape_refused");
    await mkdir(signatures, { mode: 0o755 }); await mkdir(config, { mode: 0o755 });
    const fresh = "DatabaseDirectory /signatures\nDatabaseMirror database.clamav.net\nMaxAttempts 1\nConnectTimeout 10\nReceiveTimeout 30\nScriptedUpdates yes\nTestDatabases yes\nBytecode yes\nForeground yes\n";
    const clamd = "DatabaseDirectory /signatures\nForeground yes\nTCPSocket 3310\nTCPAddr 0.0.0.0\nStreamMaxLength 21M\nMaxFileSize 21M\nMaxScanSize 100M\nMaxThreads 1\nConcurrentDatabaseReload no\nOfficialDatabaseOnly yes\nTemporaryDirectory /tmp\nLogFile /dev/null\nLogFileUnlock yes\nLogClean no\nLogSyslog no\n";
    await writeFile(`${config}/freshclam.conf`, fresh, { flag: "wx", mode: 0o644 });
    await writeFile(`${config}/clamd.conf`, clamd, { flag: "wx", mode: 0o644 });
    // Official Debian source defines clamav UID/GID1000. Only this new empty store changes owner.
    const sigIdentity = await lstat(signatures);
    if (!sigIdentity.isDirectory() || sigIdentity.isSymbolicLink() || (await readdir(signatures)).length) throw new Error("new_signature_store_refused");
    signatureIdentity = { dev: sigIdentity.dev, ino: sigIdentity.ino };
    await command(["sudo", "chown", "1000:1000", "--", signatures]);
    const sigAfter = await lstat(signatures);
    if (sigAfter.dev !== sigIdentity.dev || sigAfter.ino !== sigIdentity.ino || sigAfter.uid !== 1000 || sigAfter.gid !== 1000) throw new Error("signature_owner_refused");
    await docker(["network", "create", "--internal", "--label", `${PROOF_LABEL}=${nonce}`, network]); networkCreated = true;
    id = await docker(["create", "--name", name, "--label", `${PROOF_LABEL}=${nonce}`, "--pull", "never",
      "--platform", "linux/amd64", "--user", "clamav:clamav", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--memory", "4g", "--memory-swap", "4g", "--cpus", "1", "--pids-limit", "64",
      "--network", network, "--publish", "127.0.0.1:45310:3310", "--env", "TZ=UTC", "--no-healthcheck",
      "--mount", `type=bind,source=${config},target=/proof,readonly`, "--mount", `type=bind,source=${signatures},target=/signatures`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m,mode=1777", "--tmpfs", "/run:rw,noexec,nosuid,size=16m,mode=1777",
      "--entrypoint", "/bin/sh", CLAMAV_IMAGE, "-c", "trap 'exit 0' TERM INT; while :; do sleep 1; done"]);
    await own(); await docker(["start", id]);
    const shape = await docker(["exec", id, "/bin/sh", "-c", "test \"$(id -u)\" = 1000 && test \"$(id -g)\" = 1000 && test -x /usr/bin/freshclam && test -x /usr/sbin/clamd && test -x /usr/bin/find && test -f /etc/clamav/freshclam.conf && test -f /etc/clamav/clamd.conf && test -d /etc/clamav/certs && /usr/bin/freshclam --version"]);
    if (!/^ClamAV 1\.5\.4(?:\/|$)/u.test(shape)) throw new Error("official_packaged_shape_refused");
    await docker(["network", "connect", "bridge", id]);
    const bootstrapGuard = async () => {
      const metadata = await docker(signatureAllocationCommand(id!), 8);
      signatureAllocatedBytes(metadata);
      const io = await docker(["stats", "--no-stream", "--format", "{{.NetIO}}", id!], 8);
      if (netBytes(io.split("/")[0]) > 1024 ** 3) throw new Error("network_budget_exceeded");
      const free = await statfs(output); if (free.bavail * free.bsize < 4 * 1024 ** 3) throw new Error("disk_budget_exceeded");
    };
    await docker(["exec", id, "/usr/bin/freshclam", "--config-file=/proof/freshclam.conf", "--stdout"], 300, bootstrapGuard);
    await bootstrapGuard(); await docker(["network", "disconnect", "bridge", id]);
    const readyInfo = await own() as { NetworkSettings?: { Networks?: Record<string, unknown> } };
    if (Object.keys(readyInfo.NetworkSettings?.Networks ?? {}).join(",") !== network) throw new Error("scanner_egress_not_closed");
    const readyUntil = performance.now() + 120_000;
    readinessOriginal = { capSeconds: 120, diagnosticSnapshotLimit: 3, diagnosticSnapshotMinimumIntervalMs: 40_000, startedAt: new Date().toISOString(), probes: [], snapshots: [] };
    const remaining = () => {
      const seconds = (readyUntil - performance.now()) / 1000;
      if (seconds <= 0) throw new Error("real_clamd_not_ready");
      return seconds;
    };
    const diagnostic = clamdDiagnosticCommands(id);
    await docker(diagnostic.prepare, Math.min(30, remaining()));
    await docker(diagnostic.start, Math.min(30, remaining()));
    let nextDiagnosticAt = performance.now();
    while (true) {
      remaining();
      if (readinessOriginal.snapshots.length < readinessOriginal.diagnosticSnapshotLimit
        && performance.now() >= nextDiagnosticAt) {
        nextDiagnosticAt = performance.now() + readinessOriginal.diagnosticSnapshotMinimumIntervalMs;
        const snapshotOrdinal = ++ordinal;
        const observation: Record<string, unknown> = { ordinal: snapshotOrdinal, sampledAt: new Date().toISOString(),
          originalResult: `command-${snapshotOrdinal}.original-result.json`, rawReadback: `command-${snapshotOrdinal}.raw-readback.json`,
          waitStatusObserved: false };
        readinessOriginal.snapshots.push(observation);
        const snapshot = await boundedCommand(output, snapshotOrdinal, ["docker", ...diagnostic.snapshot], Math.min(8, remaining()));
        const waitStatus = parseClamdWaitStatus(snapshot.stdout);
        Object.assign(observation, { waitStatusObserved: true, waitStatusBeforeAnyOwnedStop: waitStatus,
          completeDaemonOutput: waitStatus !== null });
        if (waitStatus !== null) throw new Error("real_clamd_exited_before_ready");
      }
      const connected = await portOpen(Math.min(1000, remaining() * 1000), (probe) => readinessOriginal!.probes.push(probe));
      remaining(); // A delayed callback cannot earn readiness after the original deadline.
      if (connected) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining() * 1000)));
    }
    readinessOriginal.endedAt = new Date().toISOString();
    await saveJson(`${output}/readiness-original.json`, readinessOriginal);
    const scanner = clamdScanner({ address: { kind: "tcp", host: "127.0.0.1", port: 45310 } });
    const clean = syntheticPdf(), eicar = eicarBytes();
    const observe = async (caseName: string, bytes: Uint8Array) => {
      const startedAt = new Date().toISOString(), started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const verdict = await scanner.scan(bytes, controller.signal);
        await saveJson(`${output}/${caseName}-original-verdict.json`, { startedAt, endedAt: new Date().toISOString(),
          elapsedMs: performance.now() - started, ownerCapSeconds: 90, verdict });
        return verdict;
      } catch (error) {
        await saveJson(`${output}/${caseName}-original-error.json`, { startedAt, endedAt: new Date().toISOString(),
          elapsedMs: performance.now() - started, error: String(error) });
        throw error;
      } finally { clearTimeout(timer); }
    };
    const cleanResult = await observe("clean", clean);
    assertRealVerdict(cleanResult, "OK", clean, Date.now()); observations.clean = cleanResult;
    const found = await observe("eicar", eicar);
    assertRealVerdict(found, "FOUND", eicar, Date.now()); observations.eicar = found;
    if (cleanResult.verdict !== "OK" || found.verdict !== "FOUND"
      || cleanResult.signatures.version !== found.signatures.version
      || cleanResult.signatures.publishedAt.getTime() !== found.signatures.publishedAt.getTime()) throw new Error("signature_set_changed");
    const large = Buffer.alloc(MAXIMUM_SCANNED_BYTES + 1);
    const oversize = await observe("oversize", large);
    if (oversize.verdict !== "OVERSIZE" || oversize.sha256 !== sha256(large)) throw new Error("oversize_refusal_failed");
    observations.oversize = oversize;
    await own(); await docker(["stop", "--time", "10", id]);
    const stopped = await own() as { State?: { Running?: boolean; OOMKilled?: boolean } };
    if (stopped.State?.Running !== false || stopped.State.OOMKilled || await portOpen()) throw new Error("owned_scanner_stop_unproved");
    const unavailable = await observe("stopped", clean);
    if (unavailable.verdict !== "UNAVAILABLE" || unavailable.reason !== "unreachable") throw new Error("stopped_scanner_not_closed");
    observations.stopped = unavailable;
    await saveJson(`${output}/signature-inventory.json`, await signatureRows(signatures));
  } catch (error) { failure = String(error); await saveJson(`${output}/first-failure.json`, { error: failure, observations }); }
  finally {
    if (readinessOriginal && !readinessOriginal.endedAt) {
      readinessOriginal.endedAt = new Date().toISOString();
      try { await saveJson(`${output}/readiness-original.json`, readinessOriginal); }
      catch (error) { cleanupErrors.push(`readiness_original_custody_failed:${String(error)}`); }
    }
    // Even an interrupted create is located only by the unique name, then its label and boundaries must match.
    try {
      if (!id) {
        const ids = await docker(["ps", "-aq", "--no-trunc", "--filter", `name=^/${name}$`, "--filter", `label=${PROOF_LABEL}=${nonce}`]);
        if (ids) { if (ids.split("\n").length !== 1) throw new Error("owned_container_ambiguous"); id = ids; }
      }
      if (id) { await own(); await docker(["stop", "--time", "10", id]); await own(); await docker(["rm", id]); }
    } catch (error) { cleanupErrors.push(String(error)); }
    try {
      if (!networkCreated) {
        const ownedNetworks = await docker(["network", "ls", "--filter", `name=^${network}$`, "--filter", `label=${PROOF_LABEL}=${nonce}`, "--format", "{{.Name}}"]);
        if (ownedNetworks) {
          if (ownedNetworks !== network) throw new Error("owned_network_ambiguous");
          networkCreated = true;
        }
      }
      if (networkCreated) {
        const n = JSON.parse(await docker(["network", "inspect", network])) as Array<{ Labels?: Record<string, string>; Containers?: Record<string, unknown> }>;
        if (n.length !== 1 || n[0].Labels?.[PROOF_LABEL] !== nonce || Object.keys(n[0].Containers ?? {}).length) throw new Error("network_cleanup_ownership_refused");
        await docker(["network", "rm", network]);
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    try {
      const after = await sourceSnapshot(); await saveJson(`${output}/source-after.json`, after);
      if (!before || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("source_after_mismatch");
      const finalIds = await docker(["ps", "-aq", "--no-trunc"]), finalVolumes = await docker(["volume", "ls", "-q"]);
      await saveJson(`${output}/inventory-after.json`, { containers: finalIds, volumes: finalVolumes });
      if (finalIds !== originalIds || finalVolumes !== originalVolumes) throw new Error("original_docker_inventory_changed");
    } catch (error) { cleanupErrors.push(String(error)); }
    // Signatures are public, generated data. Only the fresh job-owned store is removed; raw/source proof remains.
    try {
      const current = await lstat(signatures);
      if (!current.isDirectory() || current.isSymbolicLink() || !signatureIdentity
        || current.dev !== signatureIdentity.dev || current.ino !== signatureIdentity.ino) throw new Error("signature_cleanup_identity_refused");
      if (!cleanupErrors.length) {
        await command(["sudo", "rm", "-rf", "--", signatures]);
        try { await lstat(signatures); throw new Error("signature_store_not_removed"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(String(error)); }
    const pass = !failure && !cleanupErrors.length && Object.keys(observations).length === 4;
    await saveJson(`${output}/receipt.json`, { status: pass ? "PASS" : "HOLD", sourceCommit: process.env.GITHUB_SHA,
      actualNode: process.version, image: CLAMAV_IMAGE, fourCases: observations, failure, cleanupErrors,
      limits: "Real isolated scanner adapter only; no claim lifecycle, database, R2, email, native rollback, production or release credit." });
    if (!pass) process.exitCode = 1;
  }
}

await main();
