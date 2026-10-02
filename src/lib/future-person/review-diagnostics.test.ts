import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {reviewRefusal} from "./review-diagnostics";
import {REVIEW_DIAGNOSTIC_PREFIX,reviewDiagnosticLine,reviewDiagnosticStages} from "./review-diagnostic-contract";
import {profileDiagnosticFilter} from "../../../scripts/ci-browser/profile-diagnostic-filter";
beforeEach(()=>vi.spyOn(console,"warn").mockImplementation(()=>{}));
afterEach(()=>vi.restoreAllMocks());
it.each(reviewDiagnosticStages)("emits only the fixed stage %s and approved SQLSTATE",stage=>{
 reviewRefusal(stage,{code:"42501",message:"private error",details:"private contact",hint:"private key"});
 expect(console.warn).toHaveBeenCalledExactlyOnceWith(REVIEW_DIAGNOSTIC_PREFIX+JSON.stringify({stage,code:"42501"}));
});
it.each([undefined,{code:"private@example.invalid"},Object.defineProperty({},"code",{get(){throw new Error("private");}})])(
 "unknown and throwing RPC error values emit no error text %#",error=>{
 reviewRefusal("decision-rpc",error);expect(console.warn).toHaveBeenCalledExactlyOnceWith(
 REVIEW_DIAGNOSTIC_PREFIX+JSON.stringify({stage:"decision-rpc",code:"unavailable"}));
});
it.each([{stage:"private-id",code:"42501"},{stage:"decision-rpc",code:"private-key"},
 {stage:"decision-rpc",code:"42501",id:"private-id"},{stage:"decision-rpc",code:"42501",toJSON:()=>"private-key"}])(
 "rejects any unregistered stage/code/extra payload %#",value=>expect(reviewDiagnosticLine(value)).toBeNull());
it("preserves canonical byte framing through the existing bounded two-hop filter without widening raw log access",()=>{
 const line=reviewDiagnosticLine({stage:"decision-rpc",code:"42501"})!,emit=vi.fn(),filter=profileDiagnosticFilter(emit);
 filter.write("private auth cookie\n"+REVIEW_DIAGNOSTIC_PREFIX+'{"stage":"decision-rpc","code":"private","code":"42501"}\n');
 filter.write(line.slice(0,10));filter.write(line.slice(10)+"\n");filter.end();expect(emit.mock.calls).toEqual([[line]]);
});
it("a failed fixed diagnostic sink never alters route refusal",()=>{
 vi.mocked(console.warn).mockImplementation(value=>{if(typeof value==="string"&&value.startsWith(REVIEW_DIAGNOSTIC_PREFIX))throw new Error("sink unavailable");});expect(()=>reviewRefusal("nonce")).not.toThrow();
});
