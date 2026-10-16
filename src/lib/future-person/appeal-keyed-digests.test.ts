import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {keyedDigestSet} from "@/lib/hmac-keyring";
import {appealKeyedDigests} from "./appeal-keyed-digests";
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,89).toString("base64")));afterEach(()=>vi.unstubAllEnvs());
// AUTHORED UNRUN. Actual digest compatibility, secret ownership and cleanup
// are checked when run; no native keyring or deployment is impersonated.
describe("NEW appeal digests preserve the actual versioned layout",()=>{
 it.each(["contact","rate-limit"] as const)("matches all real %s digest revisions and clears NEW decoded roots",ring=>{
  const setting=`2:${Buffer.alloc(32,83).toString("base64")},3:${Buffer.alloc(32,97).toString("base64")}`;
  vi.stubEnv("INHERIT_HMAC_KEYRING",setting);const expected=keyedDigestSet(ring,"synthetic@example.test",setting),roots:Buffer[]=[];
  const original=Buffer.from;const spy=vi.spyOn(Buffer,"from").mockImplementation(((...args:unknown[])=>{
   const result=Reflect.apply(original,Buffer,args) as Buffer;if(args[1]==="base64"&&typeof args[0]==="string"&&setting.includes(args[0]))roots.push(result);return result;
  }) as typeof Buffer.from);
  try{expect(appealKeyedDigests(ring,"synthetic@example.test")).toEqual(expected);expect(roots).toHaveLength(2);expect(roots.every(root=>root.every(byte=>byte===0))).toBe(true);}
  finally{spy.mockRestore();}
 });
 it("refuses a repeated root/revision and clears roots already decoded before failure",()=>{
  const root=Buffer.alloc(32,83).toString("base64"),setting=`2:${root},3:${root}`;vi.stubEnv("INHERIT_HMAC_KEYRING",setting);
  const original=Buffer.from,roots:Buffer[]=[];const spy=vi.spyOn(Buffer,"from").mockImplementation(((...args:unknown[])=>{
   const result=Reflect.apply(original,Buffer,args) as Buffer;if(args[0]===root&&args[1]==="base64")roots.push(result);return result;
  }) as typeof Buffer.from);
  try{expect(()=>appealKeyedDigests("contact","synthetic@example.test")).toThrow("appeal_unavailable");
   expect(roots).toHaveLength(2);expect(roots.every(buffer=>buffer.every(byte=>byte===0))).toBe(true);}
  finally{spy.mockRestore();}
 });
 it("uses distinct operation dimensions with no raw identifier output",()=>{
  vi.stubEnv("INHERIT_HMAC_KEYRING","");const a=appealKeyedDigests("rate-limit","api.subject-access-request|normalized-identifier|synthetic@example.test");
  const b=appealKeyedDigests("rate-limit","api.future-person-claim|identifier|synthetic@example.test");expect(a).not.toEqual(b);
  expect(Object.values(a).every(value=>/^[0-9a-f]{64}$/u.test(value))).toBe(true);
 });
});
