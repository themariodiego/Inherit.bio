import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, unavailable } from "@/lib/embryos/api";
import { embryoFragmentStore, type EmbryoFragmentStore, type FragmentTargets } from "@/lib/embryos/fragment-store";
import { accountJurisdictionDenied, unauthorized } from "@/lib/embryos/guards";
import {
  chunkBinding,
  chunkCommit,
  chunkReceipt,
  chunkRejection,
  chunkStored,
  headerRejection,
  isPdf,
  noReferrer,
  reservationFragments,
  validateChunk,
  zeroizeChunk,
  type ChunkRejection,
  type ValidatedChunk,
} from "@/lib/embryos/ingest-chunk";
import { dispatchIngestAttemptFailure, failIngestAttempt } from "@/lib/embryos/ingest-failure";
import { authorizeIngestHttpRequest, ingestChunkEnvelope, readIngestChunk, type IngestAuthorizationArgs } from "@/lib/embryos/ingest-http";
import { EmbryoTransportError } from "@/lib/embryos/ingest-lines";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `PUT /api/embryo-ingest/[session]/chunks/[sequence]` (register
 * `api.embryo-ingest-chunk`). TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE`
 * stays false. Until this deployment names the R2 fragment gateway
 * (`INHERIT_EMBRYO_R2_ORIGIN`, `INHERIT_EMBRYO_R2_BUCKET`) the route refuses
 * before it authorizes, reads or reserves anything, and until an operator
 * selects a backend in SQL the reservation itself refuses.
 *
 * `policy.requestAuthority`: the live account and originating auth session,
 * the `embryo_analysis` guard, exact Origin with same-origin fetch metadata
 * and the host-only upload cookie, all before a byte is read. This is the one
 * ingest request with no CSRF header and no nonce: the database binds the
 * session, sequence, byte count and content hash instead, an identical retry
 * resumes the same objects, and a changed hash fails the attempt.
 *
 * `serverWork`, in order: read the bounded body, bind its header to the one
 * issued challenge, revision, build and handle set, validate the whole chunk
 * (`validateEmbryoVcfChunk`) and only then reserve it. Then, as
 * docs/embryo-fragment-storage.md fixes the order: read the write targets,
 * land each open fragment at its exact receipt with `writeEmbryoFragment`
 * (create-only, read back to EOF, acknowledged by SQL), and commit, which
 * refuses unless every fragment has landed.
 *
 * Every terminal branch (framing, header, format, a limit, an aborted body)
 * is recorded through `fail_embryo_ingest_attempt_v1` before any reservation
 * or write, and the unwind is dispatched. If that record cannot be made the
 * answer is the retryable 503, never a terminal answer for a live attempt.
 */
export async function PUT(request: Request, context: { params: Promise<{ session: string; sequence: string }> }) {
  const { session, sequence: rawSequence } = await context.params;
  const account = await getSensitiveAccountContext();
  if (!account) return noReferrer(unauthorized());
  const refused = await accountJurisdictionDenied(account.user.id);
  if (refused) return noReferrer(refused);
  const store = embryoFragmentStore();
  if (!store) return noReferrer(unavailable());

  const authorization = await authorizeIngestHttpRequest(
    request,
    session,
    { accountId: account.user.id, authSessionId: account.sessionId },
    async (args) => createAdminClient().rpc("authorize_embryo_ingest_request_v1", args),
  );
  if (authorization.kind === "denied") return noReferrer(authorization.response);
  if (authorization.kind === "failure_pending") {
    await dispatchIngestAttemptFailure(authorization.authority);
    return noReferrer(notFound());
  }
  const { authority, credentials } = authorization;
  const reject = async (rejection: ChunkRejection) =>
    (await failIngestAttempt(credentials, authority, rejection.code)) ? rejection.response() : noReferrer(unavailable());

  let envelope: { sequence: number; length: number };
  try {
    envelope = ingestChunkEnvelope(request, session, rawSequence);
  } catch (error) {
    return reject(chunkRejection(error));
  }

  let bytes: Uint8Array | null = null;
  let chunk: ValidatedChunk | null = null;
  try {
    try {
      bytes = await readIngestChunk(request, envelope.length);
    } catch (error) {
      return reject(chunkRejection(error, request.signal.aborted));
    }
    if (isPdf(bytes)) return reject(chunkRejection(new EmbryoTransportError("pdf_not_data")));
    const binding = chunkBinding(bytes, authority);
    if (!binding) return reject(headerRejection);
    try {
      chunk = validateChunk(bytes, binding);
    } catch (error) {
      return reject(chunkRejection(error));
    }
    return await persistChunk(store, request.signal, credentials, envelope.sequence, chunk, authority);
  } finally {
    zeroizeChunk(bytes, chunk);
  }
}

/**
 * Reserve, write, commit, in the order docs/embryo-fragment-storage.md fixes.
 * Every database refusal of the attempt dispatches the unwind and reads as
 * the opaque 404; contention, an unready store or a fragment that has not
 * landed yet is the retryable 503, which the browser answers by sending the
 * identical chunk again. A fragment that can never land fails the attempt.
 */
async function persistChunk(
  store: EmbryoFragmentStore,
  signal: AbortSignal,
  credentials: IngestAuthorizationArgs,
  sequence: number,
  chunk: ValidatedChunk,
  authority: { cohortId: string; ingestRevision: number; sampleCount: number },
): Promise<Response> {
  const session = credentials.p_ingest_session_id;
  const admin = createAdminClient();
  const refusedAttempt = async () => {
    await dispatchIngestAttemptFailure(authority);
    return noReferrer(notFound());
  };

  const reserved = await admin.rpc("reserve_embryo_ingest_chunk_v1", {
    p_session_id: session, p_sequence: sequence, p_sha256: chunk.sha256, p_byte_count: chunk.byteCount,
    p_record_count: chunk.recordCount, p_maximum_line_bytes: chunk.maximumLineBytes,
    p_fragments: reservationFragments(chunk),
  });
  const receipt = chunkReceipt.safeParse(reserved.data);
  // Includes 55000 embryo_object_backend_unavailable: no backend is selected,
  // and the whole reservation rolled back.
  if (reserved.error || !receipt.success) return noReferrer(unavailable());
  if (receipt.data.status === "failure_pending") return refusedAttempt();
  if (receipt.data.status === "denied") return noReferrer(notFound());

  if (receipt.data.status === "reserved") {
    const written = await writeFragments(store, signal, session, sequence, chunk, authority.sampleCount);
    if (written === "failure_pending") return refusedAttempt();
    if (written === "denied") return noReferrer(notFound());
    if (written === "retry") return noReferrer(unavailable());
    if (written === "never") {
      return (await failIngestAttempt(credentials, authority, "chunk")) ? noReferrer(notFound()) : noReferrer(unavailable());
    }
  }

  // Refuses (55000 embryo_chunk_objects_unlanded) until every fragment landed.
  const committed = await admin.rpc("commit_embryo_ingest_chunk_v1", {
    p_session_id: session, p_sequence: sequence, p_sha256: chunk.sha256,
  });
  const commit = chunkCommit.safeParse(committed.data);
  if (committed.error || !commit.success) return noReferrer(unavailable());
  if (commit.data.status === "failure_pending") return refusedAttempt();
  if (commit.data.status === "denied") return noReferrer(notFound());
  return chunkStored();
}

/**
 * Read the targets, then land every open fragment at its exact receipt, in at
 * most two passes. Any write that did not land leaves its intent open, so the
 * second pass re-reads the targets (renewing an expired window) and writes
 * only what is still open. `landed` means no target is still open; only the
 * commit proves they all arrived.
 *
 * `never`: a receipt disagrees with the fragment this route validated, or
 * the key already holds other bytes. That fragment can never land, so the
 * attempt is failed rather than retried.
 */
async function writeFragments(
  store: EmbryoFragmentStore,
  signal: AbortSignal,
  session: string,
  sequence: number,
  chunk: ValidatedChunk,
  sampleCount: number,
): Promise<"landed" | "retry" | "never" | "failure_pending" | "denied"> {
  const byOrdinal = new Map(chunk.fragments.map((fragment) => [fragment.ordinal, fragment]));
  if (byOrdinal.size !== sampleCount) return "retry";
  for (let pass = 0; pass < 2; pass += 1) {
    let answer: FragmentTargets;
    try {
      answer = await store.targets(session, sequence);
    } catch {
      return "retry";
    }
    if (answer.status === "failure_pending" || answer.status === "denied") return answer.status;
    const targets = answer.targets;
    // Exactly one receipt per embryo: a VCF chunk splits every record into
    // every embryo's fragment. A receipt for another session or chunk, or a
    // non-R2 backend, is a contract breach: write nothing.
    const ordinals = targets.map((target) => target.ordinal).sort((a, b) => a - b);
    if (ordinals.length !== sampleCount || ordinals.some((ordinal, index) => ordinal !== index)) return "retry";
    for (const target of targets) {
      const { receipt } = target;
      if (receipt.sessionId !== session || receipt.sequence !== sequence || receipt.ordinal !== target.ordinal ||
        receipt.backend !== "r2" || target.state === "uncertain") return "retry";
      const fragment = byOrdinal.get(target.ordinal)!;
      if (receipt.byteCount !== fragment.bytes.byteLength || receipt.sha256 !== fragment.sha256) return "never";
    }
    const open = targets.filter((target) => target.state === "open");
    if (open.length === 0) return "landed";
    let again = false;
    for (const target of open) {
      const outcome = await store.write(target, byOrdinal.get(target.ordinal)!.bytes, signal);
      if (outcome === "conflict") return "never";
      if (outcome === "retry") again = true;
    }
    if (!again) return "landed";
  }
  return "retry";
}
