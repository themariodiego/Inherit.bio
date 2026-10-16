/**
 * Finite qualification caller for the private TEST statement archive service.
 *
 * The service is the separate Worker in `workers/requester-statement-archive`:
 * a signed private transport (`src/private-transport.ts`) in front of one
 * Durable Object per allocation (`src/requester-statement-r2-gateway.ts`) that
 * alone holds the TEST R2 bucket binding. The source is unrun, and
 * `docs/requester-statement-archive-service.md:30-32` keeps the TEST flag off
 * until the real all-writer exclusion, conditional final commit, permanent
 * terminal marker retention and disposal proofs pass. Nothing in the
 * repository called the deployed service to produce that evidence. This module
 * is that caller, and only that:
 *
 *  - `QUALIFICATION_CASES` is a closed plan. Every case cites the source or
 *    document line it qualifies, and every step names the exact R2 calls the
 *    worker source makes for it (`RPC_WORST_CASE`, `stepCost`).
 *  - `proveQualificationBudget` proves, before any request is sent, that the
 *    whole plan fits the owner's limits even if every step and every cleanup
 *    attempt takes its worst case. It refuses otherwise.
 *  - `createQualificationLedger` enforces the same limits while a run is in
 *    progress: each case's cleanup is reserved before the case's first
 *    request, body steps cannot spend the cleanup reservation, and a case whose
 *    worst case would exceed either limit is refused before it starts.
 *  - `runQualification` stops at the first unexpected result, cleans up every
 *    allocation the case may have written, and writes receipts that hold
 *    counts and fixed labels only.
 *  - `createSignedGatewayProvider` is the live transport. It signs requests the
 *    way `src/lib/exports/requester-statement-private-transport.ts:25-33` does
 *    and reads nothing from the environment itself.
 *
 * Everything here is synthetic data. No case reads, writes or reasons about a
 * person's records. The plan touches only keys it creates itself.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Owner limits and fixed service constants
// ---------------------------------------------------------------------------

/** The owner's limits for the whole qualification, cleanup included. */
export const OWNER_LIMITS: QualificationLimits = Object.freeze({ operations: 2_500, storedBytes: 10_000_000 });
export const GATEWAY_PATH = "/private/case-archive/v1";
export const GATEWAY_PROTOCOL = "r2-current-object-qualified-all-writer-gateway-v1";
const RPC_VERSION = "case-archive-private-rpc-v1";
export const SMALL_PAYLOAD_BYTES = 1_024;
/** private-transport.ts:16 and requester-statement-r2-gateway.ts:72. */
export const MAXIMUM_PAYLOAD_BYTES = 4_000_000;
/** One byte over the transport's 6,000,000-byte body bound (private-transport.ts:36). */
export const OVERSIZED_REQUEST_BYTES = 6_000_001;
/**
 * Stored-bytes accounting adds this to every PUT the run sends, on top of the
 * body. The worker's own key and metadata are under 300 bytes
 * (requester-statement-r2-gateway.ts:77-80, 127-128); the allowance is a
 * conservative margin, not a provider billing rule.
 */
export const METADATA_ALLOWANCE_BYTES = 1_024;
/** The gateway permits another disposal attempt after a claim expires (gateway.ts:100-101). */
export const CLEANUP_ATTEMPTS = 2;
/** Below the gateway's 30-second claim bound (gateway.ts:98-99), leaving 10 s for clock skew. */
export const DEFAULT_CLAIM_TTL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 20_000;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * The only environment names a live run reads. They are the existing private
 * gateway settings (`.env.example:43-46`, docs/account-archive-complete-test-flow.md:22-24).
 * No repository document names a Cloudflare TEST token or R2 read key
 * variable, so none is read.
 */
export const LIVE_ENVIRONMENT_NAMES = [
  "INHERIT_TEST_STATEMENT_GATEWAY_URL",
  "INHERIT_TEST_STATEMENT_GATEWAY_KEY",
  "INHERIT_TEST_STATEMENT_R2_BUCKET",
  "INHERIT_TEST_STATEMENT_R2_BINDING_SHA256",
] as const;
export type LiveEnvironmentName = (typeof LIVE_ENVIRONMENT_NAMES)[number];

export type QualificationLimits = Readonly<{ operations: number; storedBytes: number }>;
/** Usage already spent by earlier attempts of the same qualification. */
export type PriorUsage = Readonly<{ operations: number; storedBytes: number }>;
export const NO_PRIOR_USAGE: PriorUsage = Object.freeze({ operations: 0, storedBytes: 0 });

/** A fixed refusal code, plus environment variable names where relevant. Never a value. */
export class QualificationRefusal extends Error {
  constructor(readonly code: string, readonly names: readonly string[] = []) {
    super(names.length ? `${code}: ${names.join(", ")}` : code);
    this.name = "QualificationRefusal";
  }
}

// ---------------------------------------------------------------------------
// Operation classes and the per-RPC cost read from the worker source
// ---------------------------------------------------------------------------

/**
 * R2 storage API operations by class. The gateway exposes PutObject (Class A),
 * HeadObject and GetObject (Class B) and DeleteObject, and nothing else
 * (`src/lib/exports/archive-r2-current-binding.ts:7-8`,
 * `src/lib/exports/archive-r2-current-fence.ts:82`). No list, multipart, copy,
 * version-history, lifecycle or storage-class operation can be expressed in
 * this plan, and the transport refuses those operation names (case Q07).
 * Delete is counted against the limit like every other operation.
 */
export type R2Operations = Readonly<{ classA: number; classB: number; delete: number }>;
const ops = (classA: number, classB: number, deleted: number): R2Operations => Object.freeze({ classA, classB, delete: deleted });
export const NO_OPERATIONS = ops(0, 0, 0);
export const totalOperations = (value: R2Operations) => value.classA + value.classB + value.delete;
const addOperations = (a: R2Operations, b: R2Operations) => ops(a.classA + b.classA, a.classB + b.classB, a.delete + b.delete);
const scaleOperations = (a: R2Operations, factor: number) => ops(a.classA * factor, a.classB * factor, a.delete * factor);

export const GATEWAY_OPERATIONS = ["describeConfiguration", "createPayload", "readPayload", "beginCleanup",
  "endCleanup", "head", "get", "putEmpty", "deleteCurrent"] as const;
export type GatewayOperation = (typeof GATEWAY_OPERATIONS)[number];

/**
 * The most R2 calls one RPC can make, read line by line from
 * workers/requester-statement-archive/src/requester-statement-r2-gateway.ts.
 * The transport itself makes none (private-transport.ts:25-72).
 */
export const RPC_WORST_CASE: Readonly<Record<GatewayOperation, R2Operations>> = Object.freeze({
  describeConfiguration: ops(0, 0, 0), // :46-47, configuration only
  createPayload: ops(1, 0, 0), // :77-80, one conditional put
  readPayload: ops(0, 1, 0), // :91, one get
  beginCleanup: ops(0, 0, 0), // :95-104, Durable Object storage only
  endCleanup: ops(0, 0, 0), // :105-111, Durable Object storage only
  head: ops(0, 1, 0), // :115
  get: ops(0, 1, 0), // :121
  putEmpty: ops(1, 0, 0), // :127-128
  deleteCurrent: ops(0, 3, 1), // :140 head, :146 delete, :147 and :148 heads
});

// ---------------------------------------------------------------------------
// The closed plan
// ---------------------------------------------------------------------------

type AllocationIndex = 0 | 1;
/** A claim label inside one case. `beginCleanup` mints a fresh claim under its label. */
export type ClaimLabel = "c1" | "c2" | "c3" | "k1" | "k2" | "unbegun" | "overlong";
export type CreateVariant = "valid" | "alternate" | "over-maximum" | "configuration-mismatch" | "bucket-mismatch"
  | "deadline-passed" | "length-mismatch" | "digest-mismatch" | "unbound-key" | "foreign-request-allocation";
export const PROBES = ["method-get", "path-other", "query-present", "content-type-text", "signature-missing",
  "signature-malformed", "signature-foreign-key", "body-altered", "expiry-overlong", "frame-expired", "issued-future",
  "nonce-replay", "body-oversized", "operation-list", "operation-delete", "operation-copy", "operation-multipart",
  "arguments-extra"] as const;
export type ProbeName = (typeof PROBES)[number];

export type QualificationStep =
  | Readonly<{ op: "probe"; alloc: AllocationIndex; probe: ProbeName; expect: "refused" | "accepted-then-refused" }>
  | Readonly<{ op: "describeConfiguration"; alloc: AllocationIndex; expect: "configuration" }>
  | Readonly<{ op: "createPayload"; alloc: AllocationIndex; variant: CreateVariant; expect: "created" | "refused" }>
  | Readonly<{ op: "createConcurrently"; alloc: AllocationIndex; expect: "one-created" }>
  | Readonly<{ op: "readPayload"; alloc: AllocationIndex; expect: "payload-body" | "refused" }>
  | Readonly<{ op: "beginCleanup"; alloc: AllocationIndex; claim: ClaimLabel; expect: "true" | "refused" }>
  | Readonly<{ op: "endCleanup"; alloc: AllocationIndex; claim: ClaimLabel; expect: "true" | "refused" }>
  | Readonly<{ op: "head"; alloc: AllocationIndex; claim: ClaimLabel; foreignKey?: true;
      expect: "payload" | "marker" | "absent" | "refused" | "any-current" }>
  | Readonly<{ op: "get"; alloc: AllocationIndex; claim: ClaimLabel; ifMatch: "payload" | "marker" | "stale";
      expect: "payload-body" | "marker-body" | "null" | "refused" }>
  | Readonly<{ op: "putEmpty"; alloc: AllocationIndex; claim: ClaimLabel;
      condition: "if-match-payload" | "if-match-stale" | "if-none-match"; expect: "marker" | "precondition-failed" | "refused" }>
  | Readonly<{ op: "deleteCurrent"; alloc: AllocationIndex; claim: ClaimLabel; marker: "marker" | "stale-etag" | "payload-identity";
      expect: "absent" | "mismatch-refused" | "refused" }>;

export type QualificationCase = Readonly<{
  id: string;
  name: string;
  requirement: string;
  /** `path:line` or `path:first-last`, relative to the repository root. */
  citations: readonly string[];
  allocations: 1 | 2;
  payloadBytes: number;
  steps: readonly QualificationStep[];
}>;

