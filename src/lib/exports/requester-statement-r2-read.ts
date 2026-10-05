import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

type ReadGateway=Pick<RequesterStatementR2Gateway,"assertReady"|"readPayload">;
type Frame=Parameters<ReadGateway["assertReady"]>[0];
const hash=z.string().regex(/^[0-9a-f]{64}$/u),providerId=z.string().regex(/^[A-Za-z0-9._-]{1,256}$/u);
const descriptor=z.object({key:z.string(),version:providerId,etag:providerId,size:z.number().int().nonnegative().safe(),
 customMetadata:z.object({state:z.literal("owned-payload"),allocationSha256:hash,writeBindingSha256:hash}).strict()}).passthrough();
const unavailable=()=>new Error("requester_statement_r2_unavailable");

/** Descriptor identity comes from the native frame. This parser supplies no
 * issuer, currentness, provider or disposal authority. */
export function verifyRequesterStatementObject(raw:unknown,frame:Frame){
 const value=descriptor.parse(raw);
 if(value.key!==frame.writeIdentity.locator.objectKey||value.size!==frame.writeIdentity.byteCount
  ||value.customMetadata.allocationSha256!==frame.allocationSha256
  ||value.customMetadata.writeBindingSha256!==frame.writeBindingSha256)throw unavailable();
 return value;
}

/** The actual complete read owner is shared by CREATE readback and download.
 * Descriptor refusal owns the response body even before it acquires a reader.
 * Every actual cancel is registered, including this pre-reader refusal path;
 * failure or expiry permanently refuses the mutable-buffer settlement proof. */
export function readRequesterStatementWholeObject(gateway:ReadGateway,frame:Frame,signal:AbortSignal,runtime?:RequesterStatementRuntime){
 const actual=async()=>{
  await gateway.assertReady(frame,signal);
  const response=await gateway.readPayload(frame,signal),body=response.body;
  if(!(body instanceof ReadableStream))throw unavailable();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,bytes:Uint8Array|undefined,cancellation:Promise<void>|undefined;
  const cancel=()=>{
   if(!reader)return;const selected=reader;
   cancellation??=runtime?runtime.cleanup("r2-reader-cancel",()=>selected.cancel()):selected.cancel();
   void cancellation.catch(()=>{});
  };
  signal.addEventListener("abort",cancel,{once:true});
  try{
   // Allocate inside the body owner's try/finally: even admission/allocation
   // failure still cancels the real unopened response body.
   bytes=runtime?.own(new Uint8Array(frame.writeIdentity.byteCount))??new Uint8Array(frame.writeIdentity.byteCount);
   const metadata=verifyRequesterStatementObject(response.descriptor,frame);reader=body.getReader();let length=0;
   for(;;){
    if(signal.aborted)throw unavailable();const next=await reader.read();if(next.done)break;
    try{
     if(!(next.value instanceof Uint8Array)||!next.value.byteLength||next.value.byteLength>bytes.byteLength-length)throw unavailable();
     bytes.set(next.value,length);length+=next.value.byteLength;
    }finally{if(next.value instanceof Uint8Array)next.value.fill(0);}
   }
   if(signal.aborted||length!==bytes.byteLength||createHash("sha256").update(bytes).digest("hex")!==frame.writeIdentity.sha256)throw unavailable();
   await gateway.assertReady(frame,signal);return {bytes,metadata};
  }catch{
   if(bytes){if(runtime)runtime.clear(bytes);else bytes.fill(0);}throw unavailable();
  }finally{
   signal.removeEventListener("abort",cancel);
   if(reader){
    cancel();try{if(runtime&&cancellation)await runtime.wait(cancellation,Date.parse(frame.originalDeadline));else await cancellation;}
    finally{reader.releaseLock();}
   }else{
    // Do not allow allSettled(producer) to turn a failed cancellation into
    // success. cleanup() latches failure; wait() keeps the original deadline.
    const actualCancel=runtime?runtime.cleanup("r2-unread-body-cancel",()=>body.cancel()):body.cancel();
    if(runtime)await runtime.wait(actualCancel,Date.parse(frame.originalDeadline));else await actualCancel;
   }
  }
 };
 return runtime?runtime.track("r2-whole-object-read",actual):actual();
}
