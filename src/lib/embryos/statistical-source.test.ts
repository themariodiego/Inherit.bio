import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const old = readFileSync("supabase/migrations/20261002132000_embryo_observed_carrier_producer.sql", "utf8");
const next = readFileSync("supabase/migrations/20261010090000_embryo_test_statistical_coverage.sql", "utf8");
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
