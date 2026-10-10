"""Source-only builder for the reviewed, owner-only account fixture seam.

No database or API operations. Its exact narrow transformations retain the
ordinary algorithm/clock positions and create complete historical envelopes.
"""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
VERSION = "20261001040000"
DEST = ROOT / "supabase/migrations" / (VERSION + "_historical_account_request_clock.sql")
PINS = ROOT / "docs/historical-account-request-function-pins.json"


def source(path, name, definition=None):
    text = definition if definition is not None else (ROOT / path).read_text()
    match = re.search(r"create (?:or replace )?function " + re.escape(name)
                      + r"\(([^$]*?)\)\s*returns ([^$]*?)as (?P<tag>\$[A-Za-z0-9_]*\$)(?P<body>[\s\S]*?)(?P=tag);", text, re.I)
    if not match:
        raise ValueError("Missing exact source function " + name)
    return match.group(0), match.group(1), match.group(2), match.group("body")


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError("Historical source anchor is not unique")
    return text.replace(before, after)


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def literal(text):
    return "'" + text.replace("'", "''") + "'"


def metadata(path, name, service=False, patch=None, definition=None):
    full, args, result, body = source(path, name, definition)
    if patch:
        body = patch(body)
    raw_args = [x.strip() for x in args.split(",") if x.strip()]
    input_names = [x.split()[0] for x in raw_args]
    types = [x.split()[1] for x in raw_args]
    canonical = {"timestamptz": "timestamp with time zone", "int": "integer"}
    types = [canonical.get(x, x) for x in types]
    table = re.search(r"^table\s*\(([^)]*)\)", result, re.I)
    if table:
        outputs = [x.strip().split() for x in table.group(1).split(",")]
        names = input_names + [x[0] for x in outputs]
        result_type = "TABLE(" + ", ".join(x[0] + " " + canonical.get(x[1], x[1]) for x in outputs) + ")"
        all_types = types + [canonical.get(x[1], x[1]) for x in outputs]
        modes = ["i"] * len(types) + ["t"] * len(outputs)
    else:
        names = input_names
        result_type = result.split()[0]
        all_types, modes = None, None
    language = re.search(r"language\s+(\w+)", result, re.I).group(1).lower()
    defaults = [re.split(r"\bdefault\b", x, flags=re.I)[1].strip() for x in raw_args if re.search(r"\bdefault\b", x, re.I)]
    return {"signature": name + "(" + ",".join(x.split()[1] for x in raw_args) + ")", "name": name,
            "bodyMd5": md5(body), "argumentNames": names, "inputCount": len(types),
            "allArgumentTypes": all_types, "argumentModes": modes,
            "inputTypes": ", ".join(types), "result": result_type, "setReturning": bool(table),
            "language": language, "securityDefiner": bool(re.search(r"security\s+definer", result, re.I)),
            "volatility": "s" if re.search(r"\bstable\b", result, re.I) else "v", "parallel": "u",
            "defaultCount": len(defaults), "defaultExpression": ", ".join(defaults) or None,
            "config": ['search_path=""'], "owner": "postgres", "serviceExecute": service,
            "sourcePath": path, "body": body, "definition": full}


def public_path_b(body):
    return replace_once(body,
      "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);",
      "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);\n"
      "  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);")


def private_path_b(body):
    return replace_once(body, "begin\n  perform private.record_account_operation_nonce_v1(",
      "begin\n  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);\n"
      "  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);\n"
      "  perform private.record_account_operation_nonce_v1(")


