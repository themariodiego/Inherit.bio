import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {APPEAL_FORM_COOKIE,mintAppealForm,readAppealForm} from "./appeal-form";
import {parseUniqueAppealObject,readAppealIntakeJson} from "./appeal-intake-json";
import {createAppealIntakeRuntime} from "./appeal-intake-runtime";
beforeEach(()=>{vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,89).toString("base64"));vi.stubEnv("NEXT_PUBLIC_APP_URL","https://inherit.example.test");});
afterEach(()=>vi.unstubAllEnvs());
function request(token:string,cookie:string,extra:Record<string,string>={}){return new Request("https://inherit.example.test/api/appeals",{method:"POST",
 headers:{origin:"https://inherit.example.test","sec-fetch-site":"same-origin","content-type":"application/json","x-inherit-csrf":token,cookie,...extra}});}
// SOURCE-AUTHORED, UNRUN. Actual token/JSON/stream code is used. Native nonce
// consumption, current ownership, browser transport and release need proofs.
describe("non-authorizing NEW appeal form",()=>{
 it("accepts only the exact canonical origin, fresh token and one matching browser cookie",()=>{
  const now=Date.now(),form=mintAppealForm(now),cookie=form.setCookie.split(";")[0]!;
  expect(readAppealForm(request(form.formToken,cookie),now)?.nonceHash).toMatch(/^[0-9a-f]{64}$/u);
  expect(readAppealForm(request(form.formToken,cookie,{origin:"https://other.example.test"}),now)).toBeNull();
  expect(readAppealForm(request(form.formToken,cookie,{"sec-fetch-site":"cross-site"}),now)).toBeNull();
  expect(readAppealForm(request(form.formToken,`${cookie}; ${cookie}`),now)).toBeNull();
  expect(readAppealForm(request(form.formToken,cookie),now+600_001)).toBeNull();
 });
 it("keeps the current cookie on prefetch without treating it as case authority",()=>{
  const secret="A".repeat(43),form=mintAppealForm(Date.now(),secret);expect(form.setCookie.startsWith(`${APPEAL_FORM_COOKIE}=${secret};`)).toBe(true);
  const other=mintAppealForm();expect(readAppealForm(request(form.formToken,other.setCookie.split(";")[0]!))).toBeNull();
 });
 it("refuses repeated decoded keys, arrays, nested authority, trailing tokens and malformed JSON",()=>{
  expect(parseUniqueAppealObject('{"kind":"subject-objection","affirmed":true}')).toEqual({kind:"subject-objection",affirmed:true});
  for(const raw of ['{"kind":"subject-objection","kind":"genetic-parent-objection"}',
   '{"kind":"a","\\u006bind":"b"}','[]','{"reviewer":{"approved":true}}','{"affirmed":true,}','{"affirmed":true}{}'])
   expect(parseUniqueAppealObject(raw)).toBeNull();
 });
 it("clears actual consumed request chunks and rejects an oversized body",async()=>{
  const chunk=new TextEncoder().encode('{"kind":"subject-objection","affirmed":true}');
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(chunk);controller.close();}});
  const req=new Request("https://inherit.example.test/api/appeals",{method:"POST",body,duplex:"half"} as RequestInit);
  const owner=createAppealIntakeRuntime(req.signal);
  try{expect(await readAppealIntakeJson(req,owner)).toEqual({kind:"subject-objection",affirmed:true});expect(chunk.every(value=>value===0)).toBe(true);}
  finally{await owner.finish();}
  const oversized=new Uint8Array(64*1024+1).fill(47),large=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(oversized);}});
  const largeRequest=new Request("https://inherit.example.test/api/appeals",{method:"POST",body:large,duplex:"half"} as RequestInit);
  const largeOwner=createAppealIntakeRuntime(largeRequest.signal);
  try{expect(await readAppealIntakeJson(largeRequest,largeOwner)).toBeNull();}finally{await largeOwner.finish();}
  expect(oversized.every(value=>value===0)).toBe(true);
 });
});