type StepOf<K extends QualificationStep["op"]> = Extract<QualificationStep, { op: K }>;

/** The step's exact R2 calls when its observed result is the expected one. */
export function stepCost(step: QualificationStep, observed: string = step.expect): R2Operations {
  switch (step.op) {
    case "probe": case "describeConfiguration": case "beginCleanup": case "endCleanup": return NO_OPERATIONS;
    case "createPayload": return observed === "created" ? ops(1, 0, 0) : NO_OPERATIONS; // refusals precede :77
    case "createConcurrently": return ops(1, 0, 0); // :66 serializes; the second sees writeStarted (:68)
    case "readPayload": return observed === "payload-body" ? ops(0, 1, 0) : NO_OPERATIONS; // refusal precedes :91
    case "head": return observed === "refused" ? NO_OPERATIONS : ops(0, 1, 0); // claim/key refusal precedes :115
    case "get": return observed === "refused" ? NO_OPERATIONS : ops(0, 1, 0); // a failed If-Match still calls :121
    case "putEmpty": return observed === "refused" ? NO_OPERATIONS : ops(1, 0, 0); // a failed condition still calls :127
    case "deleteCurrent": // :140 head always precedes the marker check at :141-145
      return observed === "absent" ? ops(0, 3, 1) : observed === "mismatch-refused" ? ops(0, 1, 0) : NO_OPERATIONS;
  }
}

/** The step's most R2 calls, whatever the service answers. */
export function stepWorstCost(step: QualificationStep): R2Operations {
  if (step.op === "probe") return NO_OPERATIONS; // every probe carries a describeConfiguration frame or none
  if (step.op === "createConcurrently") return scaleOperations(RPC_WORST_CASE.createPayload, 2);
  return RPC_WORST_CASE[step.op];
}

function createdBytes(step: StepOf<"createPayload">, payloadBytes: number): number {
  return step.variant === "over-maximum" ? MAXIMUM_PAYLOAD_BYTES + 1 : payloadBytes;
}

/** Bytes a step could leave stored if the service misbehaved, body plus metadata allowance. */
export function stepWorstStoredBytes(step: QualificationStep, payloadBytes: number): number {
  if (step.op === "createPayload") return createdBytes(step, payloadBytes) + METADATA_ALLOWANCE_BYTES;
  if (step.op === "createConcurrently") return 2 * (payloadBytes + METADATA_ALLOWANCE_BYTES);
  if (step.op === "putEmpty") return METADATA_ALLOWANCE_BYTES;
  return 0;
}

/** The allocation whose key a write step could store at. */
function writtenAllocation(step: QualificationStep): AllocationIndex | null {
  if (step.op === "createPayload") return step.variant === "unbound-key" ? 1 : step.alloc;
  if (step.op === "createConcurrently" || step.op === "putEmpty") return step.alloc;
  return null;
}

/**
 * The disposal sequence of `fenceR2CurrentReservation`
 * (src/lib/exports/archive-r2-current-fence.ts:175-199) followed by the
 * physical deletion door (src/lib/exports/requester-statement-r2-gateway.ts:67-87,
 * worker gateway :136-151): read the current object to EOF before mutating it,
 * re-check it, replace it conditionally with the empty marker, read the marker
 * to EOF twice, then delete it under a second claim, with the worker's two
 * absence checks.
 */
export function disposalSteps(alloc: AllocationIndex, from: "payload" | "absent" | "marker",
  first: ClaimLabel, second: ClaimLabel): QualificationStep[] {
  const steps: QualificationStep[] = [
    { op: "describeConfiguration", alloc, expect: "configuration" },
    { op: "beginCleanup", alloc, claim: first, expect: "true" },
    { op: "head", alloc, claim: first, expect: from },
  ];
  if (from === "payload") steps.push({ op: "get", alloc, claim: first, ifMatch: "payload", expect: "payload-body" },
    { op: "head", alloc, claim: first, expect: "payload" });
  if (from === "marker") steps.push({ op: "get", alloc, claim: first, ifMatch: "marker", expect: "marker-body" },
    { op: "head", alloc, claim: first, expect: "marker" });
  if (from !== "marker") steps.push({ op: "head", alloc, claim: first, expect: from },
    { op: "putEmpty", alloc, claim: first, condition: from === "payload" ? "if-match-payload" : "if-none-match", expect: "marker" });
  for (let read = 0; read < 2; read++) steps.push({ op: "get", alloc, claim: first, ifMatch: "marker", expect: "marker-body" },
    { op: "head", alloc, claim: first, expect: "marker" });
  steps.push({ op: "endCleanup", alloc, claim: first, expect: "true" },
    { op: "beginCleanup", alloc, claim: second, expect: "true" },
    { op: "deleteCurrent", alloc, claim: second, marker: "marker", expect: "absent" },
    { op: "endCleanup", alloc, claim: second, expect: "true" });
  return steps;
}

const T = "workers/requester-statement-archive/src/private-transport.ts";
const G = "workers/requester-statement-archive/src/requester-statement-r2-gateway.ts";
const SERVICE = "docs/requester-statement-archive-service.md";
const FLOW = "docs/account-archive-complete-test-flow.md";
const FENCE_DOC = "docs/account-archive-verified-fence-core.md";
const REGISTER = "docs/route-register.json";
const BINDING = "src/lib/exports/archive-r2-current-binding.ts";
const FENCE = "src/lib/exports/archive-r2-current-fence.ts";
const APP_GATEWAY = "src/lib/exports/requester-statement-r2-gateway.ts";
const APP_TRANSPORT = "src/lib/exports/requester-statement-private-transport.ts";

const probe = (p: ProbeName, expect: StepOf<"probe">["expect"] = "refused"): QualificationStep => ({ op: "probe", alloc: 0, probe: p, expect });
const create = (variant: CreateVariant, expect: StepOf<"createPayload">["expect"], alloc: AllocationIndex = 0): QualificationStep =>
  ({ op: "createPayload", alloc, variant, expect });
const read = (expect: StepOf<"readPayload">["expect"], alloc: AllocationIndex = 0): QualificationStep => ({ op: "readPayload", alloc, expect });
const begin = (claim: ClaimLabel, expect: StepOf<"beginCleanup">["expect"] = "true", alloc: AllocationIndex = 0): QualificationStep =>
  ({ op: "beginCleanup", alloc, claim, expect });
const end = (claim: ClaimLabel, expect: StepOf<"endCleanup">["expect"] = "true", alloc: AllocationIndex = 0): QualificationStep =>
  ({ op: "endCleanup", alloc, claim, expect });
const head = (claim: ClaimLabel, expect: StepOf<"head">["expect"], alloc: AllocationIndex = 0): QualificationStep =>
  ({ op: "head", alloc, claim, expect });

