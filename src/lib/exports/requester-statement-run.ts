import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import type {Database} from "@/lib/supabase/types";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
import { z } from "zod";
const unavailable = () => new Error("requester_statement_run_unavailable");
type Reply=PromiseLike<{data:unknown;error:unknown}>;
type RunRpc=Readonly<{
 begin:(args:Database["public"]["Functions"]["begin_requester_statement_archive_run_v1"]["Args"],signal:AbortSignal)=>Reply;
 finish:(args:Database["public"]["Functions"]["finish_requester_statement_archive_run_v1"]["Args"],signal:AbortSignal)=>Reply;
}>;
/** Trusted worker bridge, not user input. No retry or lease-expiry completion. */
export function ownStatementArchiveRunRpc(rpc: RunRpc,runtime?:RequesterStatementRuntime) {
 async function call(work:(signal:AbortSignal)=>Reply,signal:AbortSignal,begin:boolean) {
  if (signal.aborted) throw unavailable();
  const controller = new AbortController(), joined = AbortSignal.any([signal, controller.signal]);
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(unavailable());joined.addEventListener("abort", abort, { once: true }); });
  const timer = setTimeout(() => controller.abort(), 30_000);timer.unref();
  try {
   const execute=()=>{if(joined.aborted)throw unavailable();return work(joined);};
   // An uncertain begin can have created a native run after the outer race.
   // Track that actual RPC; an unknown run id is never guessed or ACKed.
   const pending=begin&&runtime?
    runtime.track("native-statement-run-begin",execute):Promise.resolve().then(execute);
   const reply = await Promise.race([pending, interrupted]);
   if (joined.aborted || reply.error !== null) throw unavailable();return reply.data;
  } finally { clearTimeout(timer);joined.removeEventListener("abort", abort);controller.abort(); }
 }
 return {
  async begin(job: { exportId: string; authorityReceipt: string }, attemptId: string, nonce: string, signal: AbortSignal) {
   const reply = await call(current=>rpc.begin({ p_export: job.exportId, p_attempt: attemptId,
    p_receipt: job.authorityReceipt, p_nonce: nonce },current),signal,true);return z.uuid().parse(reply);
  },
  async finish(runId: string, nonce: string, signal: AbortSignal) {
   const reply = await call(current=>rpc.finish({ p_run: runId, p_nonce: nonce },current),signal,false);
   if (reply !== true) throw unavailable();
  },
 };
}

/** Actual existing internal service client; no new role or public actor. */
export function configuredStatementRunRpc():RunRpc {
 const admin=createAdminClient();const rpc:RunRpc={
  begin:(args,signal)=>admin.rpc("begin_requester_statement_archive_run_v1",args).abortSignal(signal),
  finish:(args,signal)=>admin.rpc("finish_requester_statement_archive_run_v1",args).abortSignal(signal),
 };return Object.freeze(rpc);
}
