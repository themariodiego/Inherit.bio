import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {sealNewAppeal,openNewAppealDeliveryContact} from "./appeal-case-envelope";
import {readNewPublicAppealMailContact} from "./new-public-appeal-mail";
import type {Json} from "@/lib/supabase/types";
const id=(n:number)=>`86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={version:1 as const,caseKind:"appeal" as const,caseId:id(1),originalAuthorPrincipalId:id(2),
 initialStatementRevision:1 as const,originalSubmittedAt:"2026-10-09T20:00:00Z",originalDeadline:"2026-11-08T20:00:00Z",
 intakeKind:"subject-objection" as const};
const body={kind:"subject-objection" as const,claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
 statement:"A synthetic request statement kept entirely in its encrypted case.",affirmed:true as const};
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,87).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 const envelope=sealNewAppeal(scope,body),projection={scope,caseContactId:id(3),wrappedCaseKeyHex:envelope.wrappedCaseKeyHex,
  contactCiphertextHex:envelope.contactCiphertextHex};
 const abortSignal=vi.fn(async():Promise<{data:Json|null;error:unknown}>=>({data:projection,error:null})),
  retry=vi.fn(()=>({abortSignal})),rpc=vi.fn(()=>({retry}));
 return {envelope,projection,abortSignal,retry,rpc,native:{rpc},signal:new AbortController().signal};
}
describe("exact anonymous appeal delivery contact",()=>{
 it("opens only the actual bound case contact through the dedicated no-retry native door",async()=>{
  const f=fixture();expect(await readNewPublicAppealMailContact(f.native,id(4),1,f.envelope.contactCiphertextHex,f.signal))
   .toBe(body.contactEmail);
  expect(f.rpc).toHaveBeenCalledWith("read_new_public_appeal_mail_contact_v1",{p_outbox_id:id(4),p_attempt_ordinal:1});
  expect(f.retry).toHaveBeenCalledOnce();expect(f.retry).toHaveBeenCalledWith(false);
  expect(f.abortSignal).toHaveBeenCalledWith(f.signal);
 });
 it.each(["scope","ciphertext","key","error","extra-field"])("refuses a changed %s without contact fallback",async fault=>{
  const f=fixture();
  if(fault==="scope")f.projection.scope={...scope,originalAuthorPrincipalId:id(99)};
  if(fault==="ciphertext")f.projection.contactCiphertextHex="ab".repeat(48);
  if(fault==="key")f.projection.wrappedCaseKeyHex="ab".repeat(72);
  if(fault==="extra-field")Object.assign(f.projection,{accountId:id(99)});
  if(fault==="error")f.abortSignal.mockResolvedValue({data:f.projection,error:{code:"unavailable"}});
  await expect(readNewPublicAppealMailContact(f.native,id(4),1,f.envelope.contactCiphertextHex,f.signal)).rejects.toThrow();
 });
 it("refuses true cancellation before any native read",async()=>{
  const f=fixture(),stop=new AbortController();stop.abort();
  await expect(readNewPublicAppealMailContact(f.native,id(4),1,f.envelope.contactCiphertextHex,stop.signal)).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
 });
 it("never opens review working bytes as a contact or supports the authenticated suspension branch",()=>{
  const f=fixture();expect(()=>openNewAppealDeliveryContact(scope,f.envelope.wrappedCaseKeyHex,f.envelope.workingCiphertextHex)).toThrow();
  expect(()=>openNewAppealDeliveryContact({...scope,intakeKind:"contradiction-suspension-appeal"},
   f.envelope.wrappedCaseKeyHex,f.envelope.contactCiphertextHex)).toThrow();
 });
});
