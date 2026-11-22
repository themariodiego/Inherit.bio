import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A non-parent uploader's withdrawal of its consent for an embryo upload
 * (20261119170000_embryo_uploader_consent_withdrawal.sql; owner decision of 19
 * November 2026, "A non-parent uploader's withdrawal for an embryo upload
 * stops analysis and deletes, as they signed"). The migration patches the
 * cohort restriction core and the person-event list under the md5-guarded
 * convention. Each pinned body is rebuilt from the migration that last
 * defined it, each patch is replayed on it, and every md5 is recomputed. The
 * new actor case must be bound to the one route and the one door and must
 * leave every participant set alone. The pgTAP suite
 * (supabase/tests/embryo_uploader_consent_withdrawal.sql) drives both phases
 * against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261119170000_embryo_uploader_consent_withdrawal.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/embryo_uploader_consent_withdrawal.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}
function definition(source: string, marker: string, header: string): string {
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = /\bas\s+(\$[a-z_]*\$)/iu.exec(source.slice(start))!;
  const bodyStart = start + open.index + open[0].length;
  const close = source.indexOf(`${open[1]};`, bodyStart);
  return `${header}AS $function$${source.slice(bodyStart, close)}$function$\n`;
}
type Patch = { target: string; before: string; after: string; old: string; next: string };
function patchTable(block: string): Patch[] {
  return [...block.matchAll(/\(\d,'([^']+)','([0-9a-f]{32})',\s*'([0-9a-f]{32})','[^']+',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$/gu)]
    .map(match => ({ target: match[1]!, before: match[2]!, after: match[3]!, old: match[4]!, next: match[5]! }));
}
function apply(text: string, patch: { old: string; next: string }): string {
  expect(count(text, patch.old), patch.old.slice(0, 80)).toBe(1);
  return text.replace(patch.old, () => patch.next);
}

const CORE = definition(read("supabase/migrations/20260930232000_embryo_parent_withdrawal.sql"),
  "create function private.restrict_embryo_cohort_core_v1(",
  "CREATE OR REPLACE FUNCTION private.restrict_embryo_cohort_core_v1(p_cohort_id uuid, p_actor_principal uuid, p_route_id text)\n"
  + " RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
const QUEUE = definition(read("supabase/migrations/20260906051253_invitation_refusal_transaction.sql"),
  "create or replace function private.queue_refused_invitation_draft_v1(",
  "CREATE OR REPLACE FUNCTION private.queue_refused_invitation_draft_v1(p_kind text, p_draft_id uuid, "
  + "p_deadline timestamp with time zone, p_revision bigint)\n RETURNS void\n LANGUAGE plpgsql\n SET search_path TO ''\n");
const ATTRIBUTION = read("supabase/migrations/20261023120000_legal_audit_attribution_completeness.sql");
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const patches = patchTable(between(migration, "do $patch_uploader_withdrawal$", "$patch_uploader_withdrawal$;"));
const door = between(migration, "create function public.withdraw_embryo_uploader_consent_v1(", "$$;");
const readiness = between(migration, "create function public.embryo_uploader_withdrawal_readiness_v1(", "$$;");
const basisLoss = between(migration, "create function private.embryo_uploader_basis_loss_v1(", "$$;");

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260906051253", "20260930232000", "20261023120000", "20261024110000", "20261119160000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates three functions and patches two bodies, and no table, column, constraint or set", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]))
      .toEqual(["private.embryo_uploader_basis_loss_v1", "public.withdraw_embryo_uploader_consent_v1",
        "public.embryo_uploader_withdrawal_readiness_v1"]);
    expect(migration).not.toMatch(/^\s*(?:alter|drop|create)\s+(?:table|index|trigger|policy|type)\b/imu);
    expect(patches.map(patch => patch.target)).toEqual(["private.restrict_embryo_cohort_core_v1(uuid,uuid,text)",
      "private.restrict_embryo_cohort_core_v1(uuid,uuid,text)", "private.restrict_embryo_cohort_core_v1(uuid,uuid,text)",
      "private.legal_audit_person_event_v1(text,text)"]);
    expect(migration).not.toMatch(/insert into public\.embryo_participant_sets|update public\.embryo_participant_sets/iu);
  });

  it("names none of what the earlier 19 November migrations pin, so it undoes none of them", () => {
    for (const pinned of ["genomes-staging", "generated-artifacts", "account_deletion_storage_entries_bucket_id_check",
      "embryo_ingest_delete_objects_bucket_id_check", "genome_storage_objects_bucket_id_check", "'private.empty_self_subject_v1(",
      "'private.prepare_genome_file_deletion_body_v1(", "create_adult_subject_invitation", "create_embryo_cohort_draft_core_v1",
      "create_embryo_draft_invitation_core_v1", "prepare_embryo_ingest_unwind_v1", "claim_due_account_deletion_v1"]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
  });
});