/** The closed plan. Order matters only for reading; every case uses fresh allocations. */
export const QUALIFICATION_CASES: readonly QualificationCase[] = Object.freeze([
  { id: "Q01", name: "configuration-matches", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The deployed gateway reports exactly the configured TEST bucket, binding digest and protocol.",
    citations: [`${SERVICE}:24-29`, `${REGISTER}:22082`, `${G}:46-47`, `${APP_GATEWAY}:37-40`],
    steps: [{ op: "describeConfiguration", alloc: 0, expect: "configuration" }] },
  { id: "Q02", name: "request-shape-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Only a signed JSON POST to the exact private path with no query reaches the gateway.",
    citations: [`${T}:29-31`, `${T}:24`, `${REGISTER}:22075`],
    steps: [probe("method-get"), probe("path-other"), probe("query-present"), probe("content-type-text"),
      probe("signature-missing"), probe("signature-malformed")] },
  { id: "Q03", name: "signature-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The HMAC-SHA256 signature covers the exact raw body under the one 32-byte service key.",
    citations: [`${T}:39-42`, `${REGISTER}:22075`, `${SERVICE}:40-41`],
    steps: [probe("signature-foreign-key"), probe("body-altered")] },
  { id: "Q04", name: "freshness-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A frame older than 20 s, issued in the future or valid for more than 15 s is refused.",
    citations: [`${T}:44-45`, `${REGISTER}:22075`, `${APP_TRANSPORT}:29-30`],
    steps: [probe("expiry-overlong"), probe("frame-expired"), probe("issued-future")] },
  { id: "Q05", name: "nonce-replay-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The durable per-allocation nonce admits a signed request once; a byte-identical replay is refused.",
    citations: [`${T}:46-47`, `${G}:24-31`, `${REGISTER}:22075`],
    steps: [probe("nonce-replay", "accepted-then-refused")] },
  { id: "Q06", name: "oversized-body-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A request body over 6,000,000 bytes is refused before signature or JSON handling.",
    citations: [`${T}:32-36`],
    steps: [probe("body-oversized")] },
  { id: "Q07", name: "closed-operation-set", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The service exposes no list, delete-by-name, copy or multipart operation, and refuses extra arguments.",
    citations: [`${T}:9-11`, `${T}:50`, `${BINDING}:7-8`, `${FENCE}:82`],
    steps: [probe("operation-list"), probe("operation-delete"), probe("operation-copy"), probe("operation-multipart"),
      probe("arguments-extra")] },
  { id: "Q08", name: "write-and-whole-readback", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A conditional create returns the exact owned-payload identity, and a whole read returns the same version, ETag, length and SHA-256.",
    citations: [`${FENCE_DOC}:40-41`, `${SERVICE}:43-44`, `${G}:63-94`, "src/lib/exports/account-archive-r2.ts:91-94",
      "src/lib/exports/requester-statement-r2-read.ts:48-52"],
    steps: [create("valid", "created"), read("payload-body")] },
  { id: "Q09", name: "maximum-object-readback", allocations: 1, payloadBytes: MAXIMUM_PAYLOAD_BYTES,
    requirement: "An object of exactly 4,000,000 bytes passes the transport bound and reads back whole.",
    citations: [`${T}:16`, `${T}:51`, `${T}:36`, `${G}:72`, "docs/async-export-delivery-core.md:11"],
    steps: [create("valid", "created"), read("payload-body")] },
  { id: "Q10", name: "over-maximum-refused", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "An object of 4,000,001 bytes is refused and nothing is stored.",
    citations: [`${T}:16`, `${G}:72`],
    steps: [create("over-maximum", "refused"), begin("c1"), head("c1", "absent"), end("c1")] },
  { id: "Q11", name: "admission-refused-before-put", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Each admission check refuses before the write is admitted, so a later valid create on the same allocation still succeeds.",
    citations: [`${G}:68-72`, `${G}:74-76`, `${G}:87`, `${SERVICE}:42-43`],
    steps: [read("refused"), create("configuration-mismatch", "refused"), create("bucket-mismatch", "refused"),
      create("deadline-passed", "refused"), create("length-mismatch", "refused"), create("digest-mismatch", "refused"),
      create("valid", "created"), read("payload-body")] },
  { id: "Q12", name: "allocation-binding-refused", allocations: 2, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A key outside its allocation digest, or a frame under another request allocation, is refused before any write.",
    citations: [`${G}:54-56`, `${G}:73`, `${T}:52`, `${T}:57`, `${FENCE}:45-47`, "src/lib/exports/account-archive-r2.ts:62"],
    steps: [create("unbound-key", "refused"), create("foreign-request-allocation", "refused"),
      begin("c1"), { op: "head", alloc: 0, claim: "c1", foreignKey: true, expect: "refused" }, head("c1", "absent"), end("c1"),
      begin("c1", "true", 1), head("c1", "absent", 1), end("c1", "true", 1)] },
  { id: "Q13", name: "one-payload-per-allocation", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The gateway admits one payload write per allocation; a second create is refused and the first bytes remain.",
    citations: [`${SERVICE}:42-43`, `${G}:68`, `${G}:74-76`],
    steps: [create("valid", "created"), create("alternate", "refused"), read("payload-body")] },
  { id: "Q14", name: "concurrent-writers-excluded", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Two concurrent creates for one allocation produce exactly one write.",
    citations: [`${SERVICE}:30-31`, `${G}:18-19`, `${G}:66-76`, `${FENCE}:73-74`],
    steps: [{ op: "createConcurrently", alloc: 0, expect: "one-created" }, read("payload-body")] },
  { id: "Q15", name: "unwritten-allocation-fenced", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "An allocation with no current object is fenced with a conditional empty marker, deleted, and still refuses a later create.",
    citations: [`${BINDING}:90-91`, `${G}:74-75`, `${G}:68`, `${G}:100-102`, `${FLOW}:71-72`],
    steps: [...disposalSteps(0, "absent", "c1", "c2"), create("valid", "refused"), begin("c3"), head("c3", "absent"), end("c3")] },
  { id: "Q16", name: "terminal-fence-blocks-writes", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Once cleanup begins, payload reads and creates are refused, and stay refused after the claim is released.",
    citations: [`${G}:68`, `${G}:87`, `${G}:100-102`, `${G}:105-111`, `${SERVICE}:42-44`, `${FENCE_DOC}:41-42`],
    steps: [create("valid", "created"), begin("c1"), read("refused"), create("alternate", "refused"), end("c1"),
      read("refused"), create("alternate", "refused")] },
  { id: "Q17", name: "claim-discipline", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Provider reads, writes and deletion need the current terminal claim; overlong, overlapping, foreign and released claims are refused.",
    citations: [`${G}:58-62`, `${G}:95-111`, `${APP_GATEWAY}:48-57`, `${FENCE}:73-74`],
    steps: [create("valid", "created"), head("unbegun", "refused"),
      { op: "get", alloc: 0, claim: "unbegun", ifMatch: "payload", expect: "refused" },
      { op: "putEmpty", alloc: 0, claim: "unbegun", condition: "if-match-payload", expect: "refused" },
      { op: "deleteCurrent", alloc: 0, claim: "unbegun", marker: "payload-identity", expect: "refused" },
      begin("overlong", "refused"), begin("c1"), begin("c2", "refused"), head("c2", "refused"), end("c2", "refused"),
      end("c1"), head("c1", "refused")] },
  { id: "Q18", name: "conditional-read", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A read conditioned on a stale ETag returns no body; one on the current ETag returns the whole object.",
    citations: [`${BINDING}:59-66`, `${G}:118-123`, `${T}:64-65`, `${FENCE_DOC}:42-43`],
    steps: [create("valid", "created"), begin("c1"),
      { op: "get", alloc: 0, claim: "c1", ifMatch: "stale", expect: "null" },
      { op: "get", alloc: 0, claim: "c1", ifMatch: "payload", expect: "payload-body" }, end("c1")] },
  { id: "Q19", name: "conditional-replacement-stale-etag", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A marker replacement conditioned on a stale ETag is refused and the payload is unchanged.",
    citations: [`${BINDING}:83-99`, `${FENCE}:183-186`, `${SERVICE}:30-31`, `${FENCE_DOC}:41`],
    steps: [create("valid", "created"), begin("c1"), head("c1", "payload"),
      { op: "putEmpty", alloc: 0, claim: "c1", condition: "if-match-stale", expect: "precondition-failed" },
      head("c1", "payload"), end("c1")] },
  { id: "Q20", name: "conditional-absence-existing-object", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "A write conditioned on absence is refused while an object exists, and the payload is unchanged.",
    citations: [`${BINDING}:90-91`, `${G}:77-78`, `${SERVICE}:30-31`],
    steps: [create("valid", "created"), begin("c1"),
      { op: "putEmpty", alloc: 0, claim: "c1", condition: "if-none-match", expect: "precondition-failed" },
      head("c1", "payload"), end("c1")] },
  { id: "Q21", name: "deletion-refuses-payload", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The deletion door refuses a current payload; only a current empty marker can be deleted.",
    citations: [`${G}:132-145`, `${FLOW}:71-72`, "src/lib/exports/account-archive-r2.ts:103-106"],
    steps: [create("valid", "created"), begin("c1"),
      { op: "deleteCurrent", alloc: 0, claim: "c1", marker: "payload-identity", expect: "mismatch-refused" },
      head("c1", "payload"), end("c1")] },
  { id: "Q22", name: "deletion-refuses-stale-marker", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "The deletion door refuses a marker identity whose ETag is not the current one, and the marker remains.",
    citations: [`${G}:141-145`, `${FLOW}:71-72`],
    steps: [create("valid", "created"), begin("c1"), head("c1", "payload"),
      { op: "putEmpty", alloc: 0, claim: "c1", condition: "if-match-payload", expect: "marker" },
      { op: "deleteCurrent", alloc: 0, claim: "c1", marker: "stale-etag", expect: "mismatch-refused" },
      head("c1", "marker"), end("c1")] },
  { id: "Q23", name: "full-disposal-and-terminal-retention", allocations: 1, payloadBytes: SMALL_PAYLOAD_BYTES,
    requirement: "Verified payload and marker EOF, conditional current-object deletion and two absence checks; the terminal fact then refuses every later create and read.",
    citations: [`${FLOW}:67-74`, `${G}:132-151`, `${APP_GATEWAY}:67-87`, `${SERVICE}:43-44`, `${G}:39`,
      "docs/protocol/decisions.md:4641-4642"],
    steps: [create("valid", "created"), read("payload-body"), ...disposalSteps(0, "payload", "c1", "c2"),
      create("alternate", "refused"), read("refused"), begin("c3"), head("c3", "absent"),
      { op: "get", alloc: 0, claim: "c3", ifMatch: "marker", expect: "null" },
      { op: "deleteCurrent", alloc: 0, claim: "c3", marker: "marker", expect: "mismatch-refused" }, end("c3")] },
] satisfies QualificationCase[]);

/** Required evidence this caller cannot produce, each with its source. */
export const QUALIFICATION_EXCLUSIONS = Object.freeze([
  { id: "native-disposal-ack", reason: "Durable native ACKs and the persistent TEST database are outside the storage service.",
    citations: [`${SERVICE}:30-32`, `${SERVICE}:43-44`, `${FLOW}:7-24`] },
  { id: "logs-and-platform-copies", reason: "Isolated logs, platform copies, strings, CryptoKey, swap and provider copies are not observable through the gateway.",
    citations: [`${SERVICE}:30-32`, `${SERVICE}:46-50`, `${T}:74-76`, `${REGISTER}:22083`] },
  { id: "provider-history", reason: "The protocol is current-object only; history and platform-copy erasure are separately qualified policy.",
    citations: [`${FLOW}:72-74`, `${FENCE}:82`, "docs/protocol/decisions.md:4642"] },
  { id: "version-list-proof", reason: "The version-list/delete/second-list proof belongs to the separate permanent-fence provider contract, which this R2 protocol deliberately does not implement.",
    citations: [`${FENCE_DOC}:40-43`, `${FENCE}:82`, `${BINDING}:7-8`] },
  { id: "restart-durability", reason: "A caller cannot force a Durable Object restart to show the terminal fact survives one.",
    citations: [`${G}:74-75`, `${G}:132-135`] },
  { id: "create-versus-cleanup-race", reason: "The order of a create racing a cleanup claim is chosen by the platform, so its R2 calls are not fixed in advance.",
    citations: [`${FENCE}:183-184`] },
  { id: "closed-default", reason: "The disabled default answers only when CASE_ARCHIVE_TEST_ENABLED is not 1; a qualification target has it enabled.",
    citations: [`${T}:30`, "workers/requester-statement-archive/wrangler.json:11-13"] },
  { id: "lifecycle-and-marker-expiry", reason: "Bucket lifecycle rules are not visible through the gateway and need the owner's account access, for which no variable is named.",
    citations: [`${G}:18-19`, `${FENCE}:70-71`] },
]);

// ---------------------------------------------------------------------------
// Expected-state simulation and the budget proof
// ---------------------------------------------------------------------------

type ObjectState = "absent" | "payload" | "marker";

export type CaseBudget = Readonly<{
  id: string; name: string;
  /** Exact R2 calls when every step and cleanup answers as expected. */
  expected: R2Operations; expectedTotal: number;
  expectedCleanup: R2Operations;
  /** Exact peak of stored body bytes when every answer is expected. */
  expectedPeakStoredBytes: number;
  expectedGatewayRequests: number;
  worstBody: R2Operations; worstCleanup: R2Operations; worstTotal: number;
  worstStoredBytes: number;
  writtenAllocations: number;
}>;