notice_path = "supabase/migrations/20260930238000_account_cohort_notices.sql"
nonce_path = "supabase/migrations/20260930140200_account_operation_nonce_rendered.sql"
request = metadata(notice_path, "public.request_account_deletion_v1", patch=public_path_b)
notice = metadata(notice_path, "private.enqueue_account_affected_notice_v1")
assert request["bodyMd5"] == "cc02de010c27a714ff5ba96226016d60"
unchanged = [
    metadata(nonce_path, "public.request_account_deletion_v2", True),
    metadata(nonce_path, "private.request_account_deletion_v2", True, private_path_b),
    metadata(nonce_path, "private.record_account_operation_nonce_v1"),
    metadata("supabase/migrations/20260901033000_account_deletion_notice_runtime.sql", "private.validate_sensitive_account_session_v1"),
    metadata(notice_path, "public.claim_due_account_deletion_v1", True),
    metadata(notice_path, "private.account_affected_notice_envelope_v1"),
    metadata(notice_path, "private.assert_account_affected_notice_receipt_v1"),
    metadata("supabase/migrations/20261001030000_account_path_b_request_refusal.sql", "private.assert_account_path_b_deletion_supported_v1"),
    metadata("supabase/migrations/20260930235000_account_cohort_purge.sql", "private.assert_account_owned_cohorts_v1"),
    metadata("supabase/migrations/20260930235000_account_cohort_purge.sql", "private.assert_supported_self_deletion_graph_v1", patch=lambda body: replace_once(body,
      "begin\n  perform private.assert_account_owned_cohorts_v1(p_account_id);",
      "begin\n  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);\n  perform private.assert_account_owned_cohorts_v1(p_account_id);")),
    metadata("supabase/migrations/20260905103317_embryo_cohort_runtime.sql", "private.embryo_cohort_set_v1", True),
    # 20260906055142 explicitly restores service EXECUTE for the shared lock;
    # pin that existing two-entry ACL without changing its invoker body/grants.
    metadata("supabase/migrations/20260906051253_invitation_refusal_transaction.sql", "private.lock_invitation_transitions_v1", True),
    metadata("supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql", "private.enqueue_embryo_principal_mail_v1", True),
    metadata("supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql", "private.enqueue_embryo_principal_mail_clock_core_v1"),
    metadata("supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql", "private.enqueue_embryo_principal_mail_at_v1"),
]
assert unchanged[1]["bodyMd5"] == "f89dcda65e30d4223387d63843c291e0"
assert unchanged[-3]["bodyMd5"] == "ef221766cf9a9df289468466c4077f52"
assert unchanged[7]["bodyMd5"] == "6382fbb06d5525dc983806ecefebb629"
assert unchanged[9]["bodyMd5"] == "be1e996ec3bf2c0e585c7a4b39decbc1"

# One request algorithm. The ordinary NULL arm keeps every original clock
# expression/position, INSERT default and the original same-transaction fill.
core = replace_once(request["body"], "  v_now timestamptz := clock_timestamp();",
  "  v_now timestamptz := clock_timestamp();\n"
  "  v_effective_at timestamptz := coalesce(p_effective_at, v_now);")
core = replace_once(core, "begin\n  perform private.validate_sensitive_account_session_v1",
  "begin\n  if p_effective_at is not null and (not isfinite(p_effective_at) or p_effective_at>v_now) then\n"
  "    raise exception using errcode='22023',message='invalid historical account clock';end if;\n"
  "  perform private.validate_sensitive_account_session_v1")
core = replace_once(core, "'notice_period', v_now,\n    v_now + interval '7 days'",
  "'notice_period', v_effective_at,\n    v_effective_at + interval '7 days'")
start = core.index("  insert into public.retention_due_phases (")
end = core.index("  select ecr.id into v_contact_id", start)
phase_and_manifest = core[start:end]
core = core[:start] + "  if p_effective_at is null then\n" + phase_and_manifest + "  end if;\n\n" + core[end:]
start = core.index("  insert into public.mail_outbox (")
end = core.index("  for v_binding", start)
ordinary_mail = core[start:end]
historical_mail = replace_once(ordinary_mail, "template_payload, expires_at\n",
  "template_payload, expires_at, created_at, not_before\n")
historical_mail = replace_once(historical_mail, "    v_request.notice_ends_at + interval '1 day'\n",
  "    v_request.notice_ends_at + interval '1 day', v_effective_at, v_effective_at\n")
