import {createHash,randomBytes,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {getAccountArchiveChunk,acknowledgeAccountArchiveChunk,type AccountArchiveChunkDependencies} from "./account-archive-chunk-http";

vi.mock("./account-export-http",()=>({currentAccountExportActor:vi.fn()}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
afterEach(()=>vi.useRealTimers());
const digest=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
function fixture(){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},session=randomUUID(),bytes=new Uint8Array([11,13,17]);
 const cookie=randomBytes(32).toString("base64url"),downloadHash=digest(Buffer.from(cookie));
 const ready={status:"ready" as const,exportId:randomUUID(),attemptId:randomUUID(),sizeBytes:3,sha256:digest(bytes),
  manifestSha256:"b".repeat(64),expiresAt:new Date(Date.now()+120_000).toISOString(),authorityReceipt:"c".repeat(64),
  principalHash:"d".repeat(64),segmentCount:1,pageCount:1,memberCount:12,payloadBytes:1,
  memberSha256:"e".repeat(64),manifestMemberSha256:"f".repeat(64)};
 const context=vi.fn<AccountArchiveChunkDependencies["context"]>(async()=>({sessionId:session,nextSequence:0,ready:structuredClone(ready)}));
 const release=vi.fn(async()=>{}),read=vi.fn<AccountArchiveChunkDependencies["read"]>(async()=>({bytes,release}));
 const acknowledge=vi.fn<AccountArchiveChunkDependencies["acknowledge"]>(async()=>true);
 const deps:AccountArchiveChunkDependencies={enabled:true,origin:()=>"https://test.e2e.local",actor:async()=>actor,context,read,acknowledge};
 const params={session,sequence:"0"};
 const get=(headers:Record<string,string>={},url=`https://test.e2e.local/api/downloads/${session}/chunks/0`)=>new Request(url,{
  headers:{cookie:`__Host-inherit-download=${cookie}`,"sec-fetch-site":"same-origin",...headers}});
 // 2026-11-22 (G8.5, owner decision "the reviewer chunk-acknowledgement address accepts either
 // kind of session"): the chunk's proof travels in X-Inherit-Operation-Proof (it was the
 // "x-inherit-csrf" header here); null sends none. X-Inherit-CSRF, the route's one-time
 // session token, is set through `headers` by the route-level tests below.
 const post=(value:unknown,proof:string|null,headers:Record<string,string>={})=>new Request(`https://test.e2e.local/api/downloads/${session}/chunks/0/acknowledge`,{
  method:"POST",headers:{cookie:`__Host-inherit-download=${cookie}`,origin:"https://test.e2e.local","sec-fetch-site":"same-origin",
   "content-type":"application/json",...(proof===null?{}:{"x-inherit-operation-proof":proof}),...headers},body:JSON.stringify(value)});
 return {actor,session,bytes,cookie,downloadHash,ready,context,release,read,acknowledge,deps,params,get,post};
}
async function delivered(f:ReturnType<typeof fixture>){
 const result=(await getAccountArchiveChunk(f.get(),f.params,f.deps))!;
 expect(result.status).toBe(200);expect(new Uint8Array(await result.arrayBuffer())).toEqual(f.bytes);
 // The chunk's answer hands its proof over in X-Inherit-Operation-Proof and sets no X-Inherit-CSRF (principle 1).
 expect(result.headers.get("x-inherit-operation-proof")).toMatch(/^[a-f0-9]{64}$/u);expect(result.headers.has("x-inherit-csrf")).toBe(false);
 return {receipt:result.headers.get("x-inherit-chunk-receipt")!,sha256:digest(f.bytes),sizeBytes:f.bytes.length,
  proof:result.headers.get("x-inherit-operation-proof")!};
}
describe("native-current TEST account chunk delivery",()=>{
 it("issues one secret-bound exact chunk, releases its owner at real EOF, and ACKs only its separately supplied receipt",async()=>{
  const f=fixture(),value=await delivered(f);expect(f.release).toHaveBeenCalledTimes(1);
  expect(f.acknowledge).not.toHaveBeenCalled();
  expect(f.read.mock.calls[0][0]).toEqual({actor:f.actor,sessionId:f.session,downloadHash:f.downloadHash,ready:f.ready,ordinal:0,
   challengeHash:digest(Buffer.from(value.receipt))});
  const {proof,...body}=value,result=await acknowledgeAccountArchiveChunk(f.post(body,proof),f.params,f.deps);
  expect(result!.status).toBe(204);expect((await result!.arrayBuffer()).byteLength).toBe(0);
  expect(f.acknowledge).toHaveBeenCalledTimes(1);expect(f.acknowledge.mock.calls[0][0]).toEqual({actor:f.actor,sessionId:f.session,
   downloadHash:f.downloadHash,ordinal:0,challengeHash:digest(Buffer.from(value.receipt)),sha256:body.sha256,sizeBytes:3});
 });
 it("does not select account authority when TEST is off or native explicitly identifies a different target",async()=>{
  const f=fixture();expect(await getAccountArchiveChunk(f.get(),f.params,{...f.deps,enabled:false})).toBeNull();
  expect(f.context).not.toHaveBeenCalled();
  expect(await getAccountArchiveChunk(f.get(),f.params,{...f.deps,context:async()=>null})).toBeNull();expect(f.read).not.toHaveBeenCalled();
 });
 it.each(["foreign-origin","query","range","foreign-site","missing-cookie","duplicate-cookie","wrong-session","wrong-sequence","expired","extra-ready"])("refuses %s before provider bytes",async fault=>{
  const f=fixture();let request=f.get(),params=f.params,deps=f.deps;
  if(fault==="foreign-origin")request=f.get({},`https://foreign.e2e.local/api/downloads/${f.session}/chunks/0`);
  if(fault==="query")request=f.get({},`${request.url}?target=other`);
  if(fault==="range")request=f.get({range:"bytes=0-1"});
  if(fault==="foreign-site")request=f.get({"sec-fetch-site":"cross-site"});
  if(fault==="missing-cookie")request=f.get({cookie:""});
  if(fault==="duplicate-cookie")request=f.get({cookie:`__Host-inherit-download=${f.cookie}; __Host-inherit-download=${f.cookie}`});
  if(fault==="wrong-session")params={...params,session:randomUUID()};
  if(fault==="wrong-sequence")params={...params,sequence:"1"};
  if(fault==="expired")f.ready.expiresAt=new Date(Date.now()-1).toISOString();
  if(fault==="extra-ready")deps={...deps,context:async()=>({sessionId:f.session,nextSequence:0,ready:{...f.ready,url:"https://foreign.e2e.local"}})};
  expect((await getAccountArchiveChunk(request,params,deps))!.status).toBe(404);expect(f.read).not.toHaveBeenCalled();
 });
 // 2026-11-22 (G8.5): the "csrf" case (a wrong value in X-Inherit-CSRF) is now "proof" (the same
 // wrong value in X-Inherit-Operation-Proof), the same refusal. Two cases are new: no proof at all,
 // and the right proof in the old header, X-Inherit-CSRF, alone ("the old position").
 it.each(["proof","missing-proof","proof-in-x-inherit-csrf","receipt","size","hash","actor","cookie","refused","lost-response"])("never ACKs or retries a %s mismatch",async fault=>{
  const f=fixture(),value=await delivered(f),{proof,...body}=value;let selected:string|null=proof,deps=f.deps,headers={};
  if(fault==="proof")selected="0".repeat(64);
  if(fault==="missing-proof")selected=null;
  if(fault==="proof-in-x-inherit-csrf"){selected=null;headers={"x-inherit-csrf":proof};}
  if(fault==="receipt")body.receipt=randomBytes(32).toString("base64url");
  if(fault==="size")body.sizeBytes=2;
  if(fault==="hash")body.sha256="0".repeat(64);
  if(fault==="actor")deps={...deps,actor:async()=>({...f.actor,sessionId:randomUUID()})};
  if(fault==="cookie")headers={cookie:`__Host-inherit-download=${randomBytes(32).toString("base64url")}`};
  if(fault==="refused")f.acknowledge.mockResolvedValue(false);
  if(fault==="lost-response")f.acknowledge.mockRejectedValue(new Error("synthetic-unknown-commit"));
  expect((await acknowledgeAccountArchiveChunk(f.post(body,selected,headers),f.params,deps))!.status).toBe(404);
  expect(f.acknowledge).toHaveBeenCalledTimes(["refused","lost-response"].includes(fault)?1:0);
 });
 it("bounds a stalled ACK body at one second and performs no native advancement",async()=>{
  vi.useFakeTimers();const f=fixture(),request=new Request(f.post({},"0".repeat(64)).url,{method:"POST",
   headers:f.post({},"0".repeat(64)).headers,body:new ReadableStream({start(){}}),duplex:"half"} as RequestInit);
  const result=acknowledgeAccountArchiveChunk(request,f.params,f.deps);
  await vi.advanceTimersByTimeAsync(1_001);expect((await result)!.status).toBe(404);expect(f.acknowledge).not.toHaveBeenCalled();
 });
 it("releases an invalid provider chunk and returns no bytes or receipt",async()=>{
  const f=fixture(),deps={...f.deps,read:async()=>({bytes:new Uint8Array([1]),release:f.release})};
  const result=(await getAccountArchiveChunk(f.get(),f.params,deps))!;
  expect(result.status).toBe(404);expect(result.headers.has("x-inherit-chunk-receipt")).toBe(false);expect(f.release).toHaveBeenCalledTimes(1);
 });
});

// Additive mixed-family controls exercise the real shared dispatchers. The
// native seam only selects a family; original reviewer auth/receipt checks run.
import * as accountChunk from "./account-archive-chunk-http";
import {GET as mixedDownloadGet} from "@/app/api/downloads/[session]/chunks/[sequence]/route";
import {POST as mixedDownloadAck} from "@/app/api/downloads/[session]/chunks/[sequence]/acknowledge/route";
import {DOWNLOAD_COOKIE} from "@/lib/future-person/review";
import {mintReceiptAckNonce,readReceiptAckNonce,chunkReceiptProof} from "@/lib/future-person/review-receipt";
import {mintSessionCsrf} from "@/lib/security/session-csrf-core";
vi.mock("@/lib/security/session-csrf",async importOriginal=>(await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

const legacy=vi.hoisted(()=>({account:vi.fn(),own:vi.fn(),admin:vi.fn(),store:vi.fn(),key:vi.fn(),open:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:legacy.account}));
vi.mock("@/lib/supabase/server",()=>({createClient:legacy.own}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:legacy.admin}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:()=>true}));
vi.mock("@/lib/future-person/appeals-open",()=>({testAppealIntakeOpen:()=>false}));
vi.mock("@/lib/future-person/claim-objects",()=>({supabaseClaimObjectStore:()=>({read:legacy.store}),
 supabaseAppealObjectStore:()=>({read:legacy.store})}));
vi.mock("@/lib/future-person/document-envelope",async original=>({...await original<typeof import("@/lib/future-person/document-envelope")>(),
 claimDataKey:legacy.key,openDocumentBytes:legacy.open}));
afterEach(()=>vi.restoreAllMocks());

function legacyRouteFixture(f:ReturnType<typeof fixture>){
 const rpc=vi.fn((name:string,args:unknown)=>{
  void args;
  const result=name==="authorize_claim_review_chunk_v1"
   ?{data:{objectKey:"synthetic-bound-claim-document",sha256:digest(f.bytes),byteCount:f.bytes.length,
    wrappedDataKey:"synthetic-wrapped-document-key"},error:null}
   :{data:true,error:null};
  const pending=Promise.resolve(result);
  return Object.assign(pending,{retry:vi.fn(()=>pending),abortSignal:vi.fn(()=>pending)});
 });
 legacy.account.mockReset().mockResolvedValue({user:{id:f.actor.accountId},sessionId:f.actor.sessionId});
 legacy.own.mockReset().mockResolvedValue({rpc});legacy.admin.mockReset().mockReturnValue({rpc});
 legacy.store.mockReset().mockImplementation(async()=>new Uint8Array([1,2,3]));
 legacy.key.mockReset().mockImplementation(()=>Buffer.alloc(32));
 legacy.open.mockReset().mockImplementation(()=>Buffer.from(f.bytes));
 vi.spyOn(accountChunk,"accountArchiveChunkDependencies").mockReturnValue(f.deps);
 return {rpc,context:{params:Promise.resolve(f.params)}};
}
/** 2026-11-22 (G8.5, owner decision "the reviewer chunk-acknowledgement address accepts either kind
 * of session"): the signed-in account's token for the route, which selects the TEST account archive's
 * branch (the pass-through gate hands the handler the session the real gate admits; the real gate is
 * driven in session-csrf-routes.test.ts and the route's own route.test.ts). Without one, the request
 * is the reviewer's. */
const accountToken=(f:ReturnType<typeof fixture>)=>mintSessionCsrf({kind:"authenticated",accountId:f.actor.accountId,
 sessionId:f.actor.sessionId},"api.claim-review-chunk-acknowledgement");

describe("mixed native account and original reviewer download families",()=>{
 it("keeps a genuine nonproduction reviewer GET in its original native-authorized byte dispatcher",async()=>{
  expect(DOWNLOAD_COOKIE).toBe("inherit-download");
  const f=fixture();f.context.mockResolvedValue(null);const original=legacyRouteFixture(f);
  const response=await mixedDownloadGet(f.get({cookie:`${DOWNLOAD_COOKIE}=${f.cookie}`}),original.context);
  expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes);
  expect(f.context).toHaveBeenCalledExactlyOnceWith({actor:f.actor,sessionId:f.session,downloadHash:null},expect.any(AbortSignal));
  expect(original.rpc.mock.calls.filter(([name])=>name==="authorize_claim_review_chunk_v1")).toHaveLength(2);
  for(const call of original.rpc.mock.calls)expect(call).toEqual(["authorize_claim_review_chunk_v1",
   {p_session_id:f.session,p_cookie_hash:f.downloadHash,p_sequence:0}]);
  expect(legacy.store).toHaveBeenCalledExactlyOnceWith("synthetic-bound-claim-document");
  expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
 });
 it("keeps a genuine nonproduction reviewer ACK in its unchanged bound receipt and native dispatcher",async()=>{
  expect(DOWNLOAD_COOKIE).toBe("inherit-download");
  const f=fixture();f.context.mockResolvedValue(null);const original=legacyRouteFixture(f);
  const nonce=mintReceiptAckNonce(f.session,0,f.downloadHash,f.actor.accountId,f.actor.sessionId);
  const nonceValue=readReceiptAckNonce(nonce,f.session,0,f.downloadHash,f.actor.accountId,f.actor.sessionId)!;
  // 2026-11-19 (G8.5, the migration stage): the reviewer's branch carries the reviewer's one-time token
  // (its gate is driven in session-csrf-routes.test.ts), where it carried the receipt digest.
  const proof=chunkReceiptProof("a".repeat(64),f.bytes),csrf="reviewer-session-token-checked-by-the-gate";
  const response=await mixedDownloadAck(f.post({nonce,proof},null,{cookie:`${DOWNLOAD_COOKIE}=${f.cookie}`,"x-inherit-csrf":csrf}),original.context);
  expect(response.status).toBe(204);expect((await response.arrayBuffer()).byteLength).toBe(0);
  // 2026-11-22 (G8.5, owner decision "the reviewer chunk-acknowledgement address accepts either kind
  // of session"). Old: the account archive's native discriminator was asked first and answered NULL,
  //   expect(f.context).toHaveBeenCalledExactlyOnceWith({actor:f.actor,sessionId:f.session,downloadHash:null},expect.any(AbortSignal));
  // New: the gate admitted a reviewer token, so only the reviewer's branch runs and the archive's
  // branch, its discriminator included, is never reached. Why: each branch runs only for its own
  // principal; an account target with a reviewer token is refused by the reviewer's own native
  // authorizer (route.test.ts), and an account token never reaches this branch (below).
  expect(f.context).not.toHaveBeenCalled();
  expect(original.rpc.mock.calls).toEqual([
   ["authorize_claim_review_chunk_v1",{p_session_id:f.session,p_cookie_hash:f.downloadHash,p_sequence:0}],
   ["acknowledge_claim_review_chunk_v1",{p_session_id:f.session,p_cookie_hash:f.downloadHash,p_sequence:0,
    p_proof:proof,p_nonce_hash:digest(Buffer.from(nonceValue))}],
  ]);
  expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();expect(legacy.store).not.toHaveBeenCalled();
 });
 it.each(["missing","wrong","duplicate","malformed","legacy-only"])("never falls through an actual account target with %s account cookie",async fault=>{
  const f=fixture();f.context.mockImplementation(async input=>{
   if(input.downloadHash!==f.downloadHash)throw new Error("account_archive_test_unavailable");
   return {sessionId:f.session,nextSequence:0,ready:f.ready};
  });const original=legacyRouteFixture(f);
  const cookie=fault==="missing"?"":fault==="wrong"?`__Host-inherit-download=${randomBytes(32).toString("base64url")}`:
   fault==="duplicate"?`__Host-inherit-download=${f.cookie}; __Host-inherit-download=${f.cookie}`:
   fault==="malformed"?"__Host-inherit-download=invalid":`inherit-download=${f.cookie}`;
  expect((await mixedDownloadGet(f.get({cookie}),original.context)).status).toBe(404);
  // 2026-11-22 (G8.5): the acknowledgement is the account's, so it carries the account's token in
  // X-Inherit-CSRF, and the 64-zero value moved to X-Inherit-Operation-Proof (it was X-Inherit-CSRF).
  expect((await mixedDownloadAck(f.post({nonce:"synthetic-unused",proof:"a".repeat(64)},"0".repeat(64),
   {cookie,"x-inherit-csrf":accountToken(f)}),original.context)).status).toBe(404);
  expect(f.context).toHaveBeenCalledTimes(2);expect(original.rpc).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
 });
 it("refuses a native context failure and a malformed non-NULL account frame instead of selecting the reviewer",async()=>{
  for(const mode of ["native-refusal","malformed-account"]){
   const f=fixture();if(mode==="native-refusal")f.context.mockRejectedValue(new Error("account_archive_test_unavailable"));
   else f.context.mockResolvedValue({sessionId:f.session,nextSequence:0,ready:{...f.ready,foreign:true}});
   const original=legacyRouteFixture(f);
   expect((await mixedDownloadGet(f.get(),original.context)).status).toBe(404);
   // 2026-11-22 (G8.5): with the account's token, as above.
   expect((await mixedDownloadAck(f.post({nonce:"synthetic-unused",proof:"a".repeat(64)},"0".repeat(64),
    {"x-inherit-csrf":accountToken(f)}),original.context)).status).toBe(404);
   expect(original.rpc).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
  }
 });
 it("refuses a replay after the exact account sequence advanced without selecting the legacy authority",async()=>{
  const f=fixture(),value=await delivered(f),{proof,...body}=value;let nextSequence=0;
  f.context.mockImplementation(async()=>({sessionId:f.session,nextSequence,ready:f.ready}));
  f.acknowledge.mockImplementation(async()=>{nextSequence++;return true;});const original=legacyRouteFixture(f);
  // 2026-11-22 (G8.5): the proof in X-Inherit-Operation-Proof and the account's token in X-Inherit-CSRF
  // (the gate here spends nothing, so the replay is refused by the archive's own sequence, as before).
  const token=accountToken(f);
  expect((await mixedDownloadAck(f.post(body,proof,{"x-inherit-csrf":token}),original.context)).status).toBe(204);
  expect((await mixedDownloadAck(f.post(body,proof,{"x-inherit-csrf":token}),original.context)).status).toBe(404);
  expect(f.acknowledge).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(1);expect(original.rpc).not.toHaveBeenCalled();
 });
 // 2026-11-22 (G8.5, owner decision "the reviewer chunk-acknowledgement address accepts either kind
 // of session"): each branch runs only for its own principal.
 it("never takes an account acknowledgement to the reviewer's branch, even where native names no account target",async()=>{
  const f=fixture();f.context.mockResolvedValue(null);const original=legacyRouteFixture(f);
  const nonce=mintReceiptAckNonce(f.session,0,f.downloadHash,f.actor.accountId,f.actor.sessionId);
  // A complete, valid reviewer acknowledgement in every other respect.
  const response=await mixedDownloadAck(f.post({nonce,proof:chunkReceiptProof("a".repeat(64),f.bytes)},null,
   {cookie:`${DOWNLOAD_COOKIE}=${f.cookie}`,"x-inherit-csrf":accountToken(f)}),original.context);
  expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not_found"});
  expect(f.context).toHaveBeenCalledTimes(1);expect(original.rpc).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
 });
 it("never takes a reviewer acknowledgement to the account archive's branch, even on an account target",async()=>{
  const f=fixture(),value=await delivered(f),{proof,...body}=value;const original=legacyRouteFixture(f);
  f.context.mockClear();f.read.mockClear();
  // The archive's complete acknowledgement, proof in its carrier, under no account token: the reviewer's.
  const response=await mixedDownloadAck(f.post(body,proof),original.context);
  expect(response.status).toBe(404);
  expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
 });
});
