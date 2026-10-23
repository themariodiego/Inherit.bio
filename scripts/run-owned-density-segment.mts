/** Source-only additive operator entrypoint. Uses the existing owned host, FIFO,
 * build, actual fresh capture and release doors; supplies no runtime defaults. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertOwnedLinuxSource, establishOwnedLinuxRuntime, ownedLinuxEnvironment,
  readPrivateOperatorPipe, releaseOwnedLinuxRuntime } from "./owned-linux-runtime";
import { ownedLinuxAppBootstrap } from "./comprehension/run-owned-linux.mjs";
import { freshComprehensionBuildEnvironment, prepareFreshInvocation } from "./comprehension/run-fresh-t6.mjs";
import { acquireFreshStack, createResourceIO, infrastructureChildEnvironment } from "./comprehension/fresh-t6-resources";
import { recordCiBuild } from "./ci-browser-runtime";
import { densityCapturePlan, densitySourceSchema, densityStateKey } from "./density-capture-plan";
import { requiredDensityCaptures, type DensityRegister } from "./density-current";
import { checkedDensityCaptureSegment } from "./density-segments";
import { densityRootNativeObserverFactory } from "./density-root-native-observer-binding";
import { runOwnedDensityCapture } from "./density-owned-capture";
import { densityBaselineOriginalsInputSchema, type DensityBaselineOriginalsInput } from "./density-baseline-originals";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const absolute = z.string().refine(value => path.isAbsolute(value) && path.resolve(value) === value);
export const densityOwnedSegmentFrameSchema = z.object({ version: z.literal(1),
  selection: z.object({ routeId: z.string().min(1), state: z.string().min(1), viewport: z.enum(["390x844", "1280x800"]) }).strict(),
  output: absolute, fontManifestPath: absolute, fontManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  freshPublicObservationDirectory: absolute, prepare: z.boolean() }).strict();

function publicBytes(file: string) {
  assert(fs.realpathSync(file) === file); const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const a = fs.fstatSync(fd, { bigint: true }), bytes = fs.readFileSync(fd), b = fs.fstatSync(fd, { bigint: true });
    assert(a.isFile() && a.nlink === BigInt(1) && BigInt(bytes.length) === a.size
      && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs);
    return bytes;
  } finally { fs.closeSync(fd); }
}

export async function runOwnedDensitySegment(owner: unknown, rootInput: { baselineOriginals?: DensityBaselineOriginalsInput } = {}) {
  // Optional public API input only; the original seven-field FIFO frame stays exact.
  const supplied = z.object({ baselineOriginals: densityBaselineOriginalsInputSchema.optional() }).strict().parse(rootInput);
  const operator = establishOwnedLinuxRuntime(owner);
  process.stderr.write(`OWNED_LINUX_READY:${operator.proof.nonce}\n`);
  const frame = densityOwnedSegmentFrameSchema.parse(await readPrivateOperatorPipe());
  const root = operator.proof.root, scratch = operator.proof.scratch;
  assert(path.dirname(frame.output) === scratch && path.dirname(frame.freshPublicObservationDirectory) === scratch
    && frame.output !== frame.freshPublicObservationDirectory && !fs.existsSync(frame.output));
  assert(sha256(publicBytes(frame.fontManifestPath)) === frame.fontManifestSha256);
  const registerBytes = publicBytes(path.join(root, "docs/route-register.json"));
  const register = JSON.parse(registerBytes.toString("utf8")) as DensityRegister;
  const required = requiredDensityCaptures(register);
  checkedDensityCaptureSegment(frame.selection, densityCapturePlan(register,
    [...new Set(required.map(row => densityStateKey(row.route.id, row.state)))]));
  // The complete original provider census is checked again by the capture
  // driver. This early check admits only the requested registered identity.
  const signer = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  Object.assign(process.env, ownedLinuxEnvironment(operator), ownedLinuxAppBootstrap(), {
    INHERIT_UPLOAD_SIGNING_JWK: JSON.stringify({ ...signer, kid: randomUUID(), alg: "ES256", use: "sig" }) });
  const signal = new AbortController().signal, io = createResourceIO(operator);
  const infrastructure = () => infrastructureChildEnvironment(process.env, operator);
  const observeSource = async () => {
    assertOwnedLinuxSource(operator, infrastructure());
    const head = await io.command("git", ["rev-parse", "HEAD"], { env: infrastructure() });
    const tree = await io.command("git", ["rev-parse", "HEAD^{tree}"], { env: infrastructure() });
    assert(head === operator.proof.head);
    return densitySourceSchema.parse({ head, tree, registerSha256: sha256(publicBytes(path.join(root, "docs/route-register.json"))) });
  };
  const source = await observeSource();
  const nativeObservers = densityRootNativeObserverFactory({ root, signal,
    freshPublicObservationDirectory: frame.freshPublicObservationDirectory });
  await prepareFreshInvocation({ environment: process.env, bindObservedKeys: true, buildRequired: frame.prepare,
    acquire: () => acquireFreshStack(signal, io, operator), build: async () => {
      await io.command("pnpm", ["build"], { env: freshComprehensionBuildEnvironment(infrastructure(), process.env, true), timeout: 600_000 });
      recordCiBuild(infrastructure(), operator);
    } });
  const result = await runOwnedDensityCapture({ root, output: frame.output, fontManifestPath: frame.fontManifestPath,
    observeSource, nativeObservers, signal, operator, segment: frame.selection,
    ...(supplied.baselineOriginals === undefined ? {} : { baselineOriginals: supplied.baselineOriginals }) });
  assert(result.status === "CAPTURED_SEGMENT_EXTERNAL_CLOSURE_PENDING" && result.captures === 1
    && "targetHolds" in result && result.targetHolds.length === 0, "Exact successful capture and target assertions required");
  assert.deepEqual(await observeSource(), source);
  assert(sha256(publicBytes(frame.fontManifestPath)) === frame.fontManifestSha256);
  // Only after actual per-capture close, exact empty-daemon/source/lease checks.
  // A later Root process/group/native closure review is still mandatory.
  releaseOwnedLinuxRuntime(operator);
  return { version: 1, status: "DENSITY_SEGMENT_CAPTURE_RETURNED_AND_OWNER_RELEASED", selection: frame.selection,
    source, remainingCaptureCount: required.length - 1, resumable: false, g2_5Acceptance: false };
}

const BASELINE_ORIGINALS_PACKET = "baseline-originals.json";
const SEGMENT_FLAGS = new Set(["--owner", "--baseline-originals", "--baseline-originals-sha256"]);

/** Root's pinned packet, read once by a stable no-follow descriptor. Its size
 * comes from the file itself; its sha256 comes only from the operator. */