core = core[:start] + "  if p_effective_at is null then\n" + ordinary_mail + "  else\n" + historical_mail + "  end if;\n\n" + core[end:]
core = replace_once(core,
  "    v_mail:=private.enqueue_account_affected_notice_v1(v_request.id,v_binding,false,v_request.notice_ends_at);",
  "    if p_effective_at is null then\n"
  "    v_mail:=private.enqueue_account_affected_notice_v1(v_request.id,v_binding,false,v_request.notice_ends_at);\n"
  "    else\n"
  "      v_mail:=private.enqueue_account_affected_notice_clock_core_v1(v_request.id,v_binding,false,v_request.notice_ends_at,v_effective_at);\n"
  "    end if;")
update_envelope = """  update public.retention_due_phases
  set immutable_envelope=immutable_envelope||jsonb_build_object('affectedNotice',
    jsonb_set(v_notice,'{recipients}',v_bound))
  where retention_row_id=v_retention_id and phase_id='account-deletion-notice-deadline';"""
historical_phase = replace_once(phase_and_manifest,
  "      'originalNoticeEndsAt', v_request.notice_ends_at\n",
  "      'originalNoticeEndsAt', v_request.notice_ends_at,\n"
  "      'affectedNotice', jsonb_set(v_notice,'{recipients}',v_bound)\n")
core = replace_once(core, update_envelope,
  "  if p_effective_at is null then\n" + update_envelope + "\n  else\n" + historical_phase + "  end if;")
request_args = """p_account_id uuid,p_session_id uuid,p_nonce_hash text,p_contact_ciphertext bytea,
  p_contact_hmac text,p_notice_idempotency_key text"""
request_result = "table(deletion_id uuid,status text,notice_ends_at timestamptz)"
request_core_def = f"""create function private.request_account_deletion_clock_core_v1({request_args},p_effective_at timestamptz)
returns {request_result} language plpgsql security definer set search_path='' as $body${core}$body$;"""
request_wrapper_body = """
begin
  return query select * from private.request_account_deletion_clock_core_v1(
    p_account_id,p_session_id,p_nonce_hash,p_contact_ciphertext,p_contact_hmac,p_notice_idempotency_key,null);
end;
"""
request_wrapper_def = f"""create or replace function public.request_account_deletion_v1({request_args})
returns {request_result} language plpgsql security definer set search_path='' as $body${request_wrapper_body}$body$;"""

notice_core_body = replace_once(notice["body"], "t timestamptz:=pg_catalog.clock_timestamp();",
  "t timestamptz:=case when p_created_at is null then pg_catalog.clock_timestamp() else p_created_at end;")
notice_core_body = replace_once(notice_core_body, "begin\n select * into p",
  "begin\n if p_created_at is not null and (not isfinite(p_created_at) or p_created_at>pg_catalog.clock_timestamp()) then\n"
  "  raise exception using errcode='22023',message='invalid historical account mail clock';end if;\n select * into p")
notice_args = "p_deletion uuid,p_binding jsonb,p_cancelled boolean,p_at timestamptz"
notice_core_def = f"""create function private.enqueue_account_affected_notice_clock_core_v1({notice_args},p_created_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $body${notice_core_body}$body$;"""
notice_wrapper_body = """
begin
 return private.enqueue_account_affected_notice_clock_core_v1(p_deletion,p_binding,p_cancelled,p_at,null);
end;
"""
notice_wrapper_def = f"""create or replace function private.enqueue_account_affected_notice_v1({notice_args})
returns uuid language plpgsql security definer set search_path='' as $body${notice_wrapper_body}$body$;"""
at_body = """
begin
  if p_effective_at is null or not isfinite(p_effective_at) or p_effective_at>pg_catalog.clock_timestamp() then
    raise exception using errcode='22023',message='invalid historical account clock';end if;
  perform private.validate_sensitive_account_session_v1(p_account_id,p_session_id);
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);
  perform private.record_account_operation_nonce_v1(
    p_account_id,p_session_id,'account_delete',p_nonce_hash,p_nonce_expires_at);
  return query select * from private.request_account_deletion_clock_core_v1(
    p_account_id,p_session_id,p_nonce_hash,p_contact_ciphertext,p_contact_hmac,p_notice_idempotency_key,p_effective_at);
end;
"""
at_def = f"""create function private.request_account_deletion_at_v1(p_account_id uuid,p_session_id uuid,p_nonce_hash text,
  p_nonce_expires_at timestamptz,p_contact_ciphertext bytea,p_contact_hmac text,p_notice_idempotency_key text,p_effective_at timestamptz)
returns {request_result} language plpgsql security definer set search_path='' as $body${at_body}$body$;"""

