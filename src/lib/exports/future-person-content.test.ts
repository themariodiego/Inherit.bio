import { createHash,randomBytes } from "node:crypto";
import { afterEach,describe,expect,it,vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { futurePersonExportContent,projectFuturePersonAgreements,renderFuturePersonAgreement,type FuturePersonExportRpc } from "./future-person-content";

const HASH="a".repeat(64),ID="38000000-0000-4000-8000-000000000001",OTHER="38000000-0000-4000-8000-000000000002";
const DATE="2026-09-30T20:00:00.000Z";
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
function agreements(){
  vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
  return ["consent.upload-embryo","charter.future-person"].map(artifactKey=>{
    const bodyMarkdown=`Synthetic signed ${artifactKey}`,sha=createHash("sha256").update(bodyMarkdown).digest("hex");
    return {version:"future-person-agreement-v2",artifactKey,artifactVersion:1,bodySha256:sha,recomputedBodySha256:sha,
      bodyMarkdown,statementKeys:["individually-affirmed"],signedAt:DATE,
      signaturePurpose:artifactKey==="consent.upload-embryo"?"embryo-upload-parent-class":"future-person-charter-acknowledgement",
      recordedRole:artifactKey==="consent.upload-embryo"?"parent":"owner",signingNameCiphertext:encryptSecret("Historical synthetic signer").toString("hex"),
      signaturePrincipalPseudonym:HASH,jurisdictionCode:"GB",jurisdictionRevision:2,
      attestations:[{kind:"genetic_parent",statementKeys:["recorded-parent"],affirmed:true,revision:1,affirmedAt:DATE}],
      review:{kind:"approve-record-key",decidedAt:DATE,outcome:"approved",reviewerPrincipalPseudonym:"b".repeat(64)}};
  });
}
function fixture(){
  const snapshot={authority:{principalId:ID,subjectId:OTHER,originBinding:HASH,authorityReceipt:HASH,lifecycleRevision:3,
    bindingRevision:4,credentialRevision:5,expiresAt:new Date(Date.now()+60_000).toISOString()},
    source:{fileId:ID,subjectId:OTHER,referenceBuild:"GRCh38",sourceSha256:HASH,membershipSha256:HASH,publicationRevision:1,
      variantCount:2,publishedAt:DATE},membership:{variants:2,qualityReports:1,scores:0,figures:0,reports:0,agreements:2,legalAuditEvents:0},legalAudit:{attribution:"assigned",attributionStartedAt:DATE}};
  const row=(id:string)=>({id,chromosome:1,position:1000,referenceAllele:"A",alternateAllele:"G",genotype:"A/G"});
  const responses=[{rows:[row("9007199254740992")],nextAfterId:"9007199254740992",count:1},
    {rows:[row("9007199254740993")],nextAfterId:"9007199254740993",count:1},{rows:[],nextAfterId:null,count:0}];
  const rpc=vi.fn<FuturePersonExportRpc>(async(_,args)=>({data:args.p_operation==="capture"?structuredClone(snapshot):responses.shift(),error:null}));
  const abort=new AbortController();const content=futurePersonExportContent(rpc,HASH,{signal:abort.signal,deadline:Date.now()+60_000});
  return {snapshot,responses,rpc,abort,content,row};
}
describe("genuine historical claimant agreements",()=>{
  it("decrypts only recorded signature bytes and recomputes each exact signed body",()=>{
    const source=agreements(),result=projectFuturePersonAgreements(source);
    expect(result).toHaveLength(2);expect(result[0].signingName).toBe("Historical synthetic signer");
    expect(result[0].recordedRoleKinds).toEqual(["genetic_parent"]);expect(result[0].review).toEqual(source[0].review);
    expect(renderFuturePersonAgreement(result[0])).toContain("Signed by: Historical synthetic signer");
    expect(renderFuturePersonAgreement(result[0])).toContain(source[0].bodyMarkdown);
    expect(result[0]).not.toHaveProperty("signingNameCiphertext");expect(source[0].signingNameCiphertext).toBeTruthy();
  });
  it("preserves the exact newly recorded final keyless decision without relabeling earlier history",()=>{
    const source=agreements();for(const row of source)row.review.kind="approve-release";
    const projected=projectFuturePersonAgreements(source);expect(projected.map(row=>row.review.kind)).toEqual(["approve-release","approve-release"]);
    expect(renderFuturePersonAgreement(projected[0])).toContain(`Recorded review: approve-release; approved; ${DATE}`);
    for(const kind of ["keyless-document-match","overrule-objection","refuse-release","invented-approval"]){
      const malformed=structuredClone(source);malformed[0].review.kind=kind;expect(()=>projectFuturePersonAgreements(malformed)).toThrow("export unavailable");
    }
  });
  it.each(["changed-body","changed-signed-digest","missing-signing-name","wrong-key","missing-role","unaffirmed-role","current-profile","duplicate-artifact","swapped-artifact-role"])("refuses %s without a current identity fallback",kind=>{
    const source=agreements();
    switch(kind){
      case "changed-body":source[0].bodyMarkdown+=" altered";break;
      case "changed-signed-digest":source[0].bodySha256=HASH;break;
      case "missing-signing-name":source[0].signingNameCiphertext="";break;
      case "wrong-key":vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));break;
      case "missing-role":source[0].recordedRole="invented";break;
      case "unaffirmed-role":source[0].attestations[0].affirmed=false;break;
      case "current-profile":Object.assign(source[0],{currentProfileName:"invented"});break;
      case "duplicate-artifact":source[1].artifactKey=source[0].artifactKey;break;
      case "swapped-artifact-role":source[1].signaturePurpose=source[0].signaturePurpose;source[1].recordedRole="parent";break;
    }
    expect(()=>projectFuturePersonAgreements(source)).toThrow("export unavailable");
  });
});
describe("live exact claimant source pages",()=>{
  it("reads the complete ordered source without lossy bigint cursors or selectors",async()=>{
    const f=fixture();expect(await f.content.capture()).toEqual(f.snapshot);
    const rows=[];for await(const page of f.content.variants())rows.push(...page);
    expect(rows.map(row=>row.id)).toEqual(["9007199254740992","9007199254740993"]);
    expect(f.rpc.mock.calls.filter(call=>call[1].p_operation==="variants").map(call=>call[1].p_after_variant_id))
      .toEqual([null,"9007199254740992","9007199254740993"]);
    for(const [,args] of f.rpc.mock.calls){expect(Object.keys(args).sort()).toEqual(["p_after_variant_id","p_authority_receipt","p_operation","p_session_hash"]);}
  });
  it.each(["truncated","duplicate","cross-subject","changed-receipt","count-lie","cursor-lie","extra-field","non-autosomal"])("refuses %s before a partial source can complete",async(kind)=>{
    const f=fixture();await f.content.capture();
    switch(kind){
      case "truncated":f.responses.splice(1,1);break;
      case "duplicate":f.responses[1]={rows:[f.row("9007199254740992")],nextAfterId:"9007199254740992",count:1};break;
      case "cross-subject":f.snapshot.authority.subjectId=ID;break;
      case "changed-receipt":f.snapshot.authority.authorityReceipt="b".repeat(64);break;
      case "count-lie":f.responses[0].count=2;break;
      case "cursor-lie":f.responses[0].nextAfterId="99";break;
      case "extra-field":Object.assign(f.responses[0].rows[0],{parentGenotype:"C/C"});break;
      case "non-autosomal":f.responses[0].rows[0].chromosome=23;break;
    }
    await expect((async()=>{for await(const _page of f.content.variants()){void _page;}})()).rejects.toThrow("export unavailable");
  });
  it("rechecks after a source page and refuses revocation before yielding buffered calls",async()=>{
    const f=fixture();await f.content.capture();let read=false;
    f.rpc.mockImplementation(async(_,args)=>{
      if(args.p_operation==="variants"){read=true;return {data:f.responses[0],error:null};}
      return read?{data:null,error:{code:"42501"}}:{data:structuredClone(f.snapshot),error:null};
    });
    await expect(f.content.variants().next()).rejects.toThrow("export unavailable");
  });
  it("bounds a provider ignoring cancellation and accepts no late authority",async()=>{
    vi.useFakeTimers();const f=fixture();f.rpc.mockImplementation(()=>new Promise(()=>{}));
    const pending=f.content.capture();const proof=expect(pending).rejects.toThrow("export unavailable");
    await vi.advanceTimersByTimeAsync(30_001);await proof;
    expect(f.rpc.mock.calls[0][2].aborted).toBe(true);
  });
  it("refuses an already canceled origin before any RPC",async()=>{
    const f=fixture();f.abort.abort();await expect(f.content.capture()).rejects.toThrow("export unavailable");expect(f.rpc).not.toHaveBeenCalled();
  });
});