describe("the predecessor block and the patches", () => {
  it("pins every body it relies on to the md5 recomputed from its source, and to its ACL", () => {
    expect(md5(CORE)).toBe("f2e6cb1f392308d4c834f7eef50d7abd");
    expect(md5(QUEUE)).toBe("54ab785feca9114bb097e5fbe1484dd9");
    // The person-event list and the nonce recorder are earlier patches' successors, by their own tables.
    expect(ATTRIBUTION).toContain("(2,'private.legal_audit_person_event_v1(text,text)','b566386791e9736ef744924a2d4d3039','56990e96581e5dc415222f44f09b5ac0'");
    expect(read("supabase/migrations/20261024110000_copilot_settings_delete_nonce.sql"))
      .toContain("'6869593d67ff37d93a6d4caea62f01c3','{postgres=X/postgres}'");
    for (const [signature, hash] of [["private.restrict_embryo_cohort_core_v1(uuid,uuid,text)", md5(CORE)],
      ["private.legal_audit_person_event_v1(text,text)", "56990e96581e5dc415222f44f09b5ac0"],
      ["private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)", md5(QUEUE)],
      ["private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)", "6869593d67ff37d93a6d4caea62f01c3"]]) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}'`);
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='embryo uploader withdrawal prerequisite differs'");
  });

  it("replays the three core patches on the rebuilt core, each to exactly the successor the migration asserts", () => {
    let core = CORE;
    for (const patch of patches.slice(0, 3)) {
      expect(md5(core), patch.target).toBe(patch.before);
      core = apply(core, patch);
      expect(md5(core), patch.target).toBe(patch.after);
    }
    expect(patches[2]!.after).toBe("006bfca91b8c66060681371e61333494");
    expect(between(migration, "do $postflight$", "$postflight$;")).toContain("md5(pg_get_functiondef(p.oid))='006bfca91b8c66060681371e61333494'");
    expect(patches[3]!.before).toBe("56990e96581e5dc415222f44f09b5ac0");
    expect(patches[3]!.after).toBe("73bd0200b7e272bec503eab70499e877");
    // The earlier suite that pinned the list pinned this successor until
    // 2026-11-22 (D-159): 20261122160000 patches the list once more from it,
    // so the suite now pins that patch's successor and names this one as its
    // predecessor.
    const attributionSuite = read("supabase/tests/legal_audit_attribution_completeness.sql");
    expect(attributionSuite).toContain("from exactly 20261119170000's successor 73bd0200b7e272bec503eab70499e877");
    expect(attributionSuite).toContain("'f06ad94838f724581b457e800162a6bb'");
  });

  it("binds api.consent-revoke to the uploader's actor case alone and leaves every other route needing a disposition authority", () => {
    const core = patches.slice(0, 3).reduce(apply, CORE);
    expect(core).toContain("if p_route_id is null or p_route_id not in ('api.cohort-restrict', 'api.withdraw', 'api.consent-revoke') then");
    expect(core).toContain("  if p_route_id = 'api.consent-revoke' then\n    if not private.embryo_uploader_basis_loss_v1(v_cohort.id, p_actor_principal) then");
    expect(core).toContain("  elsif p_actor_principal is null or not (p_actor_principal = any (\n"
      + "      private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities'))) then\n"
      + "    raise exception using errcode = '42501', message = 'not a disposition authority';");
    // Nothing else of the restriction changes: the effects are the core's own.
    expect(core.slice(core.indexOf("  if v_cohort.status not in"))).toBe(
      apply(CORE.slice(CORE.indexOf("  if v_cohort.status not in")), patches[2]!));
    // The actor case is the cohort's own non-parent uploader inside its own withdrawal, outside every set.
    for (const predicate of ["pg_catalog.current_setting('inherit.embryo_uploader_withdrawal',true)=c.id::text",
      "pg_catalog.current_setting('inherit.legal_audit_actor',true)=c.owner_account_id::text",
      "and d.uploader_principal_id=p_principal_id", "and d.upload_class='embryo_third_party' and d.upload_situation='with_genetic_parents_permission'",
      "and cs.artifact_key='consent.upload-embryo' and cs.purpose='embryo-upload-uploader-class'",
      "and not exists(select 1 from public.embryo_participant_sets ps where ps.cohort_id=c.id and ps.principal_id=p_principal_id)",
      "and not (p_principal_id=any(private.embryo_cohort_set_v1(c.id,'disposition_authorities')))"]) {
      expect(basisLoss, predicate).toContain(predicate);
    }
  });

  it("is the only caller of the core under api.consent-revoke, and the marker is set only around that call", () => {
    for (const file of files) {
      const sql = read(`supabase/migrations/${file}`);
      const calls = [...sql.matchAll(/restrict_embryo_cohort_core_v1\([^)]*'api\.consent-revoke'\)/gu)].length;
      expect(calls, file).toBe(file === NAME ? 1 : 0);
      expect(count(sql, "set_config('inherit.embryo_uploader_withdrawal'"), file).toBe(file === NAME ? 2 : 0);
    }
    expect(door).toContain("  perform pg_catalog.set_config('inherit.embryo_uploader_withdrawal',c.id::text,true);\n"
      + "  perform private.restrict_embryo_cohort_core_v1(c.id,cs.signer_principal_id,'api.consent-revoke');\n"
      + "  perform pg_catalog.set_config('inherit.embryo_uploader_withdrawal','',true);");
  });

  it("is the last word on nothing it pins: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const qualified of ["private.restrict_embryo_cohort_core_v1",
      "private.queue_refused_invitation_draft_v1", "private.consume_account_operation_nonce_v1"]) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
    // 2026-11-22 (D-159), changed on purpose: the person-caused event list gains
    // exactly one pair, the uploader's hand-over recorded on api.subject-delete,
    // in 20261122160000, patched in place from exactly this migration's
    // successor. No other later migration restates or patches the list.
    const D159 = "20261122160000_transferred_record_exports.sql";
    expect(files.filter(file => file > NAME && rewrites(file, "private.legal_audit_person_event_v1"))).toEqual([D159]);
    const d159 = read(`supabase/migrations/${D159}`);
    expect(d159).toContain("(14,'private.legal_audit_person_event_v1(text,text)','73bd0200b7e272bec503eab70499e877',");
    const listPatch = d159.slice(d159.indexOf("(14,'private.legal_audit_person_event_v1(text,text)'"));
    expect(listPatch).toContain("$old$      ('api.consent-revoke','embryo.upload-consent.withdrawn')),false);$old$");
    expect(listPatch).toContain("$new$      ('api.consent-revoke','embryo.upload-consent.withdrawn'),\n"
      + "      -- 20261122160000 (D-159): the uploader's hand-over, recorded on the route it used.\n"
      + "      ('api.subject-delete','subject.ownership_transferred')),false);$new$");
  });
});