old = [request, notice] + unchanged
new_signatures = [
 "private.request_account_deletion_clock_core_v1(uuid,uuid,text,bytea,text,text,timestamptz)",
 "private.enqueue_account_affected_notice_clock_core_v1(uuid,jsonb,boolean,timestamptz,timestamptz)",
 "private.request_account_deletion_at_v1(uuid,uuid,text,timestamptz,bytea,text,text,timestamptz)",
]
# This is a source-scope guard, not a production apply generator. Root still
# binds a complete actual predecessor/catalog and one guarded apply envelope.
rows = []
for info in old:
    clean = {k: v for k, v in info.items() if k not in ("definition", "body")}
    clean["successorBodyMd5"] = (md5(request_wrapper_body) if info is request else
                                  md5(notice_wrapper_body) if info is notice else info["bodyMd5"])
    rows.append(clean)
expected = json.dumps(rows, separators=(",", ":"))
new_names = [signature.split("(")[0].split(".")[1] for signature in new_signatures]
new_names_sql = ",".join(literal(name) for name in new_names)
# NULL-safe comparisons throughout; a missing identity never satisfies a pin.
guard = """
    target:=to_regprocedure(expected->>'signature');
    if target is null or not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
      join pg_namespace ns on ns.oid=p.pronamespace where p.oid=target
      and ns.nspname=split_part(expected->>'name','.',1) and p.proname=split_part(expected->>'name','.',2)
      and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0
      and p.probin is null and p.prosupport=0 and p.procost=100
      and p.prorows=case when (expected->>'setReturning')::boolean then 1000 else 0 end
      and lang.lanname=expected->>'language' and p.prosecdef=(expected->>'securityDefiner')::boolean
      and p.proretset=(expected->>'setReturning')::boolean and p.provolatile::text=expected->>'volatility'
      and p.proparallel::text=expected->>'parallel' and p.pronargs=(expected->>'inputCount')::integer
      and oidvectortypes(p.proargtypes)=expected->>'inputTypes'
      and pg_get_function_result(p.oid)=expected->>'result'
      and coalesce(to_jsonb(p.proargnames),'[]'::jsonb)=expected->'argumentNames'
      and coalesce(to_jsonb(p.proargmodes),'null'::jsonb)=expected->'argumentModes'
      and coalesce((select jsonb_agg(format_type(t,null) order by ordinal)
        from unnest(p.proallargtypes) with ordinality a(t,ordinal)),'null'::jsonb)=expected->'allArgumentTypes'
      and to_jsonb(p.proconfig)=expected->'config'
      and p.pronargdefaults=(expected->>'defaultCount')::integer
      and pg_get_expr(p.proargdefaults,0) is not distinct from expected->>'defaultExpression'
      and md5(p.prosrc)=expected->>'bodyMd5'
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=case when (expected->>'serviceExecute')::boolean then 2 else 1 end
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantor<>p.proowner or acl.is_grantable or acl.privilege_type<>'EXECUTE'
          or (acl.grantee<>p.proowner and (not (expected->>'serviceExecute')::boolean or acl.grantee<>'service_role'::regrole))))
      or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
        where has_function_privilege(api,target,'execute') is distinct from
          (api='service_role' and (expected->>'serviceExecute')::boolean)) then
      raise exception using errcode='55000',message='historical account predecessor differs';end if;
"""
statements = [notice_core_def, request_core_def, at_def, notice_wrapper_def, request_wrapper_def]
execute = "\n".join(f"  execute $definition_{n}${definition}$definition_{n}$;" for n, definition in enumerate(statements))
revoke = "\n".join("  revoke all on function " + signature + " from public,anon,authenticated,inherit_upload_only,service_role;" for signature in new_signatures)
new_infos = [metadata(None, signature.split("(")[0], definition=definition)
             for signature, definition in zip(new_signatures, [request_core_def, notice_core_def, at_def])]
