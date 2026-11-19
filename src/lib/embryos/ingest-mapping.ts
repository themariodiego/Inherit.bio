import "server-only";

import { z } from "zod";
import {
  MAXIMUM_MAPPING_DECISIONS,
  PGT_FIELDS,
  detectPgtHeaderCells,
  isForbiddenHeaderCell,
  mappingChallengeColumns,
  planLocusKind,
  planMapping,
  type MappingChallengeColumn,
  type PgtLocusKind,
} from "@/lib/genome/parsers/pgt-table";
import { route } from "@/lib/primary-routes";
import { sensitiveJson } from "./api";
import { closedResponse } from "./guards";
import { readBounded, terminalResponse, withNoReferrer } from "./ingest-configure";

/**
 * The request and response halves of `api.embryo-ingest-mapping`
 * (`POST`/`PUT /api/embryo-ingest/[session]/mapping`; responses
 * `pgt-mapping-challenge-v1` and `embryo-ingest-decision-v1`; ADR 0037). The
 * route owns authority and ordering; this module owns what may cross the
 * boundary in each direction and the in-memory header rule.
 *
 * In, on `POST`: the bounded header copy of a laboratory table and the one
 * mapping-inspection nonce. The copy is inspected in memory and zeroized; no
 * header string, candidate set, example value or derivative of one is sent
 * to the database, a log or a response.
 *
 * In, on `PUT`: one closed decision on the current challenge, never a header.
 *
 * Out: the next challenge with its one decision nonce, or, once nothing is
 * left to decide, the transport (owner decision "Token rotation in the
 * embryo mapping responses"): build, challenge, revision, completion nonce
 * and CSRF token, the VCF configure response's pattern.
 */

/** 128 cells of 80 characters, three UTF-8 bytes each, a nonce and JSON punctuation. */
export const MAPPING_BODY_MAXIMUM_BYTES = 65_536;
export const HEADER_COLUMNS_MAXIMUM = 128;
export const HEADER_CELL_MAXIMUM_CHARACTERS = 80;

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The closed issue vocabulary of `invalid-request-v1` for the inspection. */
export type InspectIssue = "body" | "headerColumns" | "nonce";
const ISSUE_ORDER: readonly InspectIssue[] = ["body", "headerColumns", "nonce"];

/** `methodRequestContracts.POST.closedBody`. */
export const inspectBody = z
  .object({
    headerColumns: z.array(z.string().min(1).max(HEADER_CELL_MAXIMUM_CHARACTERS).refine((cell) => !CONTROL.test(cell)))
      .min(1).max(HEADER_COLUMNS_MAXIMUM),
    nonce: z.string().min(1).max(4096),
  })
  .strict();
export type InspectRequest = z.infer<typeof inspectBody>;

async function readJsonBody(request: Request): Promise<{ ok: true; raw: unknown } | { ok: false }> {
  const type = (request.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/.test(type) || request.headers.has("content-encoding")) {
    return { ok: false };
  }
  const bytes = await readBounded(request, MAPPING_BODY_MAXIMUM_BYTES);
  if (!bytes) return { ok: false };
  try {
    return { ok: true, raw: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: true, raw: undefined };
  } finally {
    bytes.fill(0);
  }
}

/** Drop every reference to the submitted header copy. Strings cannot be overwritten; the array that held them can be emptied. */
export function zeroizeHeader(body: { headerColumns: string[] } | null | undefined): void {
  if (!body) return;
  body.headerColumns.fill("");
  body.headerColumns.length = 0;
}

/** The closed inspection body, or the closed issue list. Nothing here is written, audited or logged. */
export async function readInspectBody(request: Request): Promise<{ ok: true; body: InspectRequest } | { ok: false; issues: InspectIssue[] }> {
  const read = await readJsonBody(request);
  if (!read.ok) return { ok: false, issues: ["body"] };
  const parsed = inspectBody.safeParse(read.raw);
  if (parsed.success) return { ok: true, body: parsed.data };
  const found = new Set<InspectIssue>();
  for (const issue of parsed.error.issues) {
    const head = issue.path[0];
    const known = typeof head === "string" && (ISSUE_ORDER as readonly string[]).includes(head);
    found.add(known && issue.code !== "unrecognized_keys" ? (head as InspectIssue) : "body");
  }
  return { ok: false, issues: ISSUE_ORDER.filter((issue) => found.has(issue)) };
}

