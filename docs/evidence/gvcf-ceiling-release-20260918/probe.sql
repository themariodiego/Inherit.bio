-- Bounded, rollback-only production probe for 20260918150000_own_upload_gvcf_ceiling.sql.
-- Every RPC call uses fresh random identities that match no row, so refusals
-- are exercised without touching stored data; the one accepted write (setting
-- the new ceiling) is made inside a block that raises a sentinel, so it is
-- rolled back before the block ends. Observations live in a temporary table
-- that is read once and discarded with the session.
create temporary table probe_receipt(check_name text, outcome text, passed boolean);
do $probe$
declare v jsonb; b bigint; sqlstate_out text; msg text; c bigint;
begin
  -- 1. The column exists, is null, and every reader falls back to the VCF ceiling.
  select maximum_gvcf_bytes into b from private.upload_authorization_config where singleton;
  insert into probe_receipt values('maximum_gvcf_bytes is unset after apply', coalesce(b::text,'null'), b is null);
  select coalesce(maximum_gvcf_bytes,maximum_vcf_bytes) into b from private.upload_authorization_config where singleton;
  insert into probe_receipt values('the applied gVCF ceiling reads as the VCF ceiling', b::text, b = 25165824);
  -- 2. The check constraint refuses a zero ceiling.
  begin update private.upload_authorization_config set maximum_gvcf_bytes=0 where singleton; insert into probe_receipt values('zero gVCF ceiling refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate;
    insert into probe_receipt values('zero gVCF ceiling refused', sqlstate_out, sqlstate_out='23514'); end;
  -- 3. A valid ceiling is accepted, then rolled back inside its own block.
  begin update private.upload_authorization_config set maximum_gvcf_bytes=8589934592 where singleton; raise exception 'probe_rollback';
  exception when others then get stacked diagnostics msg = message_text;
    insert into probe_receipt values('valid gVCF ceiling accepted then rolled back', msg, msg='probe_rollback'); end;
  select maximum_gvcf_bytes into b from private.upload_authorization_config where singleton;
  insert into probe_receipt values('maximum_gvcf_bytes still unset after the probe', coalesce(b::text,'null'), b is null);
  -- 4. Contracts unchanged for unknown identities: disclosure, issuance, normalization and preparation source all refuse before any write.
  begin perform private.own_upload_limits_v1(gen_random_uuid(), gen_random_uuid()); insert into probe_receipt values('disclosure for unknown account refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('disclosure for unknown account refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  begin perform private.issue_own_storage_upload_v1(gen_random_uuid(), gen_random_uuid(), null, 'gVCF', 1, null); insert into probe_receipt values('gVCF issuance for unknown account refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('gVCF issuance for unknown account refused', sqlstate_out||' '||msg, sqlstate_out='42501'); end;
  begin perform private.issue_own_storage_upload_v1(gen_random_uuid(), gen_random_uuid(), null, 'BAM', 1, null); insert into probe_receipt values('unknown declaration refused before authority','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('unknown declaration refused before authority', sqlstate_out||' '||msg, sqlstate_out='22023' and msg='invalid_request'); end;
  begin perform private.own_upload_normalization_v1('begin', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null, null); insert into probe_receipt values('normalization for unknown file refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('normalization for unknown file refused', sqlstate_out||' '||msg, sqlstate_out='42501'); end;
  begin perform private.own_preparation_source_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()); insert into probe_receipt values('preparation source for unknown file refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('preparation source for unknown file refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  -- 5. Nothing was written.
  select count(*) into c from public.upload_sessions where status in ('issued','uploaded','validating') and expires_at>clock_timestamp();
  insert into probe_receipt values('no active upload session created by the probe', c::text, c = 0);
  select count(*) into c from private.own_preparation_jobs where created_at > clock_timestamp() - interval '10 minutes';
  insert into probe_receipt values('no preparation job created by the probe', c::text, c = 0);
  -- 6. The four bodies are the repository text and keep their definer status and pinned search_path.
  select count(*) into c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef
    and array_to_string(p.proconfig,',') = 'search_path=pg_catalog, private' and (p.proname,md5(p.prosrc)) in (
    ('issue_own_storage_upload_v1','5d55aac633eb06a0b382658db96565e3'),
    ('own_upload_normalization_v1','ca3988cca1fa34e9714768044f38f2bf'),
    ('own_preparation_source_v1','790b2fc9b965f0d0e3386346b0138769'),
    ('own_upload_limits_v1','26eec6c424035f16f7302ec7f2739449'));
  insert into probe_receipt values('four replaced bodies equal the repository text with definer status and pinned search_path', c::text, c = 4);
end $probe$;
select jsonb_build_object('observedAt', now(), 'checks', count(*), 'passed', count(*) filter (where passed), 'failed', jsonb_agg(check_name) filter (where not passed), 'rows', jsonb_agg(jsonb_build_object('check', check_name, 'outcome', outcome, 'passed', passed))) from probe_receipt;
