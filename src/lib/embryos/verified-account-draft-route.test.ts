import crypto from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({account:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:m.account,isSameOrigin:()=>true}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock("./guards",async original=>({...await original<typeof import("./guards")>(),
 accountJurisdictionDenied:async()=>null,csrfOperation:()=>({nonce:"synthetic-current-draft-nonce"})}));
const {POST}=await import("@/app/api/embryo-cohort-drafts/route");
const {contactDigestSet}=await import("@/lib/hmac-keyring");
const {decryptSecret}=await import("@/lib/crypto");
const account=crypto.randomUUID(),session=crypto.randomUUID(),draft=crypto.randomUUID();
const owner="Synthetic-Owner@Example.invalid",other="synthetic-other@example.invalid";
const body={uploadSituation:"own-embryos",basis:"two-evidenced-parents",donorAttributionIntent:"none",embryoCount:2,
 otherRequiredPrincipalContacts:[other]};
function request(given:unknown=body){return new Request("https://inherit.bio/api/embryo-cohort-drafts",{method:"POST",
 headers:{origin:"https://inherit.bio","content-type":"application/json"},body:JSON.stringify(given)});}
beforeEach(()=>{
 vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
 vi.stubEnv("INHERIT_HMAC_KEYRING",`2:${crypto.randomBytes(32).toString("base64")}`);
 vi.clearAllMocks();m.account.mockResolvedValue({user:{id:account,email:owner,email_confirmed_at:"2026-01-01T00:00:00Z"},sessionId:session});
 m.rpc.mockResolvedValue({data:[{draft_id:draft,expires_at:"2026-11-01T00:00:00Z",required_principal_slots:["other-genetic-parent"]}],error:null});
});
afterEach(()=>vi.unstubAllEnvs());
it("sends only verified getUser email/current session to v2, preserving canonical response and held contact keys",async()=>{
 const response=await POST(request());expect(response.status).toBe(201);
 expect(await response.json()).toEqual({cohortDraftId:draft,state:"awaiting_uploader_artifacts",next:"sign_uploader_artifacts",
 requiredPrincipalSlots:["other-genetic-parent"],optionalAttributionSlots:[],expiresAt:"2026-11-01T00:00:00Z"});
 expect(m.rpc).toHaveBeenCalledTimes(1);const [name,args]=m.rpc.mock.calls[0]!;
 expect(name).toBe("create_embryo_cohort_draft_v2");expect(args.p_account_id).toBe(account);expect(args.p_session_id).toBe(session);
 expect(args.p_verified_auth_email).toBe(owner.toLowerCase());expect(args.p_owner_contact_hmac).toBeNull();
 expect(args.p_owner_contact_hmac_set).toEqual(contactDigestSet(owner.toLowerCase()));
 expect(args.p_contact_hmac_sets).toEqual([contactDigestSet(other)]);expect(args.p_token_nonce).toBe("synthetic-current-draft-nonce");
 expect(decryptSecret(Buffer.from(args.p_owner_contact_ciphertext.slice(2),"hex"))).toBe(owner.toLowerCase());
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([null,{user:{id:account,email:owner},sessionId:session},{user:{id:account,email_confirmed_at:"2026-01-01"},sessionId:session}])(
 "refuses absent or unconfirmed own Auth before any producer %#",async context=>{
 m.account.mockResolvedValue(context);expect((await POST(request())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();
});
it("refuses a browser-injected owner authority field instead of using it",async()=>{
 expect((await POST(request({...body,verifiedAuthEmail:other}))).status).toBe(422);expect(m.rpc).not.toHaveBeenCalled();
});
it.each(["42501","23505"])("preserves opaque canonical %s refusal",async code=>{
 m.rpc.mockResolvedValue({data:null,error:{code,message:"private authority detail"}});
 const response=await POST(request());expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not_found"});
});