/**
 * What the bounded header copy decides, in the register's order: a
 * forbidden sex, gender, karyotype or proxy column first, before anything
 * else is derived; then the header rule (at least three fields); then the
 * mapping plan (at most four decisions). Only canonical values leave: the
 * column count, the locus kind and neutral column indexes with their
 * candidate fields. The copy is zeroized whatever the answer.
 */
export type HeaderInspection =
  | { kind: "terminal"; branch: "header" | "format" | "mapping" }
  | { kind: "columns"; columnCount: number; locus: PgtLocusKind; decisions: MappingChallengeColumn[] }
  | { kind: "complete"; columnCount: number; locus: PgtLocusKind };

export function inspectHeader(body: { headerColumns: string[] }): HeaderInspection {
  try {
    const cells = body.headerColumns;
    if (cells.some(isForbiddenHeaderCell)) return { kind: "terminal", branch: "header" };
    const header = detectPgtHeaderCells(cells);
    if (!header) return { kind: "terminal", branch: "format" };
    const plan = planMapping(header);
    if (!plan) return { kind: "terminal", branch: "mapping" };
    const locus = planLocusKind(header, plan);
    if (plan.complete) return { kind: "complete", columnCount: header.columnCount, locus };
    return { kind: "columns", columnCount: header.columnCount, locus, decisions: mappingChallengeColumns(plan) };
  } finally {
    zeroizeHeader(body);
  }
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const field = z.enum(PGT_FIELDS);

/** `methodRequestContracts.PUT.oneOfClosedBodies[0]`: a column decision. */
export const columnDecisionBody = z
  .object({
    challengeId: z.string().regex(TOKEN),
    mappings: z.array(z.object({ columnIndex: z.number().int().min(0).max(HEADER_COLUMNS_MAXIMUM - 1), field }).strict())
      .min(1).max(MAXIMUM_MAPPING_DECISIONS)
      .refine((items) => new Set(items.map((item) => item.columnIndex)).size === items.length
        && new Set(items.map((item) => item.field)).size === items.length
        && !(items.some((item) => item.field === "sample") && items.some((item) => item.field === "embryo"))),
    nonce: z.string().min(1).max(4096),
  })
  .strict();

/** `methodRequestContracts.PUT.oneOfClosedBodies[1]`: a build decision. */
export const buildDecisionBody = z
  .object({
    challengeId: z.string().regex(TOKEN),
    referenceBuild: z.enum(["GRCh37", "GRCh38", "unknown"]),
    nonce: z.string().min(1).max(4096),
  })
  .strict();

export type DecisionRequest =
  | ({ kind: "columns" } & z.infer<typeof columnDecisionBody>)
  | ({ kind: "build" } & z.infer<typeof buildDecisionBody>);

/**
 * Exactly one of the two closed bodies, or nothing: an unknown, missing,
 * invalid or ambiguous body reads as the opaque `resource-not-found-v1`
 * (`unknownMissingInvalidStaleCrossKindOrAmbiguous`), retryable and
 * changing nothing. Which body the stored challenge accepts is the
 * database's decision, never this request's.
 */
export async function readDecisionBody(request: Request): Promise<DecisionRequest | null> {
  const read = await readJsonBody(request);
  if (!read.ok) return null;
  const columns = columnDecisionBody.safeParse(read.raw);
  const build = buildDecisionBody.safeParse(read.raw);
  if (columns.success === build.success) return null;
  return columns.success ? { kind: "columns", ...columns.data } : { kind: "build", ...build.data! };
}

/** The column decision exactly as `private.resolve_embryo_mapping_challenge_v1` stores it. */
export function columnResolution(mappings: readonly { columnIndex: number; field: string }[]): { columnIndex: number; field: string }[] {
  return mappings.map(({ columnIndex, field }) => ({ columnIndex, field }));
}

const uuid = z.uuid();
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const failurePending = z.object({ status: z.literal("failure_pending"), cohortId: uuid, ingestRevision: positiveRevision }).strict();
const challenge = z.object({
  status: z.literal("challenge"), kind: z.enum(["columns", "build"]), revision: positiveRevision,
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
}).strict();
const transport = z.object({ status: z.literal("transport"), build: z.enum(["GRCh37", "GRCh38"]), revision: positiveRevision }).strict();

/** What `public.inspect_embryo_table_mapping_v1` returns. */
export const inspectResult = z.discriminatedUnion("status", [
  challenge,
  transport,
  z.object({
    status: z.literal("terminal"), branch: z.enum(["header", "format", "mapping"]),
    cohortId: uuid, ingestRevision: positiveRevision,
  }).strict(),
  failurePending,
]);

/** What `public.decide_embryo_table_mapping_v1` returns. */
export const decideResult = z.discriminatedUnion("status", [
  challenge,
  transport,
  z.object({ status: z.literal("terminal"), branch: z.literal("build_unknown"), cohortId: uuid, ingestRevision: positiveRevision }).strict(),
  failurePending,
]);

export const COLUMN_CHALLENGE_KEYS = ["kind", "challengeId", "decisions", "maximumDecisions", "expiresAt", "nonce"] as const;
export const BUILD_CHALLENGE_KEYS = ["kind", "challengeId", "questionCopyId", "options", "expiresAt", "nonce"] as const;
export const TRANSPORT_KEYS = ["kind", "build", "challenge", "revision", "completionNonce", "csrfToken"] as const;

/** The neutral label a column carries on the wire: `Column N`, counted from one. Never a header string. */
export function neutralColumnLabel(columnIndex: number): string {
  return `Column ${columnIndex + 1}`;
}

function expiry(value: string): string {
  return new Date(value).toISOString();
}

/** `pgt-mapping-challenge-v1.columns`: neutral indexes and canonical candidates, and the one nonce for the decision. */
export async function columnChallengeResponse(value: {
  challengeId: string; decisions: readonly MappingChallengeColumn[]; expiresAt: string; nonce: string;
}): Promise<Response> {
  const body = {
    kind: "columns" as const,
    challengeId: value.challengeId,
    decisions: value.decisions.map((decision) => ({
      sourceColumn: neutralColumnLabel(decision.columnIndex),
      columnIndex: decision.columnIndex,
      candidateFields: [...decision.candidateFields],
    })),
    maximumDecisions: MAXIMUM_MAPPING_DECISIONS,
    expiresAt: expiry(value.expiresAt),
    nonce: value.nonce,
  };
  return withNoReferrer(await closedResponse("api.embryo-ingest-mapping", COLUMN_CHALLENGE_KEYS, body, 200));
}

/**
 * The build question (`pgt-mapping-challenge-v1.build` and
 * `embryo-ingest-decision-v1.columnMappingAccepted.build`): the three options
 * of `genome-build-inference-v1.decisionRequired`, the last one leading to
 * `embryos.request-data`, and the one nonce for the answer.
 */
export async function buildChallengeResponse(value: { challengeId: string; expiresAt: string; nonce: string }): Promise<Response> {
  const body = {
    kind: "build" as const,
    challengeId: value.challengeId,
    questionCopyId: "upload.build.question",
    options: [
      { value: "GRCh37", labelCopyId: "upload.build.grch37" },
      { value: "GRCh38", labelCopyId: "upload.build.grch38" },
      { value: "unknown", labelCopyId: "upload.build.unknown", route: route("embryos.request-data") },
    ],
    expiresAt: expiry(value.expiresAt),
    nonce: value.nonce,
  };
  return withNoReferrer(await closedResponse("api.embryo-ingest-mapping", BUILD_CHALLENGE_KEYS, body, 200));
}

/** The transport, once nothing is left to decide: the VCF configure response's five values, under `kind`. */
export async function transportResponse(value: {
  build: "GRCh37" | "GRCh38"; challenge: string; revision: number; completionNonce: string; csrfToken: string;
}): Promise<Response> {
  return withNoReferrer(await closedResponse("api.embryo-ingest-mapping", TRANSPORT_KEYS,
    { kind: "transport" as const, ...value }, 200));
}

/** `embryo-ingest-decision-v1.buildUnknown`: the configure route's constant 422, after the unwind is dispatched. */
export function buildUnknownResponse(): Response {
  return terminalResponse("build_unknown");
}

/** A closed body was refused in memory: never a header, label or value. */
export function mappingNotFound(): Response {
  return withNoReferrer(sensitiveJson({ error: "not_found" }, 404));
}
