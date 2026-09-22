/** Local synthetic CPU/codec comparison. No database, provider or hosted I/O.
 * Usage: node --conditions=react-server --import ./scripts/server-only-shim.mjs
 *   --import tsx scripts/benchmark-prepared-merge.mts --baseline <commit-sha>
 * Only the baseline merge engines come from that commit; both versions use the
 * current unchanged codecs and fixtures. One warmup, six alternating pairs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { encodePreparedBlock } from "../src/lib/genome/prepared-source/codec";
import { encodeCanonicalBlock } from "../src/lib/genome/prepared-source/canonical-codec";
import { syntheticSource as source } from "../src/lib/genome/prepared-source/fixtures";
import { mergePreparedRuns } from "../src/lib/genome/prepared-source/merge";
import { mergeCanonicalRuns } from "../src/lib/genome/prepared-source/canonical-merge";
import type { PreparedRunReceipt } from "../src/lib/genome/prepared-source/runs";
import type { CanonicalRunReceipt } from "../src/lib/genome/prepared-source/canonical-runs";
import type { PreparedBlockDescriptor, PreparedEvent } from "../src/lib/genome/prepared-source/schema";
import type { CanonicalBlockDescriptor } from "../src/lib/genome/prepared-source/canonical-codec";
import type { CanonicalBinding, CanonicalRecord } from "../src/lib/genome/prepared-source/canonical-schema";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), baseline = args[1];
if (args.length !== 2 || args[0] !== "--baseline" || !/^[0-9a-f]{40}$/.test(baseline ?? "")) {
  throw new Error("Provide --baseline with one full commit SHA");
}
const binding: CanonicalBinding = { version: "prepared-canonical-v1", source, targetBuild: "GRCh38", liftoverSha256: null };
const sourceRuns: PreparedRunReceipt[] = [], canonicalRuns: CanonicalRunReceipt[] = [];
const sourceBytes = new Map<number, Uint8Array>(), canonicalBytes = new Map<number, Uint8Array>();
let sequence = 0;
for (let run = 0; run < 8; run++) {
  const blocks: PreparedBlockDescriptor[] = [], canonicalBlocks: CanonicalBlockDescriptor[] = [];
  for (let block = 0; block < 8; block++) {
    const events: PreparedEvent[] = Array.from({ length: 2000 }, (_, i) => {
      const pos = (block * 2000 + i) * 8 + run + 1;
      return { type: "variant", line: pos + 3, record: { rsid: pos, chrom: 1, pos, ref: "A", alt: "C", genotype: "A/C" } };
    });
    const encoded = await encodePreparedBlock({ source, sequence, events });
    blocks.push(encoded.descriptor); sourceBytes.set(sequence, encoded.compressed);
    const records: CanonicalRecord[] = events.map(event => {
      if (event.type !== "variant") throw new Error("Synthetic fixture mismatch");
      return { type: "canonical-record", version: "prepared-canonical-v1", event,
        normalization: { status: "normalized", record: { ...event.record } } };
    });
    const canonical = await encodeCanonicalBlock({ binding, sequence, records });
    canonicalBlocks.push(canonical.descriptor); canonicalBytes.set(sequence, canonical.compressed); sequence++;
  }
  sourceRuns.push({ version: "prepared-run-v1", state: "provisional", source, sequence: run, eventCount: 16_000, blocks });
  canonicalRuns.push({ version: "canonical-run-v1", state: "provisional", binding, sequence: run, recordCount: 16_000, blocks: canonicalBlocks });
}

const directory = await mkdtemp(join(tmpdir(), "inherit-merge-benchmark-"));
try {
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  for (const name of ["merge", "canonical-merge"]) {
    const relative = `src/lib/genome/prepared-source/${name}.ts`;
    const original = execFileSync("git", ["show", `${baseline}:${relative}`], { cwd: root, encoding: "utf8" });
    const linked = original.replace(/from "(\.[^"]+)"/g, (_whole, specifier: string) =>
      `from ${JSON.stringify(pathToFileURL(resolve(dirname(join(root, relative)), specifier)).href)}`);
    await writeFile(join(directory, `${name}.ts`), linked);
  }
  const oldSource = (await import(pathToFileURL(join(directory, "merge.ts")).href)).mergePreparedRuns as typeof mergePreparedRuns;
  const oldCanonical = (await import(pathToFileURL(join(directory, "canonical-merge.ts")).href)).mergeCanonicalRuns as typeof mergeCanonicalRuns;
  type Row = { iteration: number; kind: "source" | "canonical"; mode: "baseline" | "candidate";
    seconds: number; cpuSeconds: number; count: number; reads: number; sha256: string; summary: unknown };
  const results: Row[] = [];
  for (let iteration = 0; iteration < 7; iteration++) {
    for (const kind of ["source", "canonical"] as const) {
      const modes = iteration % 2 ? ["candidate", "baseline"] as const : ["baseline", "candidate"] as const;
      for (const mode of modes) {
        let reads = 0, count = 0, summary: unknown;
        const hash = createHash("sha256"), signal = new AbortController().signal;
        async function* readBlock(descriptor: { sequence: number }) {
          reads++; const bytes = (kind === "source" ? sourceBytes : canonicalBytes).get(descriptor.sequence);
          if (!bytes) throw new Error("Synthetic block missing"); yield bytes;
        }
        const started = performance.now(), cpu = process.cpuUsage();
        const stream = kind === "source"
          ? (mode === "baseline" ? oldSource : mergePreparedRuns)(sourceRuns, { source, readBlock, signal })
          : (mode === "baseline" ? oldCanonical : mergeCanonicalRuns)(canonicalRuns, { binding, readBlock, signal });
        for await (const item of stream) {
          if (item.type.endsWith("summary")) summary = item;
          else { hash.update(JSON.stringify(item)); count++; }
        }
        const usage = process.cpuUsage(cpu);
        results.push({ iteration, kind, mode, seconds: (performance.now() - started) / 1000,
          cpuSeconds: (usage.user + usage.system) / 1e6, count, reads, sha256: hash.digest("hex"), summary });
      }
    }
  }
  for (const kind of ["source", "canonical"] as const) {
    const rows = results.filter(row => row.kind === kind), first = rows[0];
    if (rows.some(row => row.count !== 128_000 || row.reads !== 64 || row.sha256 !== first.sha256
      || !row.summary || !isDeepStrictEqual(row.summary, first.summary))) throw new Error("Merge output mismatch");
  }
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), baselineCommit: baseline,
    node: process.version, platform: process.platform, arch: process.arch, warmupIterations: 1, measuredPairs: 6,
    runs: 8, recordsPerRun: 16_000, recordsPerBlock: 2000, results: results.map(({ summary, ...row }) => ({ ...row,
      summarySha256: createHash("sha256").update(JSON.stringify(summary)).digest("hex") })) }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
