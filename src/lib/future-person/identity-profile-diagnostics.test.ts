import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {profileProofFailure,profileRpcFailure,profileSchemaFailure} from "./identity-profile-diagnostics";

beforeEach(()=>vi.spyOn(console,"warn").mockImplementation(()=>{}));
afterEach(()=>vi.restoreAllMocks());
it.each(["42501","40P01","57014","PGRST202"])("records only the fixed approved RPC code %s",code=>{
  profileRpcFailure({code,message:"protected message",details:"protected payload",hint:"protected contact"});
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"rpc",code});
});
it.each([undefined,"protected code",{code:"private@example.test",message:"protected"},
  new Error("protected error")])("suppresses every unapproved RPC error value %#",error=>{
  profileRpcFailure(error);
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"rpc",code:"unavailable"});
});
it("does not inspect or serialize error properties other than the allowlisted code",()=>{
  const error=Object.defineProperties({}, {code:{get(){throw new Error("protected code getter");}},
    message:{get(){throw new Error("protected message getter");}},details:{get(){throw new Error("protected details getter");}}});
  profileRpcFailure(error);
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"rpc",code:"unavailable"});
});
it("records only fixed schema field names with an anonymous array position",()=>{
  profileSchemaFailure([{code:"invalid_format",path:["items",19,"deleteContext","currentProfileId"]},
    {code:"custom",path:["items",0]}, {code:"unrecognized_keys",path:[]}]);
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"schema",issues:[
    {code:"invalid_format",field:"items.*.deleteContext.currentProfileId"},{code:"custom",field:"items.*"},
    {code:"unrecognized_keys",field:"inventory"},
  ]});
});
it("refuses unknown path names, symbol paths, oversized paths and issue codes without exposing them",()=>{
  const extra={message:"protected message",keys:["private@example.test"],input:"protected input"};
  profileSchemaFailure([{code:"unrecognized_keys",path:["items",0,"private@example.test"],...extra},
    {code:"invalid_type",path:[Symbol("protected symbol")]},
    {code:"custom",path:["items",0,"saveContext","subjectId","subjectId","subjectId"]},
    {code:"protected code",path:["items",0,"expiresAt"]}]);
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"schema",issues:[
    {code:"unrecognized_keys",field:"other"},{code:"invalid_type",field:"other"},
    {code:"custom",field:"other"},{code:"unavailable",field:"items.*.expiresAt"},
  ]});
});
it("bounds the emitted issue count without serializing a larger error",()=>{
  profileSchemaFailure(Array.from({length:100},()=>({code:"custom",path:["items",0]})));
  expect(vi.mocked(console.warn).mock.calls[0][1]).toEqual({stage:"schema",issues:Array.from({length:8},()=>({code:"custom",field:"items.*"}))});
});
it("emits a fixed proof failure without accepting any thrown payload",()=>{
  profileProofFailure();
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("identity_profile_controls_unavailable",{stage:"proof",code:"unavailable"});
});
it("a failed logging sink cannot alter a refusal",()=>{
  vi.mocked(console.warn).mockImplementation(event=>{
    if(event==="identity_profile_controls_unavailable")throw new Error("log unavailable");
  });
  expect(()=>profileRpcFailure()).not.toThrow();expect(()=>profileSchemaFailure([{code:"custom",path:[]}])).not.toThrow();
  expect(()=>profileProofFailure()).not.toThrow();
});