export type BudgetProof = Readonly<{
  limits: QualificationLimits; prior: PriorUsage; cases: readonly CaseBudget[];
  expected: R2Operations; expectedTotal: number; expectedGatewayRequests: number;
  expectedPeakStoredBytes: number;
  worst: R2Operations; worstTotal: number; worstStoredBytes: number;
  operationsHeadroom: number; storedBytesHeadroom: number;
}>;

const sumCost = (steps: readonly QualificationStep[], cost: (s: QualificationStep) => R2Operations) =>
  steps.reduce((sum, s) => addOperations(sum, cost(s)), NO_OPERATIONS);
const requestCount = (s: QualificationStep) => s.op === "createConcurrently" || (s.op === "probe" && s.probe === "nonce-replay") ? 2 : 1;

/** The worst single cleanup attempt: release, configuration, claim and head, then the costliest fence path. */
export function worstCleanupAttempt(): R2Operations {
  const paths = (["payload", "marker"] as const).map(from => sumCost(disposalSteps(0, from, "k1", "k2"), stepWorstCost));
  const verifiedAbsent = sumCost([{ op: "describeConfiguration", alloc: 0, expect: "configuration" }, begin("k1"),
    head("k1", "any-current"), end("k1")], stepWorstCost);
  return [...paths, verifiedAbsent].reduce((a, b) => totalOperations(b) > totalOperations(a) ? b : a);
}

function validateCase(plan: QualificationCase) {
  if (!/^Q\d{2}$/u.test(plan.id) || !plan.citations.length || !plan.steps.length
    || !Number.isSafeInteger(plan.payloadBytes) || plan.payloadBytes < 1 || plan.payloadBytes > MAXIMUM_PAYLOAD_BYTES)
    throw new QualificationRefusal("plan_case_refused", [plan.id]);
  for (const step of plan.steps) {
    const known = step.op === "probe" ? (PROBES as readonly string[]).includes(step.probe)
      : step.op === "createConcurrently" || (GATEWAY_OPERATIONS as readonly string[]).includes(step.op);
    const usesSecond = (step.op === "head" && step.foreignKey) || (step.op === "createPayload"
      && (step.variant === "unbound-key" || step.variant === "foreign-request-allocation"));
    const indices = [step.alloc, writtenAllocation(step) ?? 0, usesSecond ? 1 : 0];
    if (!known || indices.some(index => index >= plan.allocations) || step.expect === "any-current")
      throw new QualificationRefusal("plan_step_refused", [plan.id]);
  }
}

/** Pure: simulates one case under expected answers and bounds it under the worst. */
export function budgetCase(plan: QualificationCase): CaseBudget {
  validateCase(plan);
  const state: ObjectState[] = Array.from({ length: plan.allocations }, () => "absent");
  const size = () => state.reduce((sum, s) => sum + (s === "payload" ? plan.payloadBytes : 0), 0);
  let peak = 0;
  const apply = (step: QualificationStep) => {
    const target = writtenAllocation(step);
    if (target !== null && (step.expect === "created" || step.expect === "one-created")) state[target] = "payload";
    if (step.op === "putEmpty" && step.expect === "marker") state[step.alloc] = "marker";
    if (step.op === "deleteCurrent" && step.expect === "absent") state[step.alloc] = "absent";
    peak = Math.max(peak, size());
  };
  plan.steps.forEach(apply);
  const cleanupSteps = state.flatMap((s, alloc) => s === "absent" ? [] : disposalSteps(alloc as AllocationIndex, s, "k1", "k2"));
  cleanupSteps.forEach(apply);
  const written = new Set(plan.steps.map(writtenAllocation).filter((x): x is AllocationIndex => x !== null));
  const expectedBody = sumCost(plan.steps, s => stepCost(s)), expectedCleanup = sumCost(cleanupSteps, s => stepCost(s));
  const expected = addOperations(expectedBody, expectedCleanup);
  const worstBody = sumCost(plan.steps, stepWorstCost);
  const worstCleanup = scaleOperations(worstCleanupAttempt(), CLEANUP_ATTEMPTS * written.size);
  const worstStoredBytes = plan.steps.reduce((sum, s) => sum + stepWorstStoredBytes(s, plan.payloadBytes), 0)
    + written.size * CLEANUP_ATTEMPTS * METADATA_ALLOWANCE_BYTES;
  return Object.freeze({ id: plan.id, name: plan.name, expected, expectedTotal: totalOperations(expected), expectedCleanup,
    expectedPeakStoredBytes: peak,
    expectedGatewayRequests: [...plan.steps, ...cleanupSteps].reduce((sum, s) => sum + requestCount(s), 0),
    worstBody, worstCleanup, worstTotal: totalOperations(worstBody) + totalOperations(worstCleanup), worstStoredBytes,
    writtenAllocations: written.size });
}

function validLimits(limits: QualificationLimits, prior: PriorUsage) {
  const counts = [limits.operations, limits.storedBytes, prior.operations, prior.storedBytes];
  if (!counts.every(n => Number.isSafeInteger(n) && n >= 0)
    || limits.operations > OWNER_LIMITS.operations || limits.storedBytes > OWNER_LIMITS.storedBytes)
    throw new QualificationRefusal("budget_limits_refused");
}

/**
 * Proves, before any request, that the whole plan fits: prior usage plus every
 * case's worst body and every cleanup attempt stays within the operation limit,
 * and prior stored bytes plus every byte the plan could ever write stays within
 * the stored-bytes limit, even if no deletion ever freed a byte.
 */
export function proveQualificationBudget(cases: readonly QualificationCase[] = QUALIFICATION_CASES,
  limits: QualificationLimits = OWNER_LIMITS, prior: PriorUsage = NO_PRIOR_USAGE): BudgetProof {
  validLimits(limits, prior);
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new QualificationRefusal("plan_case_refused");
  const budgets = cases.map(budgetCase);
  const expected = budgets.reduce((sum, b) => addOperations(sum, b.expected), NO_OPERATIONS);
  const worst = budgets.reduce((sum, b) => addOperations(sum, addOperations(b.worstBody, b.worstCleanup)), NO_OPERATIONS);
  const worstStoredBytes = budgets.reduce((sum, b) => sum + b.worstStoredBytes, 0);
  if (prior.operations + totalOperations(worst) > limits.operations) throw new QualificationRefusal("budget_plan_operations_refused");
  if (prior.storedBytes + worstStoredBytes > limits.storedBytes) throw new QualificationRefusal("budget_plan_stored_bytes_refused");
  return Object.freeze({ limits, prior, cases: Object.freeze(budgets), expected, expectedTotal: totalOperations(expected),
    expectedGatewayRequests: budgets.reduce((sum, b) => sum + b.expectedGatewayRequests, 0),
    expectedPeakStoredBytes: Math.max(...budgets.map(b => b.expectedPeakStoredBytes)),
    worst, worstTotal: totalOperations(worst), worstStoredBytes,
    operationsHeadroom: limits.operations - prior.operations - totalOperations(worst),
    storedBytesHeadroom: limits.storedBytes - prior.storedBytes - worstStoredBytes });
}

// ---------------------------------------------------------------------------
// The run-time ledger
// ---------------------------------------------------------------------------

export type LedgerPhase = "body" | "cleanup";
export type LedgerSnapshot = Readonly<{
  debited: R2Operations; debitedTotal: number; priorOperations: number;
  reservedBody: number; reservedCleanup: number; inflight: number;
  storedBytesBound: number; reservedStoredBytes: number; openCase: string | null;
}>;
export type QualificationLedger = Readonly<{
  openCase(id: string, reservation: Readonly<{ body: number; cleanup: number; storedBytes: number }>): void;
  authorize(phase: LedgerPhase, worst: R2Operations, storedBytes: number): void;
  settle(actual: R2Operations): void;
  closeBody(): void;
  closeCase(): void;
  snapshot(): LedgerSnapshot;
}>;

/**
 * Enforces the limits during a run. Stored bytes only ever grow: a deletion
 * never returns budget, so the bound holds even if a deleted object were
 * retained somewhere the gateway cannot see.
 */
export function createQualificationLedger(limits: QualificationLimits = OWNER_LIMITS,
  prior: PriorUsage = NO_PRIOR_USAGE): QualificationLedger {
  validLimits(limits, prior);
  let debited = NO_OPERATIONS, storedBound = prior.storedBytes;
  let open: { id: string; body: number; cleanup: number; stored: number; bodyOpen: boolean } | null = null;
  let inflight: { phase: LedgerPhase; worst: R2Operations } | null = null;
  const committed = () => prior.operations + totalOperations(debited);
  const refuse = (code: string): never => { throw new QualificationRefusal(code); };
  const invariant = () => {
    const reserved = (open ? open.body + open.cleanup : 0) + (inflight ? totalOperations(inflight.worst) : 0);
    if (committed() + reserved > limits.operations || storedBound + (open?.stored ?? 0) > limits.storedBytes)
      refuse("ledger_invariant_refused");
  };
  return Object.freeze({
    openCase(id, reservation) {
      if (open || inflight) refuse("ledger_case_already_open");
      const amounts = [reservation.body, reservation.cleanup, reservation.storedBytes];
      if (!amounts.every(n => Number.isSafeInteger(n) && n >= 0)) refuse("ledger_reservation_refused");
      if (committed() + reservation.body + reservation.cleanup > limits.operations) refuse("budget_case_operations_refused");
      if (storedBound + reservation.storedBytes > limits.storedBytes) refuse("budget_case_stored_bytes_refused");
      open = { id, body: reservation.body, cleanup: reservation.cleanup, stored: reservation.storedBytes, bodyOpen: true };
      invariant();
    },
    authorize(phase, worst, storedBytes) {
      if (!open || inflight || (phase === "body" && !open.bodyOpen)) refuse("ledger_dispatch_refused");
      const need = totalOperations(worst), pool = phase === "body" ? open!.body : open!.cleanup;
      if (need > pool) refuse(phase === "body" ? "ledger_body_reservation_exhausted" : "ledger_cleanup_reservation_exhausted");
      if (storedBytes > open!.stored) refuse("ledger_stored_bytes_reservation_exhausted");
      if (phase === "body") open!.body -= need; else open!.cleanup -= need;
      open!.stored -= storedBytes; storedBound += storedBytes;
      inflight = { phase, worst };
      invariant();
    },
    settle(actual) {
      if (!open || !inflight) refuse("ledger_settle_refused");
      const { phase, worst } = inflight!;
      if (actual.classA > worst.classA || actual.classB > worst.classB || actual.delete > worst.delete
        || [actual.classA, actual.classB, actual.delete].some(n => !Number.isSafeInteger(n) || n < 0)) refuse("ledger_settle_exceeds_authorization");
      debited = addOperations(debited, actual);
      const unused = totalOperations(worst) - totalOperations(actual);
      if (phase === "body") open!.body += unused; else open!.cleanup += unused;
      inflight = null;
      invariant();
    },
    closeBody() { if (!open || inflight) refuse("ledger_close_refused"); open!.body = 0; open!.bodyOpen = false; },
    closeCase() { if (!open || inflight) refuse("ledger_close_refused"); open = null; },
    snapshot() {
      return Object.freeze({ debited, debitedTotal: totalOperations(debited), priorOperations: prior.operations,
        reservedBody: open?.body ?? 0, reservedCleanup: open?.cleanup ?? 0, inflight: inflight ? totalOperations(inflight.worst) : 0,
        storedBytesBound: storedBound, reservedStoredBytes: open?.stored ?? 0, openCase: open?.id ?? null });
    },
  });
}

