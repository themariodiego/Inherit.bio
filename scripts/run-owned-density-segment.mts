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

async function main() {
  const argv = process.argv.slice(2); assert(argv.length === 2 && argv[0] === "--owner");
  const encoded = Buffer.from(argv[1], "base64url"), text = encoded.toString("utf8");
  assert(encoded.length > 0 && encoded.length <= 65_536 && encoded.toString("base64url") === argv[1] && Buffer.from(text, "utf8").equals(encoded));
  console.log(JSON.stringify(await runOwnedDensitySegment(JSON.parse(text))));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Owned density segment refused; no private values printed"); process.exitCode = 1; });
}
