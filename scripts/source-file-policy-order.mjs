/** Execute the actual pending policy guard against both reviewed predecessors.
 * Local Docker only. Every planted catalog change is rolled back, including
 * each probe's DDL; no application rows, grants or migration ledger survive. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--project"), "Unknown arguments");
const project = args[1] ?? readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project && /^[A-Za-z0-9_-]+$/.test(project), "A local Supabase project ID is required");
const source = readFileSync(new URL("../supabase/migrations/20260930123000_embryo_canonical_sources.sql", import.meta.url), "utf8");
const guards = source.match(/do \$canonical_owner_policy\$[\s\S]*?\$canonical_owner_policy\$;/g);
assert.equal(guards?.length, 1, "The exact canonical policy guard must be present once");
const guard = guards[0];
const privacySource = readFileSync(new URL("../supabase/migrations/20261001031000_source_file_owner_privacy.sql", import.meta.url), "utf8");
const privacyGuards = privacySource.match(/do \$privacy\$[\s\S]*?\$privacy\$;/g);
assert.equal(privacyGuards?.length, 1, "The exact final privacy guard must be present once");
const privacyGuard = privacyGuards[0];
const sourceTag = `source_${createHash("sha256").update(guard + privacyGuard).digest("hex").slice(0, 16)}`;
assert(!(guard + privacyGuard).includes(`$${sourceTag}$`));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const pathB = "alter policy genome_files_select_own on public.genome_files to authenticated using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(id));";
const composed = "alter policy genome_files_select_own on public.genome_files to authenticated using(user_id=(select auth.uid()) and private.genome_file_owner_listable_v1(id) and not private.is_path_b_file_v1(id));";
const probes = [
  ["already deployed Path B refusal gains the canonical refusal atomically", "", "path-b"],
  ["fresh legacy owner policy gains the canonical refusal", "drop policy genome_files_select_own on public.genome_files; drop function private.is_path_b_file_v1(uuid) cascade; create policy genome_files_select_own on public.genome_files for select using((select auth.uid())=user_id);", "canonical"],
  ["an overwritten Path B policy is refused", "alter policy genome_files_select_own on public.genome_files using((select auth.uid())=user_id);", "unexpected canonical Path B predecessor"],
  ["an extra policy role is refused", "alter policy genome_files_select_own on public.genome_files to authenticated,anon;", "unexpected canonical Path B predecessor"],
  ["a permissive sibling read policy is refused", "create policy planted_extra_read on public.genome_files to authenticated using(true);", "unexpected canonical owner policy"],
  ["disabled RLS is refused", "alter table public.genome_files disable row level security;", "unexpected canonical owner policy"],
  ["changed helper source is refused", "create or replace function private.is_path_b_file_v1(p_file_id uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$;", "unexpected canonical Path B helper"],
  ["changed helper attributes are refused", "alter function private.is_path_b_file_v1(uuid) cost 101;", "unexpected canonical Path B helper"],
  ["an extra helper execution grant is refused", "grant execute on function private.is_path_b_file_v1(uuid) to service_role;", "unexpected canonical Path B helper"],
  ["final privacy composes the exact old Path B predecessor", "", "path-b", "privacy"],
  ["final privacy preserves an already composed policy byte for byte", composed, "unchanged-composed", "privacy"],
  ["final privacy refuses an embryo-only predecessor", "alter policy genome_files_select_own on public.genome_files using((select auth.uid())=user_id and private.genome_file_owner_listable_v1(id));", "unexpected source file policy predecessor", "privacy"],
  ["final privacy refuses an extra role", "alter policy genome_files_select_own on public.genome_files to authenticated,anon;", "unexpected source file policy", "privacy"],
  ["final privacy refuses changed canonical helper attributes", "alter function private.genome_file_owner_listable_v1(uuid) cost 101;", "unexpected source file policy helper", "privacy"],
  ["final privacy refuses changed Path B helper grants", "grant execute on function private.is_path_b_file_v1(uuid) to service_role;", "unexpected source file policy helper", "privacy"],
];
const body = probes.map(([name, setup, expected, phase]) => {
  const success = ["path-b", "canonical", "unchanged-composed"].includes(expected);
  const expectation = success
    ? `jsonb_build_object('policy',${expected === "canonical" ? "expected_canonical" : "expected_path_b"},'unchanged',${expected === "unchanged-composed"})`
    : `jsonb_build_object('state','55000','message',${quote(expected)})`;
  return `actual := pg_temp.probe_canonical_policy(${quote(pathB + setup)}, $${sourceTag}$${phase === "privacy" ? privacyGuard : guard}$${sourceTag}$);
    if actual is distinct from ${expectation} then
      raise exception 'Policy-order regression failed: % (%)', ${quote(name)}, actual;
    end if;
    raise notice 'PASS %', ${quote(name)};`;
}).join("\n");
export const policyOrderSql = `begin;
set local search_path=public,extensions;
set local lock_timeout='5s';
set local statement_timeout='45s';
create function pg_temp.probe_canonical_policy(setup text, guard text) returns jsonb
language plpgsql as $probe$
declare observed jsonb; original_policy jsonb; final_policy jsonb; detail text;
begin
  begin
    execute setup;
    select to_jsonb(policy) into original_policy from pg_policy policy
      where polrelid='public.genome_files'::regclass and polname='genome_files_select_own';
    execute guard;
    select jsonb_build_object('using',pg_get_expr(polqual,polrelid),
      'roles',array(select case when role_id=0 then 'public' else pg_get_userbyid(role_id) end
        from unnest(polroles) role_id order by role_id)) into observed
      from pg_policy where polrelid='public.genome_files'::regclass and polname='genome_files_select_own';
    select to_jsonb(policy) into final_policy from pg_policy policy
      where polrelid='public.genome_files'::regclass and polname='genome_files_select_own';
    raise exception using errcode='ZX001',message='owned policy probe rollback',
      detail=jsonb_build_object('policy',observed,'unchanged',original_policy=final_policy)::text;
  exception
    when sqlstate 'ZX001' then
      get stacked diagnostics detail=pg_exception_detail;
      return detail::jsonb;
    when others then return jsonb_build_object('state',sqlstate,'message',sqlerrm);
  end;
end $probe$;
create temporary table policy_order_expected(like public.genome_files) on commit drop;
create policy expected_path_b on policy_order_expected to authenticated
  using(user_id=(select auth.uid()) and private.genome_file_owner_listable_v1(id)
    and not private.is_path_b_file_v1(id));
create policy expected_canonical on policy_order_expected to authenticated
  using((select auth.uid())=user_id and private.genome_file_owner_listable_v1(id));
do $test$
declare expected_path_b jsonb; expected_canonical jsonb; actual jsonb;
begin
  select jsonb_build_object('using',pg_get_expr(polqual,polrelid),'roles',array['authenticated'])
    into expected_path_b from pg_policy where polrelid='pg_temp.policy_order_expected'::regclass and polname='expected_path_b';
  select jsonb_build_object('using',pg_get_expr(polqual,polrelid),'roles',array['authenticated'])
    into expected_canonical from pg_policy where polrelid='pg_temp.policy_order_expected'::regclass and polname='expected_canonical';
  ${body}
end $test$;
rollback;
`;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const result = spawnSync("docker", ["exec", "-i", `supabase_db_${project}`,
  "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: policyOrderSql, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
if (result.error || result.status !== 0) {
  process.stderr.write(result.stderr || result.error?.message || "Local policy-order probe failed\n");
  process.exit(1);
}
const passes = result.stderr.split("\n").filter((line) => line.startsWith("NOTICE:  PASS "));
assert.equal(passes.length, probes.length, "Every sourced policy-order probe must complete");
console.log(`${passes.length} actual policy-order probes passed; all planted changes rolled back`);
}