// ---------------------------------------------------------------------------
// Provider interface and the live signed transport
// ---------------------------------------------------------------------------

/** One gateway answer, reduced to what qualification needs. Bodies are hashed, never kept. */
export type GatewayOutcome =
  | Readonly<{ kind: "json"; value: unknown }>
  | Readonly<{ kind: "body"; descriptor: unknown; byteLength: number; sha256: string }>
  | Readonly<{ kind: "null" }>
  | Readonly<{ kind: "refused" }>
  | Readonly<{ kind: "uncertain"; reason: string }>;

export type QualificationProvider = Readonly<{
  call(allocationSha256: string, operation: GatewayOperation, args: readonly unknown[]): Promise<GatewayOutcome>;
  probe(probe: ProbeName, allocationSha256: string): Promise<readonly GatewayOutcome[]>;
}>;

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

const uncertain = (reason: string): GatewayOutcome => Object.freeze({ kind: "uncertain", reason });

async function cancelBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* already closed */ }
}

async function boundedText(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) return null;
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a whole object body to EOF, refusing empty chunks and anything past the bound. */
async function hashedBody(response: Response): Promise<{ byteLength: number; sha256: string } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const hash = createHash("sha256"); let byteLength = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || !next.value.byteLength) return null; // requester-statement-r2-read.ts:48
      byteLength += next.value.byteLength;
      if (byteLength > MAXIMUM_PAYLOAD_BYTES) return null;
      hash.update(next.value); next.value.fill(0);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { byteLength, sha256: hash.digest("hex") };
}

async function classifyResponse(response: Response, bodyOperation: boolean): Promise<GatewayOutcome> {
  if (response.status === 404) {
    // The worker's only refusal (private-transport.ts:24). Any other 404 did not come from it.
    const text = await boundedText(response, 64);
    return text === "Unavailable" ? Object.freeze({ kind: "refused" }) : uncertain("refusal_shape");
  }
  if (response.status !== 200) { await cancelBody(response); return uncertain("status"); }
  if (bodyOperation) {
    if (response.headers.get("X-Case-Archive-Null") === "1") { await cancelBody(response); return Object.freeze({ kind: "null" }); }
    const encoded = response.headers.get("X-Case-Archive-Descriptor");
    if (!encoded || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) { await cancelBody(response); return uncertain("descriptor"); }
    let descriptor: unknown;
    try { descriptor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
    catch { await cancelBody(response); return uncertain("descriptor"); }
    const body = await hashedBody(response);
    return body ? Object.freeze({ kind: "body", descriptor, ...body }) : uncertain("body");
  }
  if (response.headers.get("Content-Type") !== "application/json") { await cancelBody(response); return uncertain("content_type"); }
  const text = await boundedText(response, 8192);
  if (text === null) return uncertain("json_size");
  try { return Object.freeze({ kind: "json", value: JSON.parse(text) as unknown }); } catch { return uncertain("json"); }
}

/**
 * The live provider. `url` and `key` come from `selectQualificationMode`; this
 * function itself reads no environment variable. The caller owns `key` and
 * clears it after the run. Requests mirror
 * src/lib/exports/requester-statement-private-transport.ts:25-33.
 */
export function createSignedGatewayProvider(options: { url: URL; key: Uint8Array; fetch?: FetchLike;
  timeoutMs?: number; now?: () => number }): QualificationProvider {
  if (options.key.byteLength !== 32 || options.url.protocol !== "https:" || options.url.pathname !== GATEWAY_PATH
    || options.url.search || options.url.hash || options.url.username || options.url.password)
    throw new QualificationRefusal("provider_configuration_refused");
  const url = new URL(options.url.href), key = options.key;
  const send = options.fetch ?? ((input: URL, init: RequestInit) => fetch(input, init));
  const now = options.now ?? Date.now, timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  function frame(allocationSha256: string, operation: string, args: readonly unknown[], issuedAt = now(), expiresAt = issuedAt + 15_000) {
    return JSON.stringify({ version: RPC_VERSION, allocationSha256, operation, args,
      nonce: randomBytes(32).toString("hex"), issuedAt, expiresAt });
  }
  const sign = (raw: string, signingKey: Uint8Array = key) => createHmac("sha256", signingKey).update(raw).digest("base64url");
  async function post(target: URL, raw: string, headers: Record<string, string>, bodyOperation = false): Promise<GatewayOutcome> {
    let response: Response;
    try {
      response = await send(target, { method: "POST", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs), headers, body: raw });
    } catch { return uncertain("transport"); }
    try { return await classifyResponse(response, bodyOperation); } catch { return uncertain("response"); }
  }
  const signedHeaders = (raw: string, signingKey?: Uint8Array) =>
    ({ "Content-Type": "application/json", "X-Case-Archive-Signature": sign(raw, signingKey) });

  return Object.freeze({
    async call(allocationSha256, operation, args) {
      const raw = frame(allocationSha256, operation, args);
      return post(url, raw, signedHeaders(raw), operation === "readPayload" || operation === "get");
    },
    async probe(name, allocationSha256) {
      const raw = frame(allocationSha256, "describeConfiguration", []);
      const at = (change: (target: URL) => void) => { const target = new URL(url.href); change(target); return target; };
      switch (name) {
        case "method-get": {
          try {
            const response = await send(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
            return [await classifyResponse(response, false)];
          } catch { return [uncertain("transport")]; }
        }
        case "path-other": return [await post(at(t => { t.pathname = "/private/case-archive/v2"; }), raw, signedHeaders(raw))];
        case "query-present": return [await post(at(t => { t.search = "?probe=1"; }), raw, signedHeaders(raw))];
        case "content-type-text": return [await post(url, raw, { ...signedHeaders(raw), "Content-Type": "text/plain" })];
        case "signature-missing": return [await post(url, raw, { "Content-Type": "application/json" })];
        case "signature-malformed": return [await post(url, raw, { "Content-Type": "application/json", "X-Case-Archive-Signature": "malformed-signature" })];
        case "signature-foreign-key": return [await post(url, raw, signedHeaders(raw, randomBytes(32)))];
        case "body-altered": {
          const altered = raw.replace(/"nonce":"([0-9a-f]{63})([0-9a-f])"/u, (_, a: string, b: string) => `"nonce":"${a}${b === "0" ? "1" : "0"}"`);
          return altered === raw ? [uncertain("probe")] : [await post(url, altered, signedHeaders(raw))];
        }
        case "expiry-overlong": { const t = now(), f = frame(allocationSha256, "describeConfiguration", [], t, t + 60_000); return [await post(url, f, signedHeaders(f))]; }
        case "frame-expired": { const t = now() - 120_000, f = frame(allocationSha256, "describeConfiguration", [], t, t + 15_000); return [await post(url, f, signedHeaders(f))]; }
        case "issued-future": { const t = now() + 120_000, f = frame(allocationSha256, "describeConfiguration", [], t, t + 10_000); return [await post(url, f, signedHeaders(f))]; }
        case "nonce-replay": { const headers = signedHeaders(raw); return [await post(url, raw, headers), await post(url, raw, headers)]; }
        case "body-oversized": {
          // Whitespace after valid JSON: even if the size bound were missing, this frame could only describe configuration.
          const padded = raw + " ".repeat(OVERSIZED_REQUEST_BYTES - Buffer.byteLength(raw));
          return [await post(url, padded, signedHeaders(padded))];
        }
        case "operation-list": case "operation-delete": case "operation-copy": case "operation-multipart": {
          const operation = { "operation-list": "list", "operation-delete": "delete", "operation-copy": "copy",
            "operation-multipart": "createMultipartUpload" }[name];
          const f = frame(allocationSha256, operation, []); return [await post(url, f, signedHeaders(f))];
        }
        case "arguments-extra": { const f = frame(allocationSha256, "describeConfiguration", [0]); return [await post(url, f, signedHeaders(f))]; }
      }
    },
  });
}

// ---------------------------------------------------------------------------
// The runner and its receipts
// ---------------------------------------------------------------------------

export type GatewayConfiguration = Readonly<{ bucket: string; bindingSha256: string }>;
type Claim = { allocationSha256: string; token: string; expiresAt: number };
const providerId = z.string().regex(/^[A-Za-z0-9._-]{1,256}$/u);
const descriptorSchema = z.object({ key: z.string(), version: providerId, etag: providerId,
  size: z.number().int().nonnegative().max(MAXIMUM_PAYLOAD_BYTES), customMetadata: z.record(z.string(), z.string()) }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;

type Allocation = {
  key: string; allocationSha256: string; exportId: string; attemptId: string; objectId: string;
  principal: string; receipt: string; writeBinding: string;
  payload: Uint8Array; alternate: Uint8Array;
  payloadRecord?: { descriptor: Descriptor; sha256?: string };
  markerRecord?: Descriptor;
  claims: Map<ClaimLabel, Claim>; held: Set<ClaimLabel>;
  written: boolean; worstStoredBytes: number; verifiedAbsent: boolean;
};

export type StepReceipt = Readonly<{ ordinal: number; phase: LedgerPhase; operation: string; expected: string;
  observed: string; operations: R2Operations }>;
export type CaseStatus = "passed" | "unexpected" | "cleanup-incomplete" | "not-started" | "refused-by-budget";
export type CaseReceipt = {
  id: string; name: string; status: CaseStatus;
  plannedOperations: R2Operations; debitedOperations: R2Operations;
  reservedOperations: number; expectedPeakStoredBytes: number;
  allocations: number; cleanedAllocations: number; outstandingAllocations: number; cleanupAttempts: number;
  steps: StepReceipt[];
};
export type QualificationReceipt = {
  version: "requester-statement-archive-qualification-receipt-v1";
  target: "private-test-statement-archive-gateway";
  evidenceScope: string;
  startedAt: string; endedAt: string | null;
  status: "RUNNING" | "PASS" | "STOPPED" | "CLEANUP_INCOMPLETE" | "REFUSED";
  limits: QualificationLimits; prior: PriorUsage;
  proof: Readonly<{ cases: number; expectedOperations: R2Operations; expectedTotal: number; worstTotal: number;
    worstStoredBytes: number; expectedPeakStoredBytes: number; expectedGatewayRequests: number }>;
  cases: CaseReceipt[];
  ledger: Readonly<{ debited: R2Operations; debitedTotal: number; storedBytesBound: number }>;
  gatewayRequests: number;
  possiblyStoredBytesAtEnd: number;
  outstandingAllocations: number;
  excluded: readonly string[];
};
export type QualificationResult = Readonly<{ receipt: QualificationReceipt; outstandingObjectKeys: readonly string[] }>;

export type RunOptions = Readonly<{
  provider: QualificationProvider;
  configuration: GatewayConfiguration;
  cases?: readonly QualificationCase[];
  limits?: QualificationLimits;
  prior?: PriorUsage;
  ledger?: QualificationLedger;
  claimTtlMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Called after each case with that case's receipt and the whole receipt so far. */
  onCase?: (caseReceipt: CaseReceipt, receipt: QualificationReceipt) => void;
  /** Called before every request with the step about to be sent. */
  onDispatch?: (step: QualificationStep, phase: LedgerPhase, caseId: string) => void;
}>;

const sha256Hex = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export function allocationDigest(bucket: string, objectKey: string): string {
  // Identical to r2AllocationDigest (src/lib/exports/archive-r2-current-fence.ts:45-47).
  return sha256Hex(`inherit-export-r2-allocation-v1\n${bucket}\n${objectKey}`);
}
/** Synthetic bytes: a fixed arithmetic pattern, distinct per seed. */
export function syntheticBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + seed * 97 + (i >>> 8)) & 0xff;
  return bytes;
}
const hex32 = () => randomBytes(32).toString("hex");

