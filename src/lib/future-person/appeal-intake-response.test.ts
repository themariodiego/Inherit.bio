import {readFileSync} from "node:fs";
import {NextRequest} from "next/server";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {appealIntakeJson} from "./appeal-intake-response";
import {mintAppealForm} from "./appeal-form";
import {POST} from "@/app/api/appeals/route";
import {proxy} from "@/proxy";
const register=JSON.parse(readFileSync("docs/route-register.json","utf8"));
function strict(response:Response){
 const sensitive=register.sensitiveResponseHeaders.authenticatedUserData,auth=register.sensitiveResponseHeaders.authOrRecovery;
 for(const [name,value] of Object.entries({...sensitive,...auth})){
  if(name==="Cache-Control"){expect(response.headers.get(name)).toBe("private, no-store");continue;}
  if(name==="Content-Security-Policy"){
   const actual=response.headers.get(name)!;const nonce=/script-src 'self' 'nonce-([A-Za-z0-9+/]+={0,2})'/u.exec(actual)?.[1];
   expect(nonce).toBeDefined();expect(Buffer.from(nonce!,"base64")).toHaveLength(16);
   expect(actual.replaceAll(nonce!,"{per-response-random-nonce}")).toBe(value);continue;
  }
  expect(response.headers.get(name)).toBe(value);
 }
}
beforeEach(()=>{vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64"));
 vi.stubEnv("NEXT_PUBLIC_APP_URL","https://inherit.example.test");vi.stubEnv("INHERIT_TEST_JURISDICTION","1");
 vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","1");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","");
 vi.stubEnv("INHERIT_HMAC_KEYRING","");});
afterEach(()=>vi.unstubAllEnvs());
function request(body:unknown){const form=mintAppealForm();return new Request("https://inherit.example.test/api/appeals",{method:"POST",
 headers:{origin:"https://inherit.example.test","sec-fetch-site":"same-origin","content-type":"application/json",
  "x-inherit-csrf":form.formToken,cookie:form.setCookie.split(";")[0]!},body:JSON.stringify(body)});}
// AUTHORED UNRUN. Inspect the real helper, actual route export and exact proxy
// response. Closed/native-config refusal performs no database/provider call.
describe("the registered appeal strict response header union",()=>{
 it.each([202,422,404])("applies the complete union to the real %s helper response",status=>strict(appealIntakeJson({synthetic:true},status)));
 it("creates a fresh response CSP nonce without relaxing the registered policy",()=>{
  const first=appealIntakeJson({},202),second=appealIntakeJson({},202);strict(first);strict(second);
  expect(first.headers.get("content-security-policy")).not.toBe(second.headers.get("content-security-policy"));
 });
 it("keeps the strict union on the real closed route refusal",async()=>{
  vi.stubEnv("INHERIT_TEST_JURISDICTION","0");const response=await POST(request({}));expect(response.status).toBe(404);strict(response);
 });
 it("keeps the strict union on the real invalid body route response",async()=>{
  const response=await POST(request({extra:"synthetic"}));expect(response.status).toBe(422);strict(response);
 });
 it("keeps the strict union on the real opaque route acceptance with native config absent",async()=>{
  const response=await POST(request({kind:"subject-objection",claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
   statement:"This is a synthetic own appeal statement for the test service.",affirmed:true}));
  expect(response.status).toBe(202);expect(await response.json()).toEqual({status:"received"});strict(response);
 });
 it("keeps the strict union on the actual account-free proxy forwarding response",async()=>{
  const response=await proxy(new NextRequest("https://inherit.example.test/api/appeals",{method:"POST"}));
  expect(response.headers.get("x-middleware-next")).toBe("1");strict(response);
 });
 it("keeps the strict union on the actual connection location proxy refusal",async()=>{
  const response=await proxy(new NextRequest("https://inherit.example.test/api/appeals",{method:"POST",headers:{"x-vercel-ip-country":"IR"}}));
  expect(response.status).toBe(451);expect(await response.json()).toEqual({error:"not_available_in_location"});strict(response);
 });
});
