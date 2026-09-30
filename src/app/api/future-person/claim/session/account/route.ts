import {bindingBody,bindingRequestHash,currentBindingContext,readBindingNonce} from "@/lib/future-person/account-binding";
import {claimantNotFound,claimantResponse} from "@/lib/future-person/rights";
import {readBoundedJson} from "@/lib/future-person/bounded-body";
import {RIGHTS_COOKIE_NAME} from "@/lib/embryos/rights-session";
export async function POST(request:Request) {
 const hash=bindingRequestHash(request);if(!hash)return claimantNotFound();
 const parsed=bindingBody.safeParse(await readBoundedJson(request,4096));if(!parsed.success)return claimantNotFound();
 const actor=await currentBindingContext(hash);if(!actor)return claimantNotFound();
 const nonce=readBindingNonce(parsed.data.nonce,hash,actor.context);if(!nonce)return claimantNotFound();
 const {data,error}=await actor.client.rpc("bind_future_person_account_v1",{p_rights_session_hash:hash,p_nonce:nonce,p_expected:actor.context});
 if(error||data!==true)return claimantNotFound();
 const response=await claimantResponse("api.future-person-claimant-bind",["status"],{status:"account_bound"},200);
 response.headers.append("set-cookie",`${RIGHTS_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${process.env.NODE_ENV==="production"?"; Secure":""}`);
 return response;
}
