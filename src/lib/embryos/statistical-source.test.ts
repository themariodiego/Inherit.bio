import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const old = readFileSync("supabase/migrations/20261002132000_embryo_observed_carrier_producer.sql", "utf8");
const next = readFileSync("supabase/migrations/20261010090000_embryo_test_statistical_coverage.sql", "utf8");
const fit = readFileSync("supabase/migrations/20261010155222_embryo_test_statistical_fit.sql", "utf8");
const capture = (source: string, family: string) => source.slice(source.indexOf(`create function private.capture_${family}_v1`))
  .split("end $capture$;")[0];
describe("native statistical source/authority boundary", () => {
  it("keeps every original parent/account/signature/source/QC predicate and lock exact", () => {
    const previous = capture(old, "embryo_carrier"), current = capture(next, "embryo_test_statistical").replaceAll("embryo_test_statistical", "embryo_carrier");
    const parents = (text: string) => text.slice(text.indexOf(" perform private.lock_invitation_transitions_v1();"), text.indexOf(" end loop;") + " end loop;".length);
    const sources = (text: string) => text.slice(text.indexOf(" for e in select *"), text.indexOf(" return jsonb_build_object('version'"));
    expect(parents(current)).toBe(parents(previous));expect(sources(current)).toBe(sources(previous));
    expect(current.indexOf("if v_admission is null")).toBeLessThan(current.indexOf("public.subjects where cohort_id"));
  });
  it("retains the complete carrier trigger branch and its immutability before the explicit new family", () => {
    const body = (source: string) => source.slice(source.indexOf("function private.guard_embryo_carrier_score_v1() returns trigger"))
      .split("$score_guard$")[1];
    const added = "\n if new.computation_receipt->>'producer'='embryo-test-score-coverage-v1' then\n  perform private.guard_embryo_test_statistical_score_v1(new);return new;end if;";
    expect(body(next).replace(added, "")).toBe(body(old));
    expect(next).toContain(createHash("md5").update(body(old)).digest("hex"));
    expect(next).not.toMatch(/disable trigger|setval|session_replication_role|grant .* on private\.embryo_test_statistical_admission/i);
  });
  it("binds full fixed panel bytes and keeps real compiled conditions empty", () => {
    const bytes = readFileSync("data/embryo/test-statistical-score-panel.json");
    expect(next).toContain(createHash("sha256").update(bytes).digest("hex"));
    expect(JSON.parse(next.split("$fixed_panel$")[1])).toEqual(JSON.parse(bytes.toString()));
    expect(JSON.parse(readFileSync("data/embryo/allowed_conditions.json", "utf8")).conditions).toEqual([]);
    expect(next).not.toMatch(/insert into (?:public\.)?(?:condition_registry|carrier_condition_reviews|carrier_conditions)/i);
  });
  it("requires admission at every native queue/current-source operation and independently recomputes the full save", () => {
    const worker = next.slice(next.indexOf("create function public.embryo_test_statistical_worker_v1"));
    expect(worker.indexOf("private.current_embryo_test_statistical_admission_v1() is null")).toBeLessThan(worker.indexOf("select * into j from public.worker_jobs"));
    expect(worker).toContain("p_payload->'measurements' is distinct from v_measurements");
    expect(worker).toContain("jsonb_array_length(a->'embryos')*jsonb_array_length(a->'conditions')");
    expect(worker).toContain("perform private.validate_sensitive_account_session_read_v1(p_account,p_session)");
    expect(worker).toContain("private.cohort_copilot_authority_v1(p_account,p_cohort)");
    expect(worker).toContain("score.computation_receipt is distinct from private.embryo_test_statistical_receipt_v1(j,e,c,expected)");
  });
  it("installs only after actual namespace/TLS/policy proof and before the test child, never fetches Docker Env", () => {
    const runtime = readFileSync("scripts/ci-browser-runtime.ts", "utf8"), installer = readFileSync("scripts/embryo-test-statistical-admission.ts", "utf8");
    expect(runtime.indexOf('ciRuntimeStep("policy-counters"')).toBeLessThan(runtime.indexOf("installEmbryoTestStatisticalAdmission(owner"));
    expect(runtime.indexOf("installEmbryoTestStatisticalAdmission(owner")).toBeLessThan(runtime.indexOf('return { env: { INHERIT_CI_BROWSER_RUNTIME: "ready"'));
    expect(installer).toMatch(/process\.env\.GITHUB_JOB === "browser"/);expect(installer).toContain("assertOwnedLinuxSource(operator");
    expect(installer).toContain('"--untracked-files=all"');expect(installer).not.toContain('"{{json .}}"');
    expect(installer).not.toMatch(/\{\{[^}]*\.Config\.Env/);
    expect(installer).toContain("exists(select 1 from auth.users)");expect(installer).toContain("pg_catalog.pg_control_system()");
  });
});

const body = (source: string, signature: string, delimiter: string) => {
  const start = source.indexOf(signature);expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start).split(`$${delimiter}$`)[1];
};
describe("separate fitted TEST native authority and saved read", () => {
  it("preserves the entire old admission body by removing only four new nullable columns from its projection", () => {
    const signature = "function private.current_embryo_test_statistical_admission_v1()";
    const previous = body(next, signature, "admission"), current = body(fit, signature, "admission");
    const projection = "return to_jsonb(a)-array['fit_artifact_sha256','fit_artifact','fit_package','fit_package_digest'];";
    expect(current.replace(projection, "return to_jsonb(a);")).toBe(previous);
    expect(fit).toContain(createHash("md5").update(previous).digest("hex"));
    expect(fit).not.toMatch(/insert into private\.embryo_test_statistical_admission|update private\.embryo_test_statistical_admission/i);
  });
  it("preserves the whole old immutable score guard and adds only a distinct fitted dispatch", () => {
    const signature = "function private.guard_embryo_carrier_score_v1() returns trigger";
    const previous = body(next, signature, "score_guard"), current = body(fit, signature, "score_guard");
    const branch = "\n if new.computation_receipt->>'producer'='embryo-test-statistical-fit-v1' then\n  perform private.guard_embryo_test_fit_score_v1(new);return new;end if;";
    expect(current.replace(branch, "")).toBe(previous);
    expect(fit).toContain(createHash("md5").update(previous).digest("hex"));
    expect(fit).not.toMatch(/disable trigger|session_replication_role|setval|insert into (?:public\.)?(?:condition_registry|carrier_condition_reviews|carrier_conditions)/i);
    expect(JSON.parse(readFileSync("data/embryo/allowed_conditions.json", "utf8")).conditions).toEqual([]);
  });
  it("delegates complete existing native capture before replacing only the fitted reference and version", () => {
    const current = body(fit, "function private.capture_embryo_test_statistical_fit_v1(", "fit_capture");
    expect(current).toContain("a:=private.capture_embryo_test_statistical_v1(p_cohort,p_test)");
    expect(current).toContain("jsonb_set(a,'{conditions,0,reference_receipt}',admission)");
    expect(current).not.toMatch(/jsonb_set\(a,'\{(?:authority|embryos|publicationRevision)/);
    expect(current.indexOf("private.current_embryo_test_fit_admission_v1()")).toBeLessThan(current.indexOf("private.capture_embryo_test_statistical_v1(p_cohort,p_test)"));
  });
  it("uses full fixed artifact bytes and complete native raw math with output-only fixed-nine encoding", () => {
    const artifact = readFileSync("data/embryo/test-statistical-fit-population.json");
    expect(JSON.parse(fit.split("$fixed_artifact$")[1])).toEqual(JSON.parse(artifact.toString()));
    expect(fit).toContain(createHash("sha256").update(artifact).digest("hex"));
    const raw = body(fit, "function private.embryo_test_fit_package_raw_v1(", "fit");
    expect(raw).toContain("p_artifact is distinct from private.embryo_test_fit_artifact_v1()");
    expect(raw).toContain("array[11,22]");expect(raw).toContain("array[10,10]");
    expect(raw).toContain("for k in 1..256 loop");expect(raw).toContain("residual_variance/53");
    expect(raw).not.toContain("private.embryo_test_fit_decimal_v1");
    const encoder = body(fit, "function private.embryo_test_fit_package_v1(", "canonical_package");
    expect(encoder).toContain("private.embryo_test_fit_package_raw_v1(p_artifact)");
    expect(encoder).toContain("private.embryo_test_fit_decimal_tree_v1(p#>path)");
  });
  it("requires actual native package/artifact equality before installing a fresh owner-only admission", () => {
    const installer = readFileSync("scripts/embryo-test-statistical-admission.ts", "utf8");
    expect(installer).toContain("canonicalStatisticalFitPackage");expect(installer).toContain("statisticalFitPackageDigest");
    expect(installer).toContain("private.embryo_test_fit_package_v1");
    expect(installer).toContain("private.embryo_test_fit_package_digest_v1");
    expect(installer).toContain("pg_catalog.pg_control_system()");
    expect(installer).not.toMatch(/update private\.embryo_test_statistical_admission|\{\{[^}]*\.Config\.Env/i);
    expect(installer).toContain("exists(select 1 from auth.users)");
  });
  it("recomputes every current own-call row and saves only exact full result equality through a claimed fitted job", () => {
    const worker = body(fit, "function public.embryo_test_statistical_fit_worker_v1(", "worker");
    expect(worker).toContain("j.computation_revision<>'embryo-test-statistical-fit-v1'");
    expect(worker).toContain("j.claim_token_hash is distinct from p_claim_token_hash");
    expect(worker).toContain("j.source_binding_revision is distinct from (a->>'publicationRevision')::bigint");
    expect(worker).toContain("jsonb_array_length(a->'embryos')*jsonb_array_length(a->'conditions')");
    expect(worker).toContain("expected:=private.expected_embryo_test_fit_measurement_v1(e,c)");
    expect(worker).toContain("p_payload->'measurements' is distinct from v_measurements");
    const guard = body(fit, "function private.guard_embryo_test_fit_score_v1(", "score_guard");
    expect(guard).toContain("p_score.computation_receipt is distinct from private.embryo_test_fit_receipt_v1(j,e,c,expected)");
    expect(guard).toContain("p_score.model_id is not null or p_score.model_version is not null");
    expect(guard).toContain("p_score.finding is distinct from nullif(expected->'finding','null'::jsonb)");
  });
  it("returns null only for absent fit admission/no fit job and refuses every current stale or denied result", () => {
    const current = body(fit, "function public.current_embryo_test_statistical_fit_v1(", "current_hold");
    expect(current.match(/return null;/g)).toHaveLength(2);
    expect(current).toContain("if private.current_embryo_test_fit_admission_v1() is null then return null;end if;");
    expect(current).toContain("perform private.validate_sensitive_account_session_read_v1(p_account,p_session)");
    expect(current).toContain("private.cohort_copilot_authority_v1(p_account,p_cohort)");
    expect(current).toContain("and computation_revision='embryo-test-statistical-fit-v1') then");
    expect(current).toContain("score.computation_receipt is distinct from private.embryo_test_fit_receipt_v1(j,e,c,expected)");
    expect(current).toContain("computation_receipt->>'job_id'=j.id::text)<>v_count then raise exception");
    expect(current).not.toMatch(/exception when insufficient_privilege then return null/);
  });
  it("keeps fitted public doors service-only and all arithmetic/capture/authority helpers denied", () => {
    for (const signature of ["enqueue_embryo_test_statistical_fit_v1(uuid,boolean)",
      "embryo_test_statistical_fit_worker_v1(text,uuid,integer,text,jsonb,boolean)",
      "current_embryo_test_statistical_fit_v1(uuid,uuid,uuid,boolean)"] ) {
      expect(fit).toContain(`revoke all on function public.${signature} from public,anon,authenticated,inherit_upload_only,service_role;`);
      expect(fit).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    for (const signature of ["current_embryo_test_fit_admission_v1()", "capture_embryo_test_statistical_fit_v1(uuid,boolean)",
      "evaluate_embryo_test_fit_v1(jsonb,jsonb,jsonb)", "embryo_test_fit_package_v1(jsonb)"])
      expect(fit).toContain(`revoke all on function private.${signature} from public,anon,authenticated,inherit_upload_only,service_role;`);
    expect(fit).not.toMatch(/grant execute on function private\.(?:current_embryo_test_fit_admission|capture_embryo_test_statistical_fit|evaluate_embryo_test_fit|embryo_test_fit_package)_v1/);
  });
  it("persists no new personal table and retains existing whole-row export/erasure classes", () => {
    expect(fit).not.toMatch(/create table/i);
    const plan = JSON.parse(readFileSync("docs/export-member-plan.json", "utf8"));
    expect(plan.tables["private.embryo_test_statistical_admission"].disposition).toBe("excluded-protected");
    expect(plan.tables["public.worker_jobs"].disposition).toBe("excluded-internal");
    expect(plan.tables["public.embryo_scores"].reason).toContain("whole score rows");
    expect(plan.tables["public.embryo_scores"].reason).toContain("whole-row erasure");
    const receipt = body(fit, "function private.embryo_test_fit_receipt_v1(", "saved_receipt");
    expect(receipt).toContain("'source',p_embryo->'source'");expect(receipt).not.toContain("'authority'");
  });
});