new_metadata = json.dumps([{k:v for k,v in info.items() if k not in ("definition","body")} for info in new_infos],separators=(",",":"))
PINS.write_text(json.dumps({"version": "historical-account-request-pins-v1", "predecessors": rows,
                           "newFunctions": json.loads(new_metadata)}, indent=2) + "\n")
new_guard = guard.replace("historical account predecessor differs", "historical account new owner boundary differs")
DEST.write_text(f"""-- Bounded owner-only synthetic historical account-request prerequisite.
-- Current native HTTP202 and real-time v2/nonce/due/239 paths stay unchanged.
-- A fresh page-issued nonce must be verified by the real application before
-- this owner entry; this gives no HTTP202, elapsed or physical-provider credit.
-- No row is aged, no registry/period changes, and all new API roles are denied.
do $historical_account$
declare expected jsonb; target regprocedure; before_metadata jsonb:='{{}}'; actual jsonb;
  pins constant jsonb := $pins${expected}$pins$::jsonb;
  new_metadata constant jsonb := $new_metadata${new_metadata}$new_metadata$::jsonb;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='historical account owner only';end if;
  if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='private' and p.proname in({new_names_sql})) then
    raise exception using errcode='55000',message='historical account successor already exists';end if;
  for expected in select value from jsonb_array_elements(pins) loop
{guard}
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    before_metadata:=before_metadata||jsonb_build_object(expected->>'signature',actual);
  end loop;
  -- The ordinary recording defaults and registered strict periods are not changed.
  if exists(select 1 from unnest(array['public.account_deletion_requests','public.retention_rows','public.purge_manifests','public.mail_outbox']) relation
    where not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(relation) and a.attname='created_at' and not a.attisdropped
        and a.atttypid='timestamptz'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()'))
    or exists(select 1 from (values('public.mail_outbox','not_before'),('public.account_operation_nonces','issued_at')) clock_column(relation,name)
      where not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=to_regclass(clock_column.relation) and a.attname=clock_column.name and not a.attisdropped
          and a.atttypid='timestamptz'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()'))
    or not exists(select 1 from pg_constraint where conrelid='public.account_deletion_requests'::regclass
      and conname='account_deletion_requests_check' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((notice_ends_at = (requested_at + ''7 days''::interval)))')
    or not exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
      and conname='mail_outbox_check' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((expires_at > created_at))')
    or not exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
      and conname='mail_outbox_provider_retention_limit' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((expires_at <= (created_at + ''30 days''::interval)))') then
    raise exception using errcode='55000',message='historical account clock boundary differs';end if;
{execute}
{revoke}
  for expected in select value from jsonb_array_elements(pins) loop
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=to_regprocedure(expected->>'signature');
    if actual is distinct from before_metadata->(expected->>'signature')
      or (select md5(prosrc) from pg_proc where oid=to_regprocedure(expected->>'signature'))
        is distinct from expected->>'successorBodyMd5' then
      raise exception using errcode='55000',message='historical account original metadata changed';end if;
  end loop;
  for expected in select value from jsonb_array_elements(new_metadata) loop
{new_guard}
  end loop;
end;
$historical_account$;
""")
print(json.dumps({"migration": DEST.name, "newFunctions": 3, "preservedAbiReplacements": 2,
                  "unchangedPins": len(unchanged), "execution": "source generation only"}))