function otherBucket(bucket: string) {
  return bucket === "inherit-export-qualification-elsewhere" ? "inherit-export-qualification-elsewhere-2" : "inherit-export-qualification-elsewhere";
}

export async function runQualification(options: RunOptions): Promise<QualificationResult> {
  const cases = options.cases ?? QUALIFICATION_CASES, limits = options.limits ?? OWNER_LIMITS;
  const prior = options.prior ?? NO_PRIOR_USAGE;
  const configuration = options.configuration;
  if (!/^inherit-export-[a-z0-9-]{1,40}$/u.test(configuration.bucket) || !/^[0-9a-f]{64}$/u.test(configuration.bindingSha256))
    throw new QualificationRefusal("configuration_refused");
  // Refuses before any request if the whole plan cannot fit.
  const proof = proveQualificationBudget(cases, limits, prior);
  const ledger = options.ledger ?? createQualificationLedger(limits, prior);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs < 1_000 || claimTtlMs > DEFAULT_CLAIM_TTL_MS) throw new QualificationRefusal("claim_ttl_refused");
  const provider = options.provider;
  const outstandingObjectKeys: string[] = [];
  const receipt: QualificationReceipt = {
    version: "requester-statement-archive-qualification-receipt-v1", target: "private-test-statement-archive-gateway",
    evidenceScope: "Provider operations through the private gateway only: no native database, browser, logs, platform copies or provider history.",
    startedAt: new Date(now()).toISOString(), endedAt: null, status: "RUNNING", limits, prior,
    proof: Object.freeze({ cases: proof.cases.length, expectedOperations: proof.expected, expectedTotal: proof.expectedTotal,
      worstTotal: proof.worstTotal, worstStoredBytes: proof.worstStoredBytes, expectedPeakStoredBytes: proof.expectedPeakStoredBytes,
      expectedGatewayRequests: proof.expectedGatewayRequests }),
    cases: [], ledger: { debited: NO_OPERATIONS, debitedTotal: 0, storedBytesBound: prior.storedBytes },
    gatewayRequests: 0, possiblyStoredBytesAtEnd: 0, outstandingAllocations: 0,
    excluded: QUALIFICATION_EXCLUSIONS.map(e => e.id),
  };
  // This run's own unproved bytes only, so that chained prior receipts never count a byte twice.
  let possiblyStored = 0;
  const syncLedger = () => {
    const s = ledger.snapshot();
    receipt.ledger = Object.freeze({ debited: s.debited, debitedTotal: s.debitedTotal, storedBytesBound: s.storedBytesBound });
  };
  let stopped = false, cleanupIncomplete = false, budgetRefused = false;

  for (const [index, plan] of cases.entries()) {
    const budget = proof.cases[index];
    const caseReceipt: CaseReceipt = { id: plan.id, name: plan.name, status: "not-started", plannedOperations: budget.expected,
      debitedOperations: NO_OPERATIONS, reservedOperations: budget.worstTotal, expectedPeakStoredBytes: budget.expectedPeakStoredBytes,
      allocations: plan.allocations, cleanedAllocations: 0, outstandingAllocations: 0, cleanupAttempts: 0, steps: [] };
    receipt.cases.push(caseReceipt);
    if (stopped) continue;
    try {
      ledger.openCase(plan.id, { body: totalOperations(budget.worstBody), cleanup: totalOperations(budget.worstCleanup),
        storedBytes: budget.worstStoredBytes });
    } catch (error) {
      if (!(error instanceof QualificationRefusal)) throw error;
      caseReceipt.status = "refused-by-budget"; stopped = true; budgetRefused = true; continue;
    }
    const before = ledger.snapshot().debited;
    const allocations: Allocation[] = Array.from({ length: plan.allocations }, (_, i) => {
      const key = `export/${randomUUID()}`;
      return { key, allocationSha256: allocationDigest(configuration.bucket, key), exportId: randomUUID(), attemptId: randomUUID(),
        objectId: randomUUID(), principal: hex32(), receipt: hex32(), writeBinding: hex32(),
        payload: syntheticBytes(plan.payloadBytes, index * 4 + i * 2 + 1), alternate: syntheticBytes(plan.payloadBytes, index * 4 + i * 2 + 2),
        claims: new Map(), held: new Set(), written: false, worstStoredBytes: 0, verifiedAbsent: false };
    });
    let ordinal = 0, unexpected = false;

    const claimFor = (a: Allocation, label: ClaimLabel, fresh: boolean): Claim => {
      const existing = a.claims.get(label);
      if (existing && !fresh) return existing;
      const claim = { allocationSha256: a.allocationSha256, token: hex32(),
        expiresAt: now() + (label === "overlong" ? 60_000 : claimTtlMs) };
      a.claims.set(label, claim); return claim;
    };
    const writeFrame = (a: Allocation, variant: CreateVariant) => {
      const bytes = variant === "alternate" ? a.alternate : variant === "over-maximum" ? syntheticBytes(MAXIMUM_PAYLOAD_BYTES + 1, 7) : a.payload;
      const declared = variant === "digest-mismatch" ? sha256Hex(a.alternate) : sha256Hex(bytes);
      const objectKey = variant === "unbound-key" ? allocations[1].key : a.key;
      const at = now();
      const locator = { provider: "archive-r2-current-object-v1", bucket: variant === "bucket-mismatch" ? otherBucket(configuration.bucket) : configuration.bucket,
        objectKey, byteCount: bytes.byteLength, sha256: declared };
      const frame = { objectId: a.objectId,
        writeIdentity: { purpose: "inherit-export-reservation-v1", exportId: a.exportId, attemptId: a.attemptId, ordinal: 0, offset: 0,
          byteCount: bytes.byteLength, sha256: declared, logicalKey: `${a.principal}/${a.exportId}/${a.attemptId}-0.part`,
          reservedAt: new Date(at).toISOString(), authorityReceipt: a.receipt, locator },
        writeBindingSha256: a.writeBinding, allocationSha256: a.allocationSha256,
        configurationSha256: variant === "configuration-mismatch" ? sha256Hex(`qualification-mismatch\n${configuration.bindingSha256}`) : configuration.bindingSha256,
        originalDeadline: new Date(variant === "deadline-passed" ? at - 3_600_000 : at + 600_000).toISOString() };
      const sent = variant === "length-mismatch" ? bytes.subarray(0, bytes.byteLength - 1) : bytes;
      const requestAllocation = variant === "foreign-request-allocation" ? allocations[1].allocationSha256 : a.allocationSha256;
      return { frame, sent, requestAllocation, sha256: sha256Hex(bytes) };
    };
    const payloadDescriptor = (value: unknown, a: Allocation): Descriptor | null => {
      const parsed = descriptorSchema.safeParse(value);
      if (!parsed.success || parsed.data.key !== a.key || parsed.data.size < 1 || !isDeepStrictEqual(parsed.data.customMetadata,
        { state: "owned-payload", allocationSha256: a.allocationSha256, writeBindingSha256: a.writeBinding })) return null;
      return parsed.data;
    };
    const markerDescriptor = (value: unknown, a: Allocation): Descriptor | null => {
      const parsed = descriptorSchema.safeParse(value);
      if (!parsed.success || parsed.data.key !== a.key || parsed.data.size !== 0 || !isDeepStrictEqual(parsed.data.customMetadata,
        { state: "permanent-empty-fence", allocationSha256: a.allocationSha256 })) return null;
      return parsed.data;
    };
    const markerFrame = (a: Allocation, kind: "marker" | "stale-etag" | "payload-identity") => {
      const source = kind === "payload-identity" ? a.payloadRecord?.descriptor : a.markerRecord;
      return { kind: "permanent-empty-fence", objectKey: a.key, version: source?.version ?? "0", etag: kind === "stale-etag" ? "0".repeat(32) : source?.etag ?? "0",
        byteCount: 0, allocationSha256: a.allocationSha256, writeBindingSha256: null };
    };
    const refusal = (expect: string) => ["refused", "precondition-failed", "mismatch-refused"].includes(expect) ? expect : "refused";
    const settleOutcome = (outcome: GatewayOutcome, expect: string) =>
      outcome.kind === "refused" ? refusal(expect) : outcome.kind === "uncertain" ? `uncertain:${outcome.reason}` : null;

    /** Sends one step and returns its observed label. The label never carries a value from the service. */
    async function execute(step: QualificationStep): Promise<string> {
      const a = allocations[step.alloc];
      switch (step.op) {
        case "probe": {
          const outcomes = await provider.probe(step.probe, a.allocationSha256);
          receipt.gatewayRequests += outcomes.length;
          const labels = outcomes.map(o => o.kind === "json" ? (isConfiguration(o.value) ? "configuration" : "json") : o.kind);
          if (labels.length === 1 && labels[0] === "refused") return "refused";
          if (labels.length === 2 && labels[0] === "configuration" && labels[1] === "refused") return "accepted-then-refused";
          return labels.join("+");
        }
        case "describeConfiguration": {
          const outcome = await call(a.allocationSha256, "describeConfiguration", []);
          return settleOutcome(outcome, step.expect) ?? (outcome.kind === "json" && isConfiguration(outcome.value) ? "configuration" : "unexpected-answer");
        }
        case "createPayload": {
          const built = writeFrame(a, step.variant), target = allocations[writtenAllocation(step)!];
          target.written = true; target.worstStoredBytes += stepWorstStoredBytes(step, plan.payloadBytes);
          const outcome = await call(built.requestAllocation, "createPayload", [built.frame, Buffer.from(built.sent).toString("base64")]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          const descriptor = outcome.kind === "json" ? payloadDescriptor(outcome.value, a) : null;
          if (!descriptor || descriptor.size !== built.sent.byteLength || step.variant !== "valid" && step.variant !== "alternate") return "unexpected-answer";
          a.payloadRecord = { descriptor, sha256: built.sha256 };
          return "created";
        }
        case "createConcurrently": {
          a.written = true; a.worstStoredBytes += stepWorstStoredBytes(step, plan.payloadBytes);
          const first = writeFrame(a, "valid"), second = writeFrame(a, "alternate");
          const outcomes = await Promise.all([first, second].map(b =>
            call(a.allocationSha256, "createPayload", [b.frame, Buffer.from(b.sent).toString("base64")])));
          const winners = outcomes.map((o, i) => o.kind === "json" ? { descriptor: payloadDescriptor(o.value, a), sha256: [first, second][i].sha256 } : null);
          const created = winners.filter(w => w !== null);
          if (created.length !== 1 || !created[0].descriptor || outcomes.filter(o => o.kind === "refused").length !== 1) return "unexpected-answer";
          a.payloadRecord = { descriptor: created[0].descriptor, sha256: created[0].sha256 };
          return "one-created";
        }
        case "readPayload": {
          const outcome = await call(a.allocationSha256, "readPayload", [writeFrame(a, "valid").frame]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          return outcome.kind === "body" && a.payloadRecord && isDeepStrictEqual(payloadDescriptor(outcome.descriptor, a), a.payloadRecord.descriptor)
            && outcome.byteLength === a.payloadRecord.descriptor.size && outcome.sha256 === a.payloadRecord.sha256 ? "payload-body" : "unexpected-answer";
        }
        case "beginCleanup": case "endCleanup": {
          const claim = claimFor(a, step.claim, step.op === "beginCleanup");
          // Until the gateway definitely refuses it, a sent claim may be held there.
          if (step.op === "beginCleanup") a.held.add(step.claim);
          const outcome = await call(a.allocationSha256, step.op, [claim]);
          if (step.op === "beginCleanup" && outcome.kind === "refused") a.held.delete(step.claim);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          if (outcome.kind !== "json" || outcome.value !== true) return "unexpected-answer";
          if (step.op === "endCleanup") a.held.delete(step.claim);
          return "true";
        }
        case "head": {
          const key = step.foreignKey ? allocations[1].key : a.key;
          const outcome = await call(a.allocationSha256, "head", [claimFor(a, step.claim, false), key]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          if (outcome.kind !== "json") return "unexpected-answer";
          if (outcome.value === null) return "absent";
          const asPayload = payloadDescriptor(outcome.value, a), asMarker = markerDescriptor(outcome.value, a);
          if (step.expect === "any-current") {
            // Cleanup adopts what it observes, but only shapes this allocation can hold.
            if (asPayload) { a.payloadRecord = { descriptor: asPayload, sha256: a.payloadRecord?.descriptor.etag === asPayload.etag ? a.payloadRecord.sha256 : undefined }; return "payload"; }
            if (asMarker) { a.markerRecord = asMarker; return "marker"; }
            return "unexpected-answer";
          }
          if (asPayload && a.payloadRecord && isDeepStrictEqual(asPayload, a.payloadRecord.descriptor)) return "payload";
          if (asMarker && a.markerRecord && isDeepStrictEqual(asMarker, a.markerRecord)) return "marker";
          return "unexpected-answer";
        }
        case "get": {
          const record = step.ifMatch === "payload" ? a.payloadRecord?.descriptor : step.ifMatch === "marker" ? a.markerRecord : undefined;
          const etag = step.ifMatch === "stale" ? "0".repeat(32) : record?.etag;
          if (!etag) return "unexpected-plan-state";
          const outcome = await call(a.allocationSha256, "get", [claimFor(a, step.claim, false), a.key, [["if-match", `"${etag}"`]]]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          if (outcome.kind === "null") return "null";
          if (outcome.kind !== "body") return "unexpected-answer";
          if (step.ifMatch === "payload" && a.payloadRecord && isDeepStrictEqual(payloadDescriptor(outcome.descriptor, a), a.payloadRecord.descriptor)
            && outcome.byteLength === a.payloadRecord.descriptor.size
            && (a.payloadRecord.sha256 === undefined || outcome.sha256 === a.payloadRecord.sha256)) return "payload-body";
          if (step.ifMatch === "marker" && a.markerRecord && isDeepStrictEqual(markerDescriptor(outcome.descriptor, a), a.markerRecord)
            && outcome.byteLength === 0 && outcome.sha256 === EMPTY_SHA256) return "marker-body";
          return "unexpected-answer";
        }
        case "putEmpty": {
          const etag = step.condition === "if-match-stale" ? "0".repeat(32) : a.payloadRecord?.descriptor.etag;
          if (step.condition !== "if-none-match" && !etag) return "unexpected-plan-state";
          a.written = true; a.worstStoredBytes += stepWorstStoredBytes(step, plan.payloadBytes);
          const condition = step.condition === "if-none-match" ? ["if-none-match", "*"] : ["if-match", `"${etag}"`];
          const outcome = await call(a.allocationSha256, "putEmpty", [claimFor(a, step.claim, false), a.key, [condition]]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          const marker = outcome.kind === "json" ? markerDescriptor(outcome.value, a) : null;
          if (!marker) return "unexpected-answer";
          a.markerRecord = marker; return "marker";
        }
        case "deleteCurrent": {
          if (step.marker !== "payload-identity" && !a.markerRecord) return "unexpected-plan-state";
          const outcome = await call(a.allocationSha256, "deleteCurrent", [claimFor(a, step.claim, false), a.key, markerFrame(a, step.marker)]);
          const settled = settleOutcome(outcome, step.expect);
          if (settled) return settled;
          if (outcome.kind !== "json" || !isDeepStrictEqual(outcome.value, { terminal: true, absent: true })) return "unexpected-answer";
          return "absent";
        }
      }
    }
    async function call(allocationSha256: string, operation: GatewayOperation, args: readonly unknown[]) {
      receipt.gatewayRequests += 1;
      return provider.call(allocationSha256, operation, args);
    }
    function isConfiguration(value: unknown) {
      return isDeepStrictEqual(value, { bucket: configuration.bucket, bindingSha256: configuration.bindingSha256, protocol: GATEWAY_PROTOCOL });
    }
    const matches = (step: QualificationStep, observed: string) =>
      observed === step.expect || (step.expect === "any-current" && ["payload", "marker", "absent"].includes(observed));
    const describe = (step: QualificationStep) => {
      switch (step.op) {
        case "probe": return `probe:${step.probe}`;
        case "createPayload": return `createPayload:${step.variant}`;
        case "head": return step.foreignKey ? "head:foreign-key" : "head";
        case "get": return `get:if-match-${step.ifMatch}`;
        case "putEmpty": return `putEmpty:${step.condition}`;
        case "deleteCurrent": return `deleteCurrent:${step.marker}`;
        default: return step.op;
      }
    };
    /** Reserve, send, debit: the expected cost if the answer matched, the worst case otherwise. */
    async function dispatch(step: QualificationStep, phase: LedgerPhase): Promise<string> {
      const worst = stepWorstCost(step);
      ledger.authorize(phase, worst, stepWorstStoredBytes(step, plan.payloadBytes));
      options.onDispatch?.(step, phase, plan.id);
      let observed: string;
      try { observed = await execute(step); } catch { observed = "uncertain:caller"; }
      const debit = matches(step, observed) ? stepCost(step, observed) : worst;
      ledger.settle(debit);
      caseReceipt.steps.push(Object.freeze({ ordinal: ++ordinal, phase, operation: describe(step), expected: step.expect, observed, operations: debit }));
      return observed;
    }

    for (const step of plan.steps) {
      let observed: string;
      // A ledger refusal is an unexpected result too: stop the body and still clean up.
      try { observed = await dispatch(step, "body"); }
      catch (error) { if (!(error instanceof QualificationRefusal)) throw error; unexpected = true; break; }
      if (!matches(step, observed)) { unexpected = true; break; }
      if (step.op === "deleteCurrent" && step.expect === "absent") allocations[step.alloc].verifiedAbsent = true;
      if (step.op === "head" && step.expect === "absent" && !step.foreignKey) allocations[step.alloc].verifiedAbsent = true;
      if (writtenAllocation(step) !== null && step.expect !== "refused") allocations[writtenAllocation(step)!].verifiedAbsent = false;
    }
    ledger.closeBody();

    // Cleanup: every allocation the case may have written and has not verified absent.
    const waitForClaims = async (a: Allocation) => {
      const latest = Math.max(0, ...[...a.held].map(label => a.claims.get(label)?.expiresAt ?? 0));
      const wait = latest + 2_000 - now();
      if (wait > 0) await sleep(wait);
      a.held.clear();
    };
    async function disposeOnce(alloc: AllocationIndex): Promise<boolean> {
      const a = allocations[alloc];
      for (const label of [...a.held]) {
        if (await dispatch({ op: "endCleanup", alloc, claim: label, expect: "true" }, "cleanup") !== "true") await waitForClaims(a);
      }
      const opening: QualificationStep[] = [{ op: "describeConfiguration", alloc, expect: "configuration" }, begin("k1", "true", alloc), head("k1", "any-current", alloc)];
      let observed = "";
      for (const step of opening) { observed = await dispatch(step, "cleanup"); if (!matches(step, observed)) return false; }
      if (observed === "absent") return await dispatch(end("k1", "true", alloc), "cleanup") === "true";
      for (const step of disposalSteps(alloc, observed as "payload" | "marker", "k1", "k2").slice(3))
        if (!matches(step, await dispatch(step, "cleanup"))) return false;
      return true;
    }
    const needsCleanup = allocations.map((a, i) => ({ a, i: i as AllocationIndex })).filter(({ a }) => a.written && !a.verifiedAbsent);
    for (const { a, i } of needsCleanup) {
      let done = false;
      for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS && !done; attempt++) {
        caseReceipt.cleanupAttempts++;
        if (attempt > 1) await waitForClaims(a);
        try { done = await disposeOnce(i); } catch (error) { if (!(error instanceof QualificationRefusal)) throw error; done = false; break; }
      }
      if (done) { a.verifiedAbsent = true; caseReceipt.cleanedAllocations++; }
      else { caseReceipt.outstandingAllocations++; outstandingObjectKeys.push(a.key); }
    }
    // A cleanup that did not follow the expected path is also an unexpected result.
    const expectedCleanup = caseReceipt.steps.filter(s => s.phase === "cleanup").reduce((sum, s) => addOperations(sum, s.operations), NO_OPERATIONS);
    if (!unexpected && !isDeepStrictEqual(expectedCleanup, budget.expectedCleanup)) unexpected = true;
    ledger.closeCase();
    possiblyStored += allocations.filter(a => a.written && !a.verifiedAbsent).reduce((sum, a) => sum + a.worstStoredBytes, 0);
    const after = ledger.snapshot().debited;
    caseReceipt.debitedOperations = ops(after.classA - before.classA, after.classB - before.classB, after.delete - before.delete);
    caseReceipt.status = caseReceipt.outstandingAllocations ? "cleanup-incomplete" : unexpected ? "unexpected" : "passed";
    if (caseReceipt.outstandingAllocations) cleanupIncomplete = true;
    if (caseReceipt.status !== "passed") stopped = true;
    for (const a of allocations) { a.payload.fill(0); a.alternate.fill(0); }
    syncLedger();
    receipt.possiblyStoredBytesAtEnd = possiblyStored;
    receipt.outstandingAllocations = outstandingObjectKeys.length;
    options.onCase?.(caseReceipt, receipt);
  }
  syncLedger();
  receipt.endedAt = new Date(now()).toISOString();
  receipt.status = cleanupIncomplete ? "CLEANUP_INCOMPLETE" : budgetRefused ? "REFUSED" : stopped ? "STOPPED" : "PASS";
  return Object.freeze({ receipt, outstandingObjectKeys: Object.freeze([...outstandingObjectKeys]) });
}

// ---------------------------------------------------------------------------
// Dry plan, mode selection and prior receipts
// ---------------------------------------------------------------------------

/** The default mode's whole output. It contacts nothing and reads no environment. */
export function dryPlanReport(prior: PriorUsage = NO_PRIOR_USAGE) {
  const proof = proveQualificationBudget(QUALIFICATION_CASES, OWNER_LIMITS, prior);
  return Object.freeze({
    version: "requester-statement-archive-qualification-plan-v1", mode: "dry-plan", contacted: false,
    limits: OWNER_LIMITS, prior, cleanupAttemptsReserved: CLEANUP_ATTEMPTS, metadataAllowanceBytes: METADATA_ALLOWANCE_BYTES,
    rpcWorstCase: RPC_WORST_CASE, worstCleanupAttempt: worstCleanupAttempt(),
    totals: { expected: proof.expected, expectedTotal: proof.expectedTotal, expectedGatewayRequests: proof.expectedGatewayRequests,
      expectedPeakStoredBytes: proof.expectedPeakStoredBytes, worst: proof.worst, worstTotal: proof.worstTotal,
      worstStoredBytes: proof.worstStoredBytes, operationsHeadroom: proof.operationsHeadroom, storedBytesHeadroom: proof.storedBytesHeadroom },
    cases: QUALIFICATION_CASES.map((plan, i) => ({ ...proof.cases[i], requirement: plan.requirement, citations: plan.citations,
      steps: plan.steps.length })),
    excluded: QUALIFICATION_EXCLUSIONS,
  });
}

export type QualificationMode =
  | Readonly<{ mode: "dry-plan"; priorReceipts: readonly string[] }>
  | Readonly<{ mode: "live"; receiptsPath: string; priorReceipts: readonly string[]; configuration: GatewayConfiguration; url: URL; key: Uint8Array }>;

/**
 * Without `--live` this returns the dry plan and never calls `readEnvironment`.
 * With `--live` every name in LIVE_ENVIRONMENT_NAMES must be present and valid;
 * a refusal names the variables, never their values.
 */
export function selectQualificationMode(argv: readonly string[],
  readEnvironment: (name: LiveEnvironmentName) => string | undefined): QualificationMode {
  let live = false, receiptsPath: string | undefined;
  const priorReceipts: string[] = [];
  for (const argument of argv) {
    if (argument === "--live" && !live) live = true;
    else if (argument.startsWith("--receipts=") && receiptsPath === undefined && argument.length > 11) receiptsPath = argument.slice(11);
    else if (argument.startsWith("--prior-receipt=") && argument.length > 16) priorReceipts.push(argument.slice(16));
    else throw new QualificationRefusal("qualification_argument_refused");
  }
  if (!live) {
    if (receiptsPath !== undefined) throw new QualificationRefusal("qualification_receipts_require_live");
    return Object.freeze({ mode: "dry-plan", priorReceipts: Object.freeze(priorReceipts) });
  }
  if (receiptsPath === undefined) throw new QualificationRefusal("qualification_live_receipts_required");
  const values = new Map<LiveEnvironmentName, string>();
  for (const name of LIVE_ENVIRONMENT_NAMES) { const value = readEnvironment(name); if (typeof value === "string" && value.length) values.set(name, value); }
  const missing = LIVE_ENVIRONMENT_NAMES.filter(name => !values.has(name));
  if (missing.length) throw new QualificationRefusal("qualification_live_environment_missing", missing);
  const invalid: LiveEnvironmentName[] = [];
  let url: URL | undefined;
  try { url = new URL(values.get("INHERIT_TEST_STATEMENT_GATEWAY_URL")!); } catch { url = undefined; }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== GATEWAY_PATH)
    invalid.push("INHERIT_TEST_STATEMENT_GATEWAY_URL");
  const encodedKey = values.get("INHERIT_TEST_STATEMENT_GATEWAY_KEY")!;
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) { key.fill(0); invalid.push("INHERIT_TEST_STATEMENT_GATEWAY_KEY"); }
  const bucket = values.get("INHERIT_TEST_STATEMENT_R2_BUCKET")!, bindingSha256 = values.get("INHERIT_TEST_STATEMENT_R2_BINDING_SHA256")!;
  if (!/^inherit-export-[a-z0-9-]{1,40}$/u.test(bucket)) invalid.push("INHERIT_TEST_STATEMENT_R2_BUCKET");
  if (!/^[0-9a-f]{64}$/u.test(bindingSha256)) invalid.push("INHERIT_TEST_STATEMENT_R2_BINDING_SHA256");
  if (invalid.length) { key.fill(0); throw new QualificationRefusal("qualification_live_environment_invalid", invalid); }
  return Object.freeze({ mode: "live", receiptsPath, priorReceipts: Object.freeze(priorReceipts),
    configuration: Object.freeze({ bucket, bindingSha256 }), url: url!, key: new Uint8Array(key) });
}

const count = z.number().int().nonnegative().safe();
const priorReceiptSchema = z.object({
  version: z.literal("requester-statement-archive-qualification-receipt-v1"),
  ledger: z.object({ debited: z.object({ classA: count, classB: count, delete: count }).strict(), debitedTotal: count,
    storedBytesBound: count }).strict(),
  possiblyStoredBytesAtEnd: count,
}).passthrough();

/**
 * Earlier attempts of the same qualification spend the same budget. Each prior
 * receipt adds its debited operations and the bytes it could not prove deleted.
 */
export function sumPriorReceipts(texts: readonly string[]): PriorUsage {
  let operations = 0, storedBytes = 0;
  for (const text of texts) {
    let parsed: z.infer<typeof priorReceiptSchema>;
    try { parsed = priorReceiptSchema.parse(JSON.parse(text)); } catch { throw new QualificationRefusal("prior_receipt_refused"); }
    if (parsed.ledger.debitedTotal !== totalOperations(parsed.ledger.debited)) throw new QualificationRefusal("prior_receipt_refused");
    operations += parsed.ledger.debitedTotal; storedBytes += parsed.possiblyStoredBytesAtEnd;
  }
  return Object.freeze({ operations, storedBytes });
}
