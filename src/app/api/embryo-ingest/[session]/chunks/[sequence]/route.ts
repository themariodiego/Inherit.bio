import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, unavailable } from "@/lib/embryos/api";
import { embryoFragmentStore, fragmentTargets, type EmbryoFragmentStore, type FragmentTarget } from "@/lib/embryos/fragment-store";
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
import { authorizeIngestHttpRequest, ingestChunkEnvelope, readIngestChunk } from "@/lib/embryos/ingest-http";
import { EmbryoTransportError } from "@/lib/embryos/ingest-lines";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `PUT /api/embryo-ingest/[session]/chunks/[sequence]` (register
 * `api.embryo-ingest-chunk`). TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE`
 * stays false, and until a fragment store is configured this route refuses
 * before it authorizes, reads or reserves anything.
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
 * (`validateEmbryoVcfChunk`) and only then reserve it. Each per-embryo
 * fragment goes to exactly the server-owned name the store reports, and the
 * commit refuses unless every fragment has landed there.
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
    return await persistChunk(store, credentials.p_ingest_session_id, envelope.sequence, chunk, authority);
  } finally {
    zeroizeChunk(bytes, chunk);
  }
}

/**
 * Reserve, write, commit. Every database refusal of the attempt dispatches
 * the unwind and reads as the opaque 404; contention, an unready store or a
 * fragment that has not landed yet is the retryable 503, which the browser
 * answers by sending the identical chunk again.
 */
async function persistChunk(
  store: EmbryoFragmentStore,
  session: string,
  sequence: number,
  chunk: ValidatedChunk,
  authority: { cohortId: string; ingestRevision: number; sampleCount: number },
): Promise<Response> {
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
  if (reserved.error || !receipt.success) return noReferrer(unavailable());
  if (receipt.data.status === "failure_pending") return refusedAttempt();
  if (receipt.data.status === "denied") return noReferrer(notFound());

  if (receipt.data.status === "reserved") {
    const written = await writeFragments(store, session, sequence, chunk, authority.sampleCount);
    if (written === "failure_pending") return refusedAttempt();
    if (written !== "landed") return noReferrer(written === "denied" ? notFound() : unavailable());
  }

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
 * Write every open fragment to its reported name, at most twice. A duplicate
 * on retry means it may already have landed, and a refusal may be a closed
 * window the store renews, so both re-read the targets once. `landed` means
 * no target is still open; only the commit proves they all arrived.
 */
async function writeFragments(
  store: EmbryoFragmentStore,
  session: string,
  sequence: number,
  chunk: ValidatedChunk,
  sampleCount: number,
): Promise<"landed" | "retry" | "failure_pending" | "denied"> {
  const byOrdinal = new Map(chunk.fragments.map((fragment) => [fragment.ordinal, fragment]));
  for (let pass = 0; pass < 2; pass += 1) {
    let targets: FragmentTarget[];
    try {
      const parsed = fragmentTargets.safeParse(await store.targets(session, sequence));
      if (!parsed.success) return "retry";
      if (parsed.data.status === "failure_pending" || parsed.data.status === "denied") return parsed.data.status;
      targets = parsed.data.targets;
    } catch {
      return "retry";
    }
    // One target per ordinal the session reserved, exactly: a VCF chunk
    // splits every record into every embryo's fragment.
    const ordinals = targets.map((target) => target.ordinal).sort((a, b) => a - b);
    if (ordinals.length !== sampleCount || ordinals.some((ordinal, index) => ordinal !== index) ||
      byOrdinal.size !== sampleCount) return "retry";
    const open = targets.filter((target) => target.state === "open");
    if (targets.some((target) => target.state === "uncertain")) return "retry";
    if (open.length === 0) return "landed";
    let again = false;
    for (const target of open) {
      const fragment = byOrdinal.get(target.ordinal)!;
      let outcome: string;
      try {
        outcome = await store.write(session, sequence, target, fragment.bytes, fragment.sha256);
      } catch {
        return "retry";
      }
      if (outcome === "exists" || outcome === "refused") again = true;
      else if (outcome !== "written") return "retry";
    }
    if (!again) return "landed";
  }
  return "retry";
}
