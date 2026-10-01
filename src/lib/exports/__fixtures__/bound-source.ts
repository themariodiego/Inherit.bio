import {createHash,randomUUID} from "node:crypto";
import {expect,vi} from "vitest";
import {createEmbryoFixtureSigner,createEmbryoFragmentGateway,EMBRYO_FIXTURE_ORIGIN,
 EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../../scripts/ci-browser/embryo-fragment-fixture";
import {copyRelocation,disposeRelocation,type RelocationTarget} from "@/lib/future-person/relocation-transport";
import type {BoundArchiveSourceRpc} from "../bound-account-source";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex"),signal=()=>new AbortController().signal;
export async function boundSourceFixture(payloads?:Uint8Array[]){
 const signer=createEmbryoFixtureSigner(),gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>gateway.fetch(input instanceof Request?input:new Request(input,init)));
 vi.stubGlobal("fetch",fetch);const accountId=randomUUID(),sessionId=randomUUID(),subjectId=randomUUID(),bindingId=randomUUID();
 const expiresAt=new Date(Date.now()+25000).toISOString(),bytes=payloads??[new TextEncoder().encode("# exact synthetic part1\n"),new TextEncoder().encode("1\t12\tA\tG\n")];
 const parts=[];
 for(const [sequence,data] of bytes.entries()){
  const oldKey=`embryo/${randomUUID()}`,stored=(await gateway.binding.put(oldKey,data,{sha256:sha(data)}))!,attemptId=randomUUID();
  const target:RelocationTarget={bindingId,relocationId:randomUUID(),attemptId,accountId,bucket:EMBRYO_FIXTURE_BUCKET,
   oldKey,oldVersion:stored.version,oldEtag:stored.etag,newKey:`claimant/${accountId}/${attemptId}`,
   byteCount:data.length,sha256:sha(data),expiresAt};
  const identity=await copyRelocation(target,signal());await disposeRelocation(target,"old",signal(),identity);
  parts.push({sequence,partId:randomUUID(),target,identity});
 }
 const manifest={version:"bound-future-person-canonical-source-v1",purpose:"approved-future-person-export-v1",
  actor:{accountId,sessionId,accountAuthSessionRevision:1,sessionRevision:1},bindingId,claimId:randomUUID(),claimantPrincipalId:randomUUID(),
  claimantRevision:1,releaseRevision:1,principalRevision:1,subjectId,subjectBindingRevision:1,subjectLifecycleRevision:1,
  fileId:randomUUID(),sourceSha256:sha(bytes[0]),membershipSha256:sha(bytes[1]),publicationRevision:1,
  byteCount:bytes.reduce((sum,p)=>sum+p.length,0),partCount:2,expiresAt,parts};
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const reply={version:"bound-account-archive-source-v1",...reference,source:manifest};
 const rpc=vi.fn<BoundArchiveSourceRpc>(async(name,args)=>{
  expect(name).toBe("export_archive_bound_source_v1");expect(args).toMatchObject({p_export_id:reference.exportId,
   p_attempt_id:reference.attemptId,p_authority_receipt:reference.authorityReceipt});
  if(args.p_operation==="check")expect(args.p_expected).toEqual(manifest);
  return {data:structuredClone(reply),error:null};
 });fetch.mockClear();return {gateway,reference,reply,manifest,bytes,fetch,rpc};
}