describe("the door and the page's read", () => {
  it("resolves the phase from the immutable signature, then refuses before it writes, then records and acts", () => {
    const cohort = door.slice(door.indexOf(" if c.id is not null then"), door.indexOf("return jsonb_build_object('case','cohort');"));
    const order = ["c.status not in ('upload_pending','ingesting','active')", "raise exception using errcode='42501',message='not_found'; end if;",
      "private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);",
      "private.append_legal_audit_event('embryo.upload-consent.withdrawn',null,'api.consent-revoke','accepted',",
      "private.restrict_embryo_cohort_core_v1(c.id,cs.signer_principal_id,'api.consent-revoke');"];
    const at = order.map(fragment => cohort.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const draft = door.slice(door.indexOf("-- Before finalisation"));
    const draftOrder = ["perform private.lock_invitation_transitions_v1();", "for update;",
      "message='withdrawal_phase_changed'", "private.consume_account_operation_nonce_v1(",
      "update public.subject_invitations set status='cancelled'", "update public.embryo_cohort_drafts set state='cancelled' where id=d.id;",
      "perform private.queue_refused_invitation_draft_v1('co_parent',d.id,d.fixed_expires_at,d.participant_set_revision);",
      "private.append_legal_audit_event('embryo.upload-consent.withdrawn',null,'api.consent-revoke','accepted',"];
    const draftAt = draftOrder.map(fragment => draft.indexOf(fragment));
    expect(draftAt.every(index => index > 0), JSON.stringify(draftAt)).toBe(true);
    expect([...draftAt].sort((a, b) => a - b)).toEqual(draftAt);
    // Before finalisation no notice is queued: a refused invitation's notices are not this withdrawal's.
    expect(draft).not.toContain("invitation_terminal_notices");
    expect(door).toContain("or cs.target_kind<>'cohort_draft' or cs.signer_account_id is distinct from p_account_id then");
  });

  it("reads 'cohort' and 'draft' on the door's own predicates, and writes nothing", () => {
    const predicates = (text: string) => [...text.matchAll(/ or not exists\(select 1 from public\.subject_principals sp where sp\.id=cs\.signer_principal_id[^)]*\)/gu)].length;
    expect(predicates(readiness)).toBe(2);
    expect(predicates(door)).toBe(2);
    expect(readiness).toContain(" if cs.id is null or cs.artifact_key<>'consent.upload-embryo' or cs.purpose<>'embryo-upload-uploader-class'\n"
      + "  or cs.target_kind<>'cohort_draft' or cs.signer_account_id is distinct from p_account_id then");
    expect(door).toContain(" if cs.id is null or cs.artifact_key<>'consent.upload-embryo' or cs.purpose<>'embryo-upload-uploader-class'\n"
      + "  or cs.target_kind<>'cohort_draft' or cs.signer_account_id is distinct from p_account_id then");
    for (const predicate of ["c.upload_class<>'embryo_third_party' or c.owner_account_id is distinct from p_account_id",
      "d.state not in ('draft','evidence_pending','ready') or d.fixed_expires_at<=",
      "or d.owner_account_id is distinct from p_account_id or d.uploader_principal_id is distinct from cs.signer_principal_id"]) {
      expect(readiness, predicate).toContain(predicate);
      expect(door, predicate).toContain(predicate);
    }
    expect(readiness).toContain("returns text language plpgsql stable security definer set search_path=''");
    expect(readiness).not.toMatch(/\b(?:insert|update|delete)\s|set_config|for update/iu);
  });

  it("is reachable only as granted, and the route and the pages' server half are its callers", () => {
    expect(migration).toContain("grant execute on function public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz) to service_role;");
    expect(migration).toContain("grant execute on function public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid) to service_role;");
    expect(migration).toContain("revoke all on function private.embryo_uploader_basis_loss_v1(uuid,uuid)\n from public,anon,authenticated,inherit_upload_only,service_role;");
    expect(read("src/app/api/consents/[id]/revoke/route.ts")).toContain('admin.rpc("withdraw_embryo_uploader_consent_v1", {');
    expect(read("src/lib/embryos/uploader-withdrawal.ts")).toContain('admin.rpc("embryo_uploader_withdrawal_readiness_v1", {');
  });

  it("is driven by its pgTAP suite through both phases, the refusals and the other cohort", () => {
    for (const fragment of ["'not the non-parent uploader'", "'not a disposition authority'", "'invalid_operation_nonce'",
      "public.claim_refused_invitation_draft_purge_v1(", "public.finish_refused_invitation_draft_purge_v1(",
      "'cohort-restriction-notice'", "'006bfca91b8c66060681371e61333494'", "'54ab785feca9114bb097e5fbe1484dd9'"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap).toContain("\nbegin;\n");
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
