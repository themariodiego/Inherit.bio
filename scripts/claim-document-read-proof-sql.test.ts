import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {claimDocumentReadProofSql} from "../e2e/helpers/claim-document-read-proof-sql";

const review="00000000-0000-4000-8000-000000000001",account="00000000-0000-4000-8000-000000000002";
describe("native current document read proof",()=>{
  it("passes the genuine selected document composite and refuses NULL instead of inventing a false result",()=>{
    const sql=claimDocumentReadProofSql(review,account);
    expect(sql).toContain(`private.claim_document_fully_read_v1('${review}'::uuid,'${account}'::uuid,d)`);
    expect(sql).toContain("from private.claim_documents d join private.claim_reviews c on c.photo_document_id=d.id");
    expect(sql).toContain("when true then 't' when false then 'f' else null end");
    expect(sql).not.toContain("::uuid,c.photo_document_id)");
  });
  it("requires a genuine current Auth, assignment, profile and originating-session receipt tuple",()=>{
    const sql=claimDocumentReadProofSql(review,account);
    for(const clause of ["auth.jwt()->>'aal'='aal2'","auth.jwt()->>'role'='authenticated'","s.user_id='"+account+"'::uuid",
      "s.not_after>clock_timestamp()","r.assignment_revision=a.assignment_revision","a.status='current'",
      "r.auth_session_id=s.id","r.account_auth_session_revision=p.auth_session_revision",
      "r.originating_session_revision=coalesce(s.refresh_token_counter,0)+1","r.document_sha256=d.sha256",
      "r.delivery_verified_at is not null","r.chunk_sequence=0","ceil(d.byte_count/4000000.0)::integer"])expect(sql).toContain(clause);
  });
  it.each(["",review+"'",review.toUpperCase().replace("0","A"),"00000000-0000-4000-0000-000000000001"])("refuses invalid scope %s",value=>{
    expect(()=>claimDocumentReadProofSql(value,account)).toThrow("Invalid synthetic review scope");
    expect(()=>claimDocumentReadProofSql(review,value)).toThrow("Invalid synthetic review scope");
  });
  it("plans exactly the same callee source before browsers without executing a fake fixture",()=>{
    const runner=readFileSync(new URL("./claim-review-fixture-sql.run.mts",import.meta.url),"utf8");
    expect(runner).toContain("claimDocumentReadProofSql(scope,");expect(runner).toContain("EXPLAIN (FORMAT JSON, COSTS OFF)");
    expect(runner).not.toMatch(/EXPLAIN\s*\([^)]*ANALYZE/u);expect(runner).toContain("plan.length === queries.length");
  });
  it("uses verified unedited SSR cookies and quiet bounded stdin, with only coded failures",()=>{
    const helper=readFileSync(new URL("../e2e/helpers/claim-document-read-proof.ts",import.meta.url),"utf8");
    expect(helper).toContain("auth.auth.getClaims()");expect(helper).toContain("JSON.stringify(claims)");
    expect(helper).toContain("begin read only");expect(helper).toContain('"-XAtq"');expect(helper).toContain("child.stdin.end(input)");
    expect(helper).toContain("15_000");expect(helper).toContain("65_536");expect(helper).not.toContain("--command");
    expect(helper).not.toMatch(/console\.|access_token|refresh_token|Buffer\.from\(.*base64url/u);
  });
});