function privatePacketBytes(file: string) {
  const directory = path.dirname(file), parent = fs.lstatSync(directory, { bigint: true });
  assert(fs.realpathSync(directory) === directory && parent.isDirectory() && parent.uid === BigInt(process.getuid!())
    && (parent.mode & BigInt(0o7777)) === BigInt(0o700), "Root's private 0700 baseline-originals directory required");
  assert(fs.realpathSync(file) === file, "Baseline originals packet must not be a link");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const a = fs.fstatSync(fd, { bigint: true });
    assert(a.isFile() && a.nlink === BigInt(1) && a.uid === BigInt(process.getuid!()) && (a.mode & BigInt(0o7777)) === BigInt(0o600)
      && a.size > BigInt(0) && a.size <= BigInt(1024 * 1024), "One private 0600 baseline originals packet of at most 1 MiB required");
    const bytes = fs.readFileSync(fd), b = fs.fstatSync(fd, { bigint: true });
    assert(BigInt(bytes.length) === a.size && a.dev === b.dev && a.ino === b.ino && a.size === b.size
      && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs, "Baseline originals packet changed while read");
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** The complete command line. Every refusal happens before an owned runtime
 * is established, and nothing here supplies a default or a runtime value. */
export function parseOwnedDensitySegmentArguments(argv: readonly string[]): {
  owner: unknown; baselineOriginals?: DensityBaselineOriginalsInput;
} {
  assert(Array.isArray(argv) && argv.length % 2 === 0 && argv.length >= 2 && argv.length <= 6, "Flag and value pairs required");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    assert(typeof flag === "string" && SEGMENT_FLAGS.has(flag) && !values.has(flag), "Each known flag at most once");
    assert(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "Every flag takes one value");
    values.set(flag, value);
  }
  const argument = values.get("--owner"); assert(argument !== undefined, "--owner required");
  const encoded = Buffer.from(argument, "base64url"), text = encoded.toString("utf8");
  assert(encoded.length > 0 && encoded.length <= 65_536 && encoded.toString("base64url") === argument && Buffer.from(text, "utf8").equals(encoded));
  const owner: unknown = JSON.parse(text);
  const file = values.get("--baseline-originals"), digest = values.get("--baseline-originals-sha256");
  assert((file === undefined) === (digest === undefined), "--baseline-originals and --baseline-originals-sha256 come together");
  if (file === undefined || digest === undefined) return { owner };
  assert(/^[a-f0-9]{64}$/.test(digest), "Full lowercase sha256 required");
  assert(path.isAbsolute(file) && path.resolve(file) === file && path.basename(file) === BASELINE_ORIGINALS_PACKET,
    `Absolute path to Root's ${BASELINE_ORIGINALS_PACKET} required`);
  const bytes = privatePacketBytes(file);
  assert(sha256(bytes) === digest, "Baseline originals packet sha256 differs");
  return { owner, baselineOriginals: densityBaselineOriginalsInputSchema.parse({
    directory: path.dirname(file), packetBytes: bytes.length, packetSha256: digest }) };
}

export async function runOwnedDensitySegmentCommand(argv: readonly string[], run: typeof runOwnedDensitySegment = runOwnedDensitySegment) {
  const { owner, baselineOriginals } = parseOwnedDensitySegmentArguments(argv);
  return baselineOriginals === undefined ? run(owner) : run(owner, { baselineOriginals });
}

async function main() {
  console.log(JSON.stringify(await runOwnedDensitySegmentCommand(process.argv.slice(2))));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Owned density segment refused; no private values printed"); process.exitCode = 1; });
}
