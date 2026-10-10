import "server-only";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { normalizationDatabaseConfig } from "@/lib/uploads/normalization-database";
import { validateArchiveSegment, type ArchiveAttempt, type ArchiveSegment, type StoredArchiveSegment } from "./archive-segments";
import { fenceR2CurrentReservation, r2CurrentReservationSchema, type R2CurrentDisposalProvider } from "./archive-r2-current-fence";
import { requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import {readRequesterStatementWholeObject,verifyRequesterStatementObject} from "./requester-statement-r2-read";
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const writeIdentity = r2CurrentReservationSchema.shape.writeIdentity;
const writeFrame = z.object({ objectId: z.uuid(), writeIdentity, writeBindingSha256: hash, allocationSha256: hash,
 configurationSha256: hash, originalDeadline: z.iso.datetime({ offset: true }) }).strict();
type Frame = z.infer<typeof writeFrame>;
/** Trusted native gateway binding, supplied only by the TEST worker service.
 * Actual implementation is the separate Durable Object module in this packet.
 * No HTTP URL, caller namespace, history API or delete capability is accepted. */
export type RequesterStatementR2Gateway = Readonly<{
 assertReady(frame: Frame, signal: AbortSignal): Promise<void>;
 createPayload(frame: Frame, bytes: Uint8Array, signal: AbortSignal): Promise<unknown>;
 readPayload(frame: Frame, signal: AbortSignal): Promise<{ descriptor: unknown; body: ReadableStream<Uint8Array> }>;
 disposalProvider: R2CurrentDisposalProvider;
}>;
const unavailable = () => new Error("requester_statement_r2_unavailable");
function config(env: Readonly<Record<string, string | undefined>>) {
 if (!requesterStatementsOpen(env)) throw unavailable();
 const value = normalizationDatabaseConfig({ ...env,
  // The actual shared parser's opt-in is boolean text; its DSN is DATABASE_URL.
  // Never fall back to the ordinary deployment DSN for this private owner door.
  INHERIT_NORMALIZATION_DIRECT_DATABASE: "true",
  DATABASE_URL: env.INHERIT_TEST_REQUESTER_STATEMENT_R2_DATABASE,
  INHERIT_NORMALIZATION_DATABASE_CA_CERT: env.INHERIT_TEST_REQUESTER_STATEMENT_R2_DATABASE_CA_CERT });
 if (!value) throw unavailable();return value;
}
async function owner<T>(env: Readonly<Record<string, string | undefined>>, signal: AbortSignal,
 work: (tx: postgres.TransactionSql) => Promise<T>,runtime?:RequesterStatementRuntime): Promise<T> {
 const sql = postgres({ ...config(env), max: 1, prepare: false, fetch_types: false, connect_timeout: 5, idle_timeout: 5,
  max_lifetime: 40, connection: { application_name: "inherit-test-requester-statement-r2" }, onnotice: () => {}, debug: false });
 let interrupt = () => {};
 const canceled = new Promise<never>((_, reject) => { interrupt = () => { void sql.end({ timeout: 0 }).catch(() => {});reject(unavailable()); };signal.addEventListener("abort", interrupt, { once: true }); });
 const timer = setTimeout(interrupt, 30_000);timer.unref();
 try {
  if (signal.aborted) throw unavailable();
  const transaction=()=>sql.begin(async tx => {
   const allowed = await tx<{ allowed: boolean }[]>`select current_user='postgres' and session_user='postgres' as allowed`;
   if (allowed.length !== 1 || allowed[0]?.allowed !== true) throw unavailable();
   await tx`select set_config('statement_timeout','25000',true),set_config('lock_timeout','5000',true),set_config('idle_in_transaction_session_timeout','25000',true)`;
   if(signal.aborted)throw unavailable();return work(tx);
  });
  const actual=runtime?runtime.track("r2-native-owner-transaction",transaction):transaction();
  const value = await Promise.race([actual, canceled]);
  if (signal.aborted) throw unavailable();return value as T;
 } finally { clearTimeout(timer);signal.removeEventListener("abort", interrupt);await sql.end({ timeout: 0 }).catch(() => {}); }
}
/** Native reservation committed before this actual CREATE. The owner transaction
 * keeps current case/job/attempt locks until real readback and COMMIT. A timeout,
 * process loss or unknown provider result leaves its native allocation pending. */
export function createRequesterStatementR2Writer(gateway: RequesterStatementR2Gateway, receipt: string,runtime:RequesterStatementRuntime,
 env: Readonly<Record<string, string | undefined>> = process.env) {
 hash.parse(receipt);config(env);
 return async (attempt: ArchiveAttempt, segment: ArchiveSegment, bytes: Uint8Array, signal: AbortSignal) => {
  validateArchiveSegment(attempt, segment);
  if (bytes.byteLength !== segment.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== segment.sha256) throw unavailable();
  return owner(env, signal, tx => runtime.track("r2-native-write-callback",async()=>{
   const rows = await tx<{ frame: unknown }[]>`select private.current_new_correction_archive_r2_write_v1(${attempt.attemptId}::uuid,${segment.ordinal},${receipt}) as frame`;
   if (rows.length !== 1) throw unavailable();const frame = writeFrame.parse(rows[0]?.frame), identity = frame.writeIdentity;
   if (identity.exportId !== attempt.exportId || identity.attemptId !== attempt.attemptId || identity.ordinal !== segment.ordinal
    || identity.logicalKey !== segment.objectKey || identity.byteCount !== segment.sizeBytes || identity.sha256 !== segment.sha256) throw unavailable();
   await gateway.assertReady(frame, signal);
   const created = verifyRequesterStatementObject(await gateway.createPayload(frame, bytes, signal), frame);
   const read = await readRequesterStatementWholeObject(gateway, frame, signal,runtime);
   try { if (read.metadata.version !== created.version || read.metadata.etag !== created.etag) throw unavailable(); }
   finally { runtime.clear(read.bytes); }
   const actual = await tx<{ id: string }[]>`select private.complete_new_correction_archive_r2_write_v1(${attempt.attemptId}::uuid,
    ${segment.ordinal},${receipt},${JSON.stringify(frame)}::jsonb,${created.version},${created.etag}) as id`;
   if (actual.length !== 1 || actual[0]?.id !== frame.objectId) throw unavailable();return { objectId: frame.objectId };
  }),runtime);
 };
}
/** Whole-object adapter for the existing core readArchiveSegment verifier.
 * It checks the actual durable download grant again after EOF/serialization.
 * READY and grant issuance stay under the existing separate native CAS policy. */
export function createRequesterStatementR2Reader(gateway: RequesterStatementR2Gateway, downloadHash: string, receipt: string,
 env: Readonly<Record<string, string | undefined>> = process.env) {
 hash.parse(downloadHash);hash.parse(receipt);config(env);
 return async (attempt: ArchiveAttempt, segment: StoredArchiveSegment, signal: AbortSignal) => {
  validateArchiveSegment(attempt,segment,true);
  return owner(env,signal,async tx=>{
   const get = async()=>{
    const rows=await tx<{frame:unknown}[]>`select private.current_requester_statement_r2_read_v1(${downloadHash},${attempt.attemptId}::uuid,${segment.ordinal},${receipt}) as frame`;
    if(rows.length!==1)throw unavailable();return writeFrame.parse(rows[0]?.frame);
   };
   const frame=await get();
   if(frame.objectId!==segment.objectId||frame.writeIdentity.logicalKey!==segment.objectKey
    ||frame.writeIdentity.byteCount!==segment.sizeBytes||frame.writeIdentity.sha256!==segment.sha256)throw unavailable();
   const read=await readRequesterStatementWholeObject(gateway,frame,signal);
   try{
    if(JSON.stringify(await get())!==JSON.stringify(frame))throw unavailable();
    const bytes=read.bytes;let consumed=false;
    return {objectId:frame.objectId,objectKey:segment.objectKey,sizeBytes:bytes.byteLength,
     body:new ReadableStream<Uint8Array>({pull(controller){if(signal.aborted){bytes.fill(0);controller.error(unavailable());return;}
      if(consumed){bytes.fill(0);controller.close();return;}consumed=true;controller.enqueue(bytes);},cancel(){bytes.fill(0);}}, {highWaterMark:0})};
   }catch{read.bytes.fill(0);throw unavailable();}
  });
 };
}

/** This final engine is copied byte-exact from the independently reviewed source
 * successor. Native currentness is checked before/after all provider work and
 * again in the durable native ACK transaction. No service/public SQL ACK exists. */
export async function disposeRequesterStatementR2Segment(attemptId: string, ordinal: number,
 gateway: RequesterStatementR2Gateway, signal: AbortSignal, env: Readonly<Record<string, string | undefined>> = process.env) {
 const claimBytes=randomBytes(32);let claim:string;
 try{claim=claimBytes.toString("hex");}finally{claimBytes.fill(0);}
 const reservation = await owner(env, signal, async tx => {
  const rows = await tx<{ frame: unknown }[]>`select private.claim_new_correction_archive_r2_disposal_v1(${attemptId}::uuid,${ordinal},${claim}) as frame`;
  if (rows.length !== 1) throw unavailable();return r2CurrentReservationSchema.parse(rows[0]?.frame);
 });
 const evidence = await fenceR2CurrentReservation({ reservation, provider: gateway.disposalProvider, signal,
  checkCurrent: async (expected, current) => owner(env, current, async tx => {
   const rows = await tx<{ frame: unknown }[]>`select private.check_new_correction_archive_r2_disposal_v1(${attemptId}::uuid,${ordinal},${claim},${JSON.stringify(expected)}::jsonb) as frame`;
   if (rows.length !== 1) throw unavailable();return rows[0]?.frame;
  }) });
 await owner(env, signal, async tx => {
  const rows = await tx<{ acknowledged: boolean }[]>`select private.ack_new_correction_archive_r2_disposal_v1(${attemptId}::uuid,
   ${ordinal},${claim},${JSON.stringify(reservation)}::jsonb,${JSON.stringify(evidence)}::jsonb) as acknowledged`;
  if (rows.length !== 1 || rows[0]?.acknowledged !== true) throw unavailable();
 });
}
