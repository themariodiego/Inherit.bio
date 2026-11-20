/** Offline operator command: combine one directory of exact owned segment
 * outputs with the existing union reader, `aggregateDensitySegmentOriginals`.
 * It recomputes every PNG with the frozen pixel body and returns the union
 * HOLD. It confers no closure authority and never sets G2.5 acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { densitySourceSchema, densityStateKey, type DensitySource } from "./density-capture-plan";
import { requiredDensityCaptures, type DensityContract, type DensityRegister } from "./density-current";
import { aggregateDensitySegmentOriginals } from "./density-segments";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const UNION_FLAGS = new Set(["--segments", "--font-manifest", "--font-manifest-sha256", "--output"]);
const checkoutRoot = () => fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

/** The output directory name each segment must carry: the stem of its files. */
export const densitySegmentDirectoryName = (routeId: string, state: string, viewport: string) =>
  `${sha256(densityStateKey(routeId, state))}__${viewport}`;

const exact = (value: string) => path.isAbsolute(value) && path.resolve(value) === value;
const inside = (child: string, parent: string) => child === parent || child.startsWith(`${parent}${path.sep}`);
const absent = (file: string) => { try { fs.lstatSync(file); return false; } catch { return true; } };

function stableFile(file: string) {
  assert(fs.realpathSync(file) === file, "No link in a public input path");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const a = fs.fstatSync(fd, { bigint: true }), bytes = fs.readFileSync(fd), b = fs.fstatSync(fd, { bigint: true });
    assert(a.isFile() && a.nlink === BigInt(1) && BigInt(bytes.length) === a.size && a.dev === b.dev && a.ino === b.ino
      && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs, "One stable regular file required");
    return bytes;
  } finally { fs.closeSync(fd); }
}

export interface DensitySegmentUnionArguments {
  segments: string; fontManifestPath: string; fontManifestSha256: string; output: string;
}

/** Argument checking only. Every flag is required once; no value is defaulted. */
export function parseDensitySegmentUnionArguments(argv: readonly string[], root = checkoutRoot()): DensitySegmentUnionArguments {
  assert(Array.isArray(argv) && argv.length === 8, "Exactly --segments, --font-manifest, --font-manifest-sha256 and --output");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    assert(typeof flag === "string" && UNION_FLAGS.has(flag) && !values.has(flag), "Each known flag exactly once");
    assert(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "Every flag takes one value");
    values.set(flag, value);
  }
  const parsed = { segments: values.get("--segments")!, fontManifestPath: values.get("--font-manifest")!,
    fontManifestSha256: values.get("--font-manifest-sha256")!, output: values.get("--output")! };
  assert(/^[a-f0-9]{64}$/.test(parsed.fontManifestSha256), "Full lowercase font manifest sha256 required");
  for (const value of [parsed.segments, parsed.fontManifestPath, parsed.output])
    assert(exact(value), "Absolute normalized paths required");
  assert(!inside(parsed.segments, root) && !inside(parsed.output, root), "Segments and output stay outside the checkout");
  const segments = fs.lstatSync(parsed.segments);
  assert(fs.realpathSync(parsed.segments) === parsed.segments && segments.isDirectory() && segments.uid === process.getuid!()
    && (segments.mode & 0o7777) === 0o700, "One private 0700 segments directory owned by this user required");
  assert(sha256(stableFile(parsed.fontManifestPath)) === parsed.fontManifestSha256, "Font manifest sha256 differs");
  assert(path.extname(parsed.output) === ".json" && !inside(parsed.output, parsed.segments)
    && fs.realpathSync(path.dirname(parsed.output)) === path.dirname(parsed.output)
    && fs.lstatSync(path.dirname(parsed.output)).isDirectory(), "A new .json output beside, not inside, the segments");
  assert(absent(parsed.output), "Output must not exist; nothing is overwritten");
  return parsed;
}

/** Exactly one directory per required capture, each named by its own stem;
 * a stray file, a missing capture, a duplicate or an extra one is refused. */
export function densitySegmentDirectories(segments: string, register: DensityRegister) {
  const expected = requiredDensityCaptures(register).map(row => densitySegmentDirectoryName(row.route.id, row.state, row.viewport));
  assert(new Set(expected).size === expected.length);
  const entries = fs.readdirSync(segments, { withFileTypes: true });
  assert(entries.every(entry => entry.isDirectory() && !entry.isSymbolicLink()), "Only segment directories, no file or link");
  const names = entries.map(entry => entry.name).sort();
  assert(names.length === expected.length, `Whole capture union required: ${names.length} of ${expected.length} segments`);
  assert.deepEqual(names, [...expected].sort(), "Every segment directory is named by its own capture");
  for (const name of expected) assert(fs.existsSync(path.join(segments, name, `${name}.json`)), "Directory and capture disagree");
  return expected.map(name => path.join(segments, name));
}

/** The checkout's own head, tree and register, refused unless clean. */
export function observeCheckoutSource(root: string): DensitySource {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", LANG: "C.UTF-8",
    GIT_OPTIONAL_LOCKS: "0" } as unknown as NodeJS.ProcessEnv;
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 30_000,
    maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "ignore"] }).trim();
  assert(git(["status", "--porcelain=v1", "--untracked-files=all", "-z"]) === "", "Clean checkout at the captured head required");
  return densitySourceSchema.parse({ head: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]),
    registerSha256: sha256(stableFile(path.join(root, "docs/route-register.json"))) });
}

export async function runDensitySegmentUnionCommand(argv: readonly string[], options: {
  root?: string; observeSource?: () => Promise<DensitySource>; aggregate?: typeof aggregateDensitySegmentOriginals;
} = {}) {
  const root = options.root ?? checkoutRoot();
  const args = parseDensitySegmentUnionArguments(argv, root);
  const register = JSON.parse(stableFile(path.join(root, "docs/route-register.json")).toString("utf8")) as DensityRegister;
  const contract = JSON.parse(stableFile(path.join(root, "docs/density-baseline.json")).toString("utf8")) as DensityContract;
  const directories = densitySegmentDirectories(args.segments, register);
  const observeSource = options.observeSource ?? (async () => observeCheckoutSource(root));
  const source = await observeSource();
  const union = await (options.aggregate ?? aggregateDensitySegmentOriginals)({ root, directories, source, register, contract,
    fontManifestPath: args.fontManifestPath, observeSource });
  assert(union.status === "COMPLETE_SOURCE_BOUND_SEGMENT_UNION_ROOT_CLOSURE_REQUIRED" && union.g2_5Acceptance === false
    && union.captures === directories.length, "Exact union HOLD required");
  assert(sha256(stableFile(args.fontManifestPath)) === args.fontManifestSha256, "Font manifest changed during the union");
  const bytes = Buffer.from(`${JSON.stringify(union, null, 2)}\n`, "utf8");
  const fd = fs.openSync(args.output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { version: 1, status: union.status, numeric: union.numeric.status, contractNumeric: union.contractNumeric.status,
    captures: union.captures, output: args.output, outputSha256: sha256(bytes), g2_5Acceptance: false as const,
    next: "Root's closure review of every owner is still required; this union is not acceptance." };
}

/** Only an exceeded budget names its public capture identity; anything else stays generic. */
export function densitySegmentUnionRefusal(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^(?:Density budget exceeded: \[[^\n]{1,512}\]|Relative density budget exceeded|Missing density captures: \d+)$/.test(message)
    ? `Density segment union refused: ${message}` : "Density segment union refused; no private values printed";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDensitySegmentUnionCommand(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(densitySegmentUnionRefusal(error)); process.exitCode = 1; });
}
