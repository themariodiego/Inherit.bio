import { z } from "zod";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "@/lib/genome/ingest-limits";
import { cohortCard, parseRpcCards, type CohortCard } from "./record-key-cards";

/**
 * The request and response shapes of `POST /api/embryo-cohorts` (register
 * `api.embryo-cohorts`, request schema `closed-embryo-cohort-finalize-v1`,
 * response `cohort-created-v1`).
 *
 * The register's policy for this route is long, and almost all of it is the
 * database's work rather than this layer's: `finalize_embryo_cohort_ingest_v1`
 * locks and consumes the draft, resolves the basis authority case, creates the
 * cohort and its embryo subjects with neutral ordinal labels, provisions the
 * Record Key print rights, and mints the ingest session and its retention row
 * in **one** transaction. Fifteen fields the request cannot influence are
 * listed in the register as `serverAuthoritative`, which is why the body below
 * carries four values and nothing else.
 *
 * What this module is responsible for is the boundary in the other direction:
 * deciding what may leave the server. The mint returns seven keys and only
 * some of them belong in a response body.
 */

/** Four values; every other field of the cohort is server-authoritative. */
export const cohortFinalizeBody = z
  .object({
    cohortDraftId: z.uuid(),
    insuranceAcknowledgementId: z.uuid(),
    futurePersonCharterAcknowledgementId: z.uuid(),
    nonce: z.string().min(1),
  })
  .strict();
export type CohortFinalizeRequest = z.infer<typeof cohortFinalizeBody>;

/**
 * What `private.create_embryo_ingest_session_v1` returns. Two of these seven
 * keys are credentials: `cookieValue` is the upload session's secret, stored
 * in the database only as a hash, and `challenge` is the mapping challenge.
 * Neither may ever reach a response body — `cookieValue` belongs in the
 * `HttpOnly; SameSite=Strict` cookie `ingestCookie()` builds, and `challenge`
 * is answered through the mapping route, not handed out at creation. The
 * closed body below therefore names its members explicitly rather than
 * spreading this object, and `cohortCreatedBody` is tested against a mint
 * carrying both secrets to prove neither survives the mapping.
 */
export interface IngestMint {
  session: string;
  uploadId: string;
  cookieValue: string;
  challenge: string;
  revision: number;
  sampleHandles: { ordinal: number; handle: string }[];
  expiresAt: string;
}

const sampleHandle = z.object({ ordinal: z.number().int().min(0), handle: z.string().min(1) }).strict();
const ingestMint = z
  .object({
    session: z.uuid(),
    uploadId: z.uuid(),
    cookieValue: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    challenge: z.string().min(1),
    revision: z.number().int().positive(),
    sampleHandles: z.array(sampleHandle).min(1).max(LIMITS.maximumSampleColumns),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const cohortRow = z
  .object({
    cohort_id: z.uuid(),
    embryo_count: z.number().int().positive(),
    recipient_set_revision: z.number().int().nonnegative(),
    key_revision: z.number().int().nonnegative(),
    caller_state: z.enum(["delivered_inline", "not_a_card_recipient"]),
    cards: z.unknown().nullable(),
  })
  .loose();

/** `{ cohort, ingest }`, the two halves of the one finalize transaction. */
export const cohortFinalizeResult = z.object({ cohort: cohortRow, ingest: ingestMint }).strict();

export interface CohortCreatedBody {
  cohort_id: string;
  status: "upload_ready";
  embryo_count: number;
  upload_session: {
    transport: "embryo-chunks";
    uploadId: string;
    session: string;
    chunkBytes: number;
    maximumChunks: number;
    maximumInputBytes: number;
    sampleHandles: { ordinal: number; handle: string }[];
  };
  record_key_delivery: {
    recipient_set_revision: number;
    caller_state: "delivered_inline" | "not_a_card_recipient";
  };
  record_key_cards: CohortCard[];
}

/**
 * The register's `cohort-created-v1`, built field by field from the RPC
 * result. `unknownFieldsRecursively` is forbidden there, so nothing is
 * spread: a key that is not written here cannot appear.
 *
 * The three `constFrom` limits are read from `ingest-limits.ts` rather than
 * from the mint, because they are the deployment's bounds and not this
 * session's — a session that somehow carried different ones would be
 * describing a transport the chunk route will not honour.
 *
 * Cards are returned only when the caller is one of the Record Key
 * recipients; `not_a_card_recipient` yields an empty array whatever the RPC
 * put in `cards`, which is the register's `recipientRule` and the reason the
 * caller state is read before the array rather than after it.
 */
export function cohortCreatedBody(result: unknown, origin?: string): CohortCreatedBody {
  const { cohort, ingest } = cohortFinalizeResult.parse(result);
  const recipient = cohort.caller_state === "delivered_inline";
  return {
    cohort_id: cohort.cohort_id,
    status: "upload_ready",
    embryo_count: cohort.embryo_count,
    upload_session: {
      transport: "embryo-chunks",
      uploadId: ingest.uploadId,
      session: ingest.session,
      chunkBytes: INGEST_CHUNK_MAXIMUM_BYTES,
      maximumChunks: LIMITS.maximumChunks,
      maximumInputBytes: LIMITS.maximumUncompressedInputBytes,
      sampleHandles: ingest.sampleHandles.map((handle) => ({ ordinal: handle.ordinal, handle: handle.handle })),
    },
    record_key_delivery: {
      recipient_set_revision: cohort.recipient_set_revision,
      caller_state: cohort.caller_state,
    },
    record_key_cards: recipient ? parseRpcCards(cohort.cards).map((card) => cohortCard(card, origin)) : [],
  };
}

/** The mint's cookie parts, kept together so a caller cannot take one alone. */
export function ingestCookieParts(result: unknown): { session: string; secret: string; expiresAt: Date } {
  const { ingest } = cohortFinalizeResult.parse(result);
  return { session: ingest.session, secret: ingest.cookieValue, expiresAt: new Date(ingest.expiresAt) };
}
