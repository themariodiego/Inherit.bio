import assert from "node:assert/strict";

//023 deliberately closes every API role on encrypted objection statements.
//027's two genuine owner-defined entrypoints call the same private executor.
// Only this reviewed table's empty statement probe uses that executor's owner.
export const PROTECTED_OBJECTION_TABLE = "future_person_claim_objections";
export const PROTECTED_OBJECTION_DELETE = "delete from public.future_person_claim_objections where false";
export function statementProbeRole(table) {
  return table === PROTECTED_OBJECTION_TABLE ? "postgres" : "service_role";
}

const native = (signature, body, args, roles) => ({ signature, body, args, roles,
  owner: "postgres", language: "plpgsql", result: "jsonb", securityDefiner: true,
  config: ['search_path=""', "lock_timeout=250ms"], strict: false, parallel: "u" });
export const EXPECTED_PROTECTED_OBJECTION_CATALOG = {
  tableOwner: "postgres", tableKind: "r", rowSecurity: true,
  apiTableAccess: [], apiColumnAccess: [], foreignTableAcl: 0,
  trigger: { enabled: "O", type: 30, internal: false, args: "", attributes: "", when: null },
  triggerFunction: { body: "34976ae2deebc1622e5924f8f6b6b99e", owner: "postgres",
    language: "plpgsql", result: "trigger", securityDefiner: false,
    config: ['search_path=""'], args: null, strict: false, parallel: "u" },
  transitionFunction: { body: "8efac632f9dad73d9af1056a8d81c480", owner: "postgres",
    language: "sql", result: "void", securityDefiner: false,
    config: ['search_path=""'], args: null, strict: false, parallel: "u" },
  native: [
    native("private.record_keyless_owner_objection_v1(uuid,bigint,bytea,bytea)", "103992e638ef341dde21d20c148ab1de",
      ["p_notice_id", "p_notice_revision", "p_statement_ciphertext", "p_wrapped_statement_key"], []),
    native("public.submit_future_person_owner_objection_v1(text,text,uuid,bigint,bytea,bytea)", "9097482abf35c6b4cfb2673c5e5081e9",
      ["p_session_hash", "p_nonce", "p_notice_id", "p_notice_revision", "p_statement_ciphertext", "p_wrapped_statement_key"], ["service_role"]),
    native("public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)", "422651c6e50a5406cde09962d01400c4",
      ["p_notice", "p_revision", "p_nonce", "p_statement_ciphertext", "p_wrapped_statement_key"], ["authenticated"]),
  ],
};

/** Read-only exact predecessor proof. No role choice is inferred from live ACLs. */
export const PROTECTED_OBJECTION_CATALOG_SQL = `
with api(role) as (values ('anon'),('authenticated'),('inherit_upload_only'),('service_role')),
native(signature,ordinal) as (values
 ('private.record_keyless_owner_objection_v1(uuid,bigint,bytea,bytea)',1),
 ('public.submit_future_person_owner_objection_v1(text,text,uuid,bigint,bytea,bytea)',2),
 ('public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)',3))
select jsonb_build_object(
 'tableOwner',(select pg_get_userbyid(relowner) from pg_class where oid='public.future_person_claim_objections'::regclass),
 'tableKind',(select relkind from pg_class where oid='public.future_person_claim_objections'::regclass),
 'rowSecurity',(select relrowsecurity from pg_class where oid='public.future_person_claim_objections'::regclass),
 'apiTableAccess',(select coalesce(jsonb_agg(role order by role),'[]'::jsonb) from api
   where has_table_privilege(role,'public.future_person_claim_objections','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
 'apiColumnAccess',(select coalesce(jsonb_agg(role order by role),'[]'::jsonb) from api
   where has_any_column_privilege(role,'public.future_person_claim_objections','SELECT,INSERT,UPDATE,REFERENCES')),
 'foreignTableAcl',(select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where c.oid='public.future_person_claim_objections'::regclass and a.grantee<>c.relowner),
 'trigger',(select jsonb_build_object('enabled',t.tgenabled,'type',t.tgtype,'internal',t.tgisinternal,
   'args',encode(t.tgargs,'hex'),'attributes',t.tgattr::text,'when',pg_get_expr(t.tgqual,t.tgrelid))
   from pg_trigger t where t.tgrelid='public.future_person_claim_objections'::regclass
     and t.tgname='evidence_transition_lock' and t.tgfoid='private.lock_evidence_transition_v1()'::regprocedure),
 'triggerFunction',(select jsonb_build_object('body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
   'language',l.lanname,'result',pg_get_function_result(p.oid),'securityDefiner',p.prosecdef,
   'config',p.proconfig,'args',p.proargnames,'strict',p.proisstrict,'parallel',p.proparallel)
   from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.lock_evidence_transition_v1()'::regprocedure),
 'transitionFunction',(select jsonb_build_object('body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
   'language',l.lanname,'result',pg_get_function_result(p.oid),'securityDefiner',p.prosecdef,
   'config',p.proconfig,'args',p.proargnames,'strict',p.proisstrict,'parallel',p.proparallel)
   from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.lock_invitation_transitions_v1()'::regprocedure),
 'native',(select jsonb_agg(jsonb_build_object('signature',n.signature,'body',md5(p.prosrc),
   'args',p.proargnames,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,
   'result',pg_get_function_result(p.oid),'securityDefiner',p.prosecdef,'config',p.proconfig,
   'strict',p.proisstrict,'parallel',p.proparallel,
   'roles',(select coalesce(jsonb_agg(role order by role),'[]'::jsonb) from api where has_function_privilege(role,p.oid,'execute')))
   order by n.ordinal) from native n left join pg_proc p on p.oid=to_regprocedure(n.signature)
   left join pg_language l on l.oid=p.prolang))::text`;

export function assertProtectedObjectionCatalog(catalog) {
  assert.deepEqual(catalog, EXPECTED_PROTECTED_OBJECTION_CATALOG,
    "Protected objection owner/ACL/trigger/native source contract differs");
}

export function assertDirectServiceObjectionDenied(error) {
  assert.match(String(error), /\b42501\b/, "Direct protected-table DELETE must remain denied");
  assert.match(String(error), /permission denied for table future_person_claim_objections\b/,
    "The refusal must be this exact protected table's ACL");
  assert.doesNotMatch(String(error), /\b57014\b/, "An ACL refusal must not be accepted as a lock cancellation");
}
