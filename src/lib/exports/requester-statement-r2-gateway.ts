import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createR2CurrentDisposalBinding, type R2CurrentBucketPort } from "./archive-r2-current-binding";
import type { R2CurrentReservation } from "./archive-r2-current-fence";
import { requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import type { RequesterStatementR2Gateway } from "./requester-statement-r2";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
type Frame = Parameters<RequesterStatementR2Gateway["assertReady"]>[0];
type Claim = { allocationSha256: string; token: string; expiresAt: number };
type Stub = {
 describeConfiguration(): Promise<unknown>;createPayload(frame: Frame, bytes: Uint8Array): Promise<unknown>;
 readPayload(frame: Frame): ReturnType<RequesterStatementR2Gateway["readPayload"]>;
 beginCleanup(claim: Claim): Promise<boolean>;endCleanup(claim: Claim): Promise<boolean>;
 head(claim: Claim,key: string): Promise<unknown | null>;
 get(claim: Claim,key: string,headers: Headers): Promise<unknown | null>;
 putEmpty(claim: Claim,key: string,headers: Headers): Promise<unknown | null>;
};
/** Actual service binding, not a browser URL or public HTTP transport. */
export type RequesterStatementGatewayNamespace = { idFromName(allocation: string): unknown;get(id: unknown): Stub };
const config = z.object({ bucket:z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
 bindingSha256:z.string().regex(/^[0-9a-f]{64}$/u),protocol:z.literal("r2-current-object-qualified-all-writer-gateway-v1") }).strict();
const unavailable=()=>new Error("requester_statement_gateway_unavailable");
export function createRequesterStatementGateway(namespace: RequesterStatementGatewayNamespace,
 expected: z.infer<typeof config>, env: Readonly<Record<string,string|undefined>>=process.env,runtime?:RequesterStatementRuntime): RequesterStatementR2Gateway {
 if(!requesterStatementsOpen(env))throw unavailable();const pinned=config.parse(expected);
 let exclusive:{reservation:R2CurrentReservation;claim:Claim;stub:Stub}|undefined;
 const stub=(allocation:string)=>namespace.get(namespace.idFromName(allocation));
 async function ready(selected:Stub,bucket:string,signal:AbortSignal){
  if(signal.aborted||bucket!==pinned.bucket)throw unavailable();const actual=config.parse(await selected.describeConfiguration());
  if(signal.aborted||actual.bucket!==pinned.bucket||actual.bindingSha256!==pinned.bindingSha256||actual.protocol!==pinned.protocol)throw unavailable();
 }
 const port:R2CurrentBucketPort={
  async head(key){if(!exclusive)throw unavailable();return exclusive.stub.head(exclusive.claim,key);},
  async get(key,options){if(!exclusive)throw unavailable();return exclusive.stub.get(exclusive.claim,key,options.onlyIf);},
  async put(key,body,options){if(!exclusive||body.byteLength!==0)throw unavailable();return exclusive.stub.putEmpty(exclusive.claim,key,options.onlyIf);},
 };
 const disposalProvider=createR2CurrentDisposalBinding({bucketName:pinned.bucket,bucket:port,
  assertReady:async(binding,signal)=>ready(stub(binding.allocationSha256),binding.locator.bucket,signal),
  serializeExactKey:async(binding,signal,work)=>{
   if(exclusive||signal.aborted)throw unavailable();const selected=stub(binding.allocationSha256);
   await ready(selected,binding.locator.bucket,signal);
   const tokenBytes=randomBytes(32);runtime?.own(tokenBytes);let token:string;
   try{token=tokenBytes.toString("hex");}finally{if(runtime)runtime.clear(tokenBytes);else tokenBytes.fill(0);}
   const claim={allocationSha256:binding.allocationSha256,token,expiresAt:Date.parse(binding.claimExpiresAt)};
   if(await selected.beginCleanup(claim)!==true||signal.aborted)throw unavailable();
   exclusive={reservation:binding,claim,stub:selected};
   try{return await work();}finally{exclusive=undefined;await selected.endCleanup(claim);}
  },
 });
 return Object.freeze({disposalProvider,
  async assertReady(frame:Frame,signal:AbortSignal){
   if(frame.configurationSha256!==pinned.bindingSha256)throw unavailable();await ready(stub(frame.allocationSha256),frame.writeIdentity.locator.bucket,signal);
  },
  async createPayload(frame:Frame,bytes:Uint8Array,signal:AbortSignal){
   await ready(stub(frame.allocationSha256),frame.writeIdentity.locator.bucket,signal);if(signal.aborted)throw unavailable();
   const owned=Uint8Array.from(bytes);
   try{runtime?.own(owned);const value=await stub(frame.allocationSha256).createPayload(frame,owned);if(signal.aborted)throw unavailable();return value;}
   finally{if(runtime)runtime.clear(owned);else owned.fill(0);}
  },
  async readPayload(frame:Frame,signal:AbortSignal){
   await ready(stub(frame.allocationSha256),frame.writeIdentity.locator.bucket,signal);
   const selected=stub(frame.allocationSha256);
   if(runtime){
    const value=await runtime.track("gateway-payload-read-rpc",()=>selected.readPayload(frame));
    if(signal.aborted){await runtime.wait(runtime.cleanup("gateway-late-payload-body-cancel",()=>value.body.cancel()),Date.parse(frame.originalDeadline));throw unavailable();}
    return value;
   }
   const pending=selected.readPayload(frame);
   void pending.then(value=>{if(signal.aborted){try{void value.body.cancel().catch(()=>{});}catch{/* no ACK */}}},()=>{});
   const value=await pending;if(signal.aborted){try{void value.body.cancel().catch(()=>{});}catch{/* no ACK */}throw unavailable();}return value;
  },
 });
}
