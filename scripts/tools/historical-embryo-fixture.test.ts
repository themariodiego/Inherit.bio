import {randomBytes} from "node:crypto";
import {afterAll,expect,it,vi} from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
const {mintEmbryoOperation,mintPublicFormToken}=await import("../../src/lib/embryos/operation-token");
const {verifiedHistoricalPair}=await import("./historical-embryo-fixture");
afterAll(()=>vi.unstubAllEnvs());
const embryo="85000000-0000-4000-8000-000000000001",other="85000000-0000-4000-8000-000000000002";
const accounts=["85000000-0000-4000-8000-000000000003","85000000-0000-4000-8000-000000000004"];
const sessions=["85000000-0000-4000-8000-000000000005","85000000-0000-4000-8000-000000000006"];
function parent(index:number,patch:Partial<Parameters<typeof mintEmbryoOperation>[0]>={},now=Date.now()){
  return {accountId:accounts[index],token:mintEmbryoOperation({accountId:accounts[index],sessionId:sessions[index],
    operation:"embryo_disposition",targetKind:"embryo",targetId:embryo,...patch},now)};
}
it("accepts only both actual current signed operation scopes and returns their inner one-use nonces",()=>{
  const input={embryoId:embryo,parents:[parent(0),parent(1)]};const result=verifiedHistoricalPair(input);
  expect(result.parents.map(p=>p.accountId)).toEqual(accounts);expect(result.parents.map(p=>p.sessionId)).toEqual(sessions);
  expect(result.parents.every(p=>/^[A-Za-z0-9_-]{32}$/u.test(p.nonce))).toBe(true);
  expect(result.parents[0].nonce).not.toBe(result.parents[1].nonce);expect(JSON.stringify(result)).not.toContain(input.parents[0].token);
});
it.each(["now","effectiveAt","transferredAt","clock","testMode"])("rejects caller %s without introducing an alternate-clock input",field=>{
  expect(()=>verifiedHistoricalPair({embryoId:embryo,parents:[parent(0),parent(1)],[field]:"2007-01-01"})).toThrow();
});
it.each(["cross-account","cross-target","cross-operation","cross-kind","expired","tampered","public-form","same-parent","same-session"])(
  "rejects %s rather than treating supplied SQL arguments as native authority",kind=>{
    const parents=[parent(0),parent(1)];
    if(kind==="cross-account")parents[0]=parent(0,{accountId:accounts[1]});
    if(kind==="cross-target")parents[0]=parent(0,{targetId:other});
    if(kind==="cross-operation")parents[0]=parent(0,{operation:"record_key_print"});
    if(kind==="cross-kind")parents[0]=parent(0,{targetKind:"cohort"});
    if(kind==="expired")parents[0]=parent(0,{},Date.now()-600_001);
    if(kind==="tampered")parents[0].token=`${parents[0].token[0]==="x"?"y":"x"}${parents[0].token.slice(1)}`;
    if(kind==="public-form")parents[0].token=mintPublicFormToken("future-person-claim");
    if(kind==="same-parent")parents[1]=parents[0];
    if(kind==="same-session")parents[1]=parent(1,{sessionId:sessions[0]});
    expect(()=>verifiedHistoricalPair({embryoId:embryo,parents})).toThrow();
  });
