-- Own-only Copilot permissions. Existing provider saves remain compatible but
-- invalidate canonical authority; no old setting or grant is upgraded implicitly.
alter table public.profiles add column copilot_settings_revision bigint not null default 1 check(copilot_settings_revision>0);
alter table public.llm_settings add column copilot_recipient jsonb;
alter table public.purpose_grants add column copilot_recipient_revision bigint check(copilot_recipient_revision>0);
alter table public.subject_consents add column copilot_recipient jsonb;

create function private.guard_copilot_profile_revision_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
 if current_user in ('anon','authenticated','inherit_upload_only') and
  (TG_OP='INSERT' or
   (TG_OP='UPDATE' and NEW.copilot_settings_revision is distinct from OLD.copilot_settings_revision)) then
  raise exception using errcode='42501',message='not_found'; end if;
 return NEW;
end;
$function$;
create trigger guard_copilot_profile_revision before insert or update on public.profiles
 for each row execute function private.guard_copilot_profile_revision_v1();

create function private.invalidate_own_copilot_v1(p_account_id uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_revision bigint; v_now timestamptz:=clock_timestamp();
begin
 update public.profiles set copilot_settings_revision=copilot_settings_revision+1
 where id=p_account_id returning copilot_settings_revision into v_revision;
 with ended as (
  update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
  from public.directional_grants dg where dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   and pg.purpose in ('copilot.local','copilot.cloud') and pg.copilot_recipient_revision is not null
   and dg.direction='self' and dg.recipient_account_id=p_account_id and pg.revoked_at is null
  returning pg.grant_id
 ) update public.directional_grants set status='superseded',ended_at=v_now where grant_id in(select grant_id from ended);
 update public.subject_consents set revoked_at=v_now,revocation_reason='superseded'
 where account_id=p_account_id and consent_type='cloud_model' and copilot_recipient is not null and revoked_at is null;
 -- Legacy consent is revoked too: a changed destination never inherits a prior provider-key grant.
 update public.consent_grants set revoked_at=v_now where user_id=p_account_id and revoked_at is null;
 return v_revision;
end;
$function$;

create function private.guard_copilot_settings_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_revision bigint; v_account uuid;
begin
 v_account:=case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
 if TG_OP='UPDATE' and NEW.user_id is distinct from OLD.user_id then raise exception using errcode='42501',message='not_found'; end if;
 v_revision:=private.invalidate_own_copilot_v1(v_account);
 if TG_OP='DELETE' then return OLD; end if;
 if current_setting('role',true) in ('service_role','postgres','supabase_admin','none')
  and current_setting('inherit.canonical_copilot_settings',true)='v1' then
  NEW.copilot_recipient:=NEW.copilot_recipient||jsonb_build_object('revision',v_revision);
 else NEW.copilot_recipient:=null;
 end if;
 return NEW;
end;
$function$;
create trigger guard_copilot_settings before insert or update or delete on public.llm_settings
 for each row execute function private.guard_copilot_settings_v1();

create function private.invalidate_copilot_key_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_account uuid;
begin
 v_account:=case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
 perform private.invalidate_own_copilot_v1(v_account);
 -- A direct legacy key change cannot retain a validated recipient fingerprint.
 update public.llm_settings set copilot_recipient=null where user_id=v_account and copilot_recipient is not null;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end;
$function$;
create trigger invalidate_copilot_key after insert or update or delete on public.llm_keys
 for each row execute function private.invalidate_copilot_key_v1();

create function private.own_copilot_account_v1(p_account_id uuid,p_session_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,private as $function$
begin
 perform 1 from auth.users where id=p_account_id and deleted_at is null
 and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id
 and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.profiles where id=p_account_id and deletion_requested_at is null for update;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
end;
$function$;

create function public.save_own_copilot_settings_v1(p_account_id uuid,p_session_id uuid,p_settings jsonb,
 p_encrypted_key bytea,p_key_fingerprint text,p_key_last4 text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
declare prior public.llm_settings%rowtype; recipient jsonb; fingerprint text; v_revision bigint;
begin
 perform private.own_copilot_account_v1(p_account_id,p_session_id);
 if jsonb_typeof(p_settings) is distinct from 'object' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if (select count(*) from jsonb_object_keys(p_settings))<>7
  or exists(select 1 from jsonb_each(p_settings) item where jsonb_typeof(item.value) is distinct from 'string')
  or not p_settings ?& array['provider','baseUrl','model','origin','providerLabel','providerClass','runtimeAttestationFingerprint']
  or coalesce(p_settings->>'provider','') not in ('anthropic','openai_compatible')
  or coalesce(p_settings->>'providerClass','') not in ('local','cloud')
  or nullif(p_settings->>'model','') is null or length(p_settings->>'model')>200
  or nullif(p_settings->>'providerLabel','') is null or length(p_settings->>'providerLabel')>255
  or coalesce(p_settings->>'origin','')!~'^https?://[^/?#@]+$'
  or coalesce(p_settings->>'baseUrl','')!~'^https?://[^?#@]+$'
  or coalesce(p_settings->>'runtimeAttestationFingerprint','')!~'^[0-9a-f]{64}$'
  or (p_settings->>'providerClass'='cloud' and p_settings->>'origin'!~'^https://') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into prior from public.llm_settings where user_id=p_account_id for update;
 if p_encrypted_key is not null then
  if length(p_encrypted_key)<29 or length(p_encrypted_key)>8192 or p_key_fingerprint is null
   or p_key_fingerprint!~'^[0-9a-f]{64}$' or p_key_last4 is null or length(p_key_last4)<>4 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  fingerprint:=p_key_fingerprint;
  insert into public.llm_keys(user_id,encrypted_key,updated_at) values(p_account_id,p_encrypted_key,clock_timestamp())
   on conflict(user_id) do update set encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at;
 elsif exists(select 1 from public.llm_keys where user_id=p_account_id) then
  if prior.copilot_recipient is null or prior.copilot_recipient->>'origin' is distinct from p_settings->>'origin'
   or prior.provider is distinct from p_settings->>'provider' then
   raise exception using errcode='55000',message='key_required'; end if;
  fingerprint:=prior.copilot_recipient->>'credentialFingerprint';
 else
  if p_settings->>'provider'='anthropic' or p_key_fingerprint is null or p_key_fingerprint!~'^[0-9a-f]{64}$' then
   raise exception using errcode='55000',message='key_required'; end if;
  fingerprint:=p_key_fingerprint;
 end if;
 recipient:=p_settings||jsonb_build_object('credentialFingerprint',fingerprint);
 perform set_config('inherit.canonical_copilot_settings','v1',true);
 insert into public.llm_settings(user_id,provider,base_url,model,key_last4,copilot_recipient,updated_at)
 values(p_account_id,p_settings->>'provider',case when p_settings->>'provider'='anthropic' then null else p_settings->>'baseUrl' end,
 p_settings->>'model',coalesce(p_key_last4,prior.key_last4),recipient,clock_timestamp())
 on conflict(user_id) do update set provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,
 key_last4=excluded.key_last4,copilot_recipient=excluded.copilot_recipient,updated_at=excluded.updated_at
 returning (copilot_recipient->>'revision')::bigint into v_revision;
 perform set_config('inherit.canonical_copilot_settings','',true);
 return jsonb_build_object('saved',true,'settingsRevision',v_revision);
end;
$function$;

create function public.remove_own_copilot_settings_v1(p_account_id uuid,p_session_id uuid) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
 perform private.own_copilot_account_v1(p_account_id,p_session_id);
 delete from public.llm_keys where user_id=p_account_id;
 delete from public.llm_settings where user_id=p_account_id;
 perform private.invalidate_own_copilot_v1(p_account_id);
 return true;
end;
$function$;

insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
select key,1,encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),body,body,date '2026-09-07'
from (values
 ('consent.own-copilot-local','Allow Copilot to use my prepared DNA observations and the report types I have separately enabled to answer my questions on the named model running beside my own Inherit server. Saving a model does not grant this permission. I can withdraw it at any time.'),
 ('consent.own-copilot-cloud','Allow Copilot to use my prepared DNA observations and the report types I have separately enabled to answer my questions with the named provider, model and address. The separate cloud disclosure permission names the information sent. Saving a model does not grant either permission. I can withdraw them at any time.')
) a(key,body);

create function private.own_copilot_configuration_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $function$
declare c jsonb; s public.llm_settings%rowtype; v_revision bigint; r jsonb;
begin
 -- The existing context locks and requires a self subject with active lifecycle.
 -- Other lifecycle states cannot restart through this own-only path; the
 -- authority resolver separately requires the exact unrevoked purpose grant.
 c:=public.own_report_context_v1(p_account_id,p_session_id,p_subject_id);
 select copilot_settings_revision into v_revision from public.profiles where id=p_account_id;
 select * into s from public.llm_settings where user_id=p_account_id for share;
 r:=s.copilot_recipient;
 if r is null or r->>'revision' is distinct from v_revision::text
  or r->>'provider' is distinct from s.provider or r->>'model' is distinct from s.model
  or (s.provider='openai_compatible' and r->>'baseUrl' is distinct from s.base_url)
  or coalesce(r->>'providerClass','') not in ('local','cloud')
  or coalesce(r->>'runtimeAttestationFingerprint','')!~'^[0-9a-f]{64}$'
  or coalesce(r->>'credentialFingerprint','')!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('accountId',p_account_id,'sessionId',p_session_id,'subjectId',p_subject_id,
  'context',c,'settingsRevision',v_revision,'recipientRevision',v_revision,
  'providerClass',r->>'providerClass','runtimeAttestationRevision',1,'runtimeAttestationFingerprint',r->>'runtimeAttestationFingerprint');
end;
$function$;
create function public.own_copilot_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
declare c jsonb; keys text[]; a jsonb;
begin
 c:=private.own_copilot_configuration_v1(p_account_id,p_session_id,p_subject_id);
 keys:=case when c->>'providerClass'='cloud' then array['consent.own-copilot-cloud','consent.copilot-cloud-model']
 else array['consent.own-copilot-local'] end;
 perform 1 from public.consent_artifacts where artifact_key=any(keys) and superseded_at is null for share;
 select jsonb_agg(jsonb_build_object('key',artifact_key,'version',version,'body',body_markdown,'sha256',body_sha256) order by artifact_key)
 into a from public.consent_artifacts where artifact_key=any(keys) and superseded_at is null
 and published_at<=clock_timestamp() and effective_on<=timezone('UTC',clock_timestamp())::date
 and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex');
 if jsonb_array_length(a) is distinct from cardinality(keys) then raise exception using errcode='55000',message='consent_artifact_changed'; end if;
 return jsonb_build_object('snapshot',c,'artifacts',a);
end;
$function$;

create function private.own_copilot_authority_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare c jsonb; g public.purpose_grants%rowtype; sc public.subject_consents%rowtype; v_purpose text; v_key text; result jsonb; recipient jsonb;
begin
 c:=private.own_copilot_configuration_v1(p_account_id,p_session_id,p_subject_id);
 v_purpose:='copilot.'||(c->>'providerClass'); v_key:='consent.own-copilot-'||(c->>'providerClass');
 select copilot_recipient into recipient from public.llm_settings where user_id=p_account_id;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_signatures cs on cs.id=pg.signature_id
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
 where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=v_purpose
 and pg.signer_principal_id=(c#>>'{context,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
 and pg.subject_binding_revision=(c#>>'{context,subjectBindingRevision}')::bigint
 and pg.jurisdiction_revision=(c#>>'{context,jurisdictionRevision}')::bigint
 and pg.copilot_recipient_revision=(c->>'recipientRevision')::bigint
 and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
 and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id
 and dg.recipient_principal_id=pg.signer_principal_id and dg.relationship_id is null and dg.pair_id is null
 and dg.relationship_or_pair_revision=(c#>>'{context,accountBindingRevision}')::bigint
 and dg.self_principal_revision=(c#>>'{context,principalRevision}')::bigint
 and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
 and ca.effective_on<=timezone('UTC',clock_timestamp())::date
 and ca.body_sha256=pg.artifact_body_sha256
 and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 and cs.artifact_key=ca.artifact_key and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
 and cs.signer_account_id=p_account_id and cs.signer_principal_id=pg.signer_principal_id
 and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.purpose=v_purpose
 and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
 for share of pg,dg,cs,ca;
 if g.grant_id is null then return null; end if;
 if c->>'providerClass'='cloud' then
  select s.* into sc from public.subject_consents s
  join public.consent_signatures cs on cs.id=s.signature_id
  join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  where s.account_id=p_account_id and s.subject_id=p_subject_id and s.cohort_id is null
  and s.consent_type='cloud_model' and s.copilot_recipient=recipient
  and s.scope=array['genotypes','variant_search','reports','prs_coverage','chat_messages']::text[]
  and s.revoked_at is null and (s.expires_at is null or s.expires_at>clock_timestamp())
  and cs.signer_account_id=p_account_id and cs.signer_principal_id=g.signer_principal_id
  and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.purpose='copilot.cloud'
  and cs.subject_binding_revision=(c#>>'{context,subjectBindingRevision}')::bigint
  and cs.jurisdiction_revision=(c#>>'{context,jurisdictionRevision}')::bigint
  and ca.artifact_key='consent.copilot-cloud-model' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and cs.artifact_body_sha256=ca.body_sha256
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex') for share of s,cs,ca;
  if sc.id is null then return null; end if;
 end if;
 result:=c||jsonb_build_object('copilotGrantId',g.grant_id,'copilotGrantRevision',g.grant_revision,
 'providerGrantId',sc.id,'providerGrantRevision',sc.grant_revision);
 if p_expected is not null and result is distinct from p_expected then return null; end if;
 return result;
exception when insufficient_privilege or object_not_in_prerequisite_state then return null;
end;
$function$;
create function public.own_copilot_authority_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_expected jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.own_copilot_authority_v1(p_account_id,p_session_id,p_subject_id,p_expected);
$function$;

create function public.grant_own_copilot_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_snapshot jsonb,p_artifacts jsonb,p_nonce_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
declare presentation jsonb; c jsonb; a jsonb; v_key text; v_purpose text; principal uuid; signature uuid; v_grant_id uuid;
 recipient jsonb; v_provider_key text; existing jsonb; v_now timestamptz:=clock_timestamp();
begin
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_expires_at is null
 or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes'
 or jsonb_typeof(p_snapshot) is distinct from 'object' or jsonb_typeof(p_artifacts) is distinct from 'array' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 presentation:=public.own_copilot_presentation_v1(p_account_id,p_session_id,p_subject_id);
 c:=presentation->'snapshot';
 if p_expires_at<=clock_timestamp() then raise exception using errcode='22023',message='invalid_request'; end if;
 if c is distinct from p_snapshot or presentation->'artifacts' is distinct from p_artifacts then
 raise exception using errcode='42501',message='not_found'; end if;
 insert into public.purpose_grant_nonces(nonce_hash,account_id) values(p_nonce_hash,p_account_id);
 existing:=private.own_copilot_authority_v1(p_account_id,p_session_id,p_subject_id,null);
 if existing is not null then return existing; end if;
 principal:=(c#>>'{context,principalId}')::uuid; v_purpose:='copilot.'||(c->>'providerClass');
 v_key:='consent.own-copilot-'||(c->>'providerClass');
 select copilot_recipient into recipient from public.llm_settings where user_id=p_account_id;
 -- Replace only prior canonical self Copilot grants; never a report or another recipient.
 with ended as (
  update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
  from public.directional_grants dg where dg.grant_id=pg.grant_id and pg.target_kind='subject' and pg.target_id=p_subject_id
  and pg.purpose in ('copilot.local','copilot.cloud') and pg.copilot_recipient_revision is not null
  and pg.revoked_at is null and dg.direction='self' and dg.recipient_account_id=p_account_id returning pg.grant_id
 ) update public.directional_grants set status='superseded',ended_at=v_now where directional_grants.grant_id in(select ended.grant_id from ended);
 for a in select value from jsonb_array_elements(p_artifacts) loop
  insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
   signer_account_id,target_kind,target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
  select a->>'key',(a->>'version')::integer,a->>'sha256',principal,p_account_id,'subject',p_subject_id,v_purpose,
   array['model-named','data-classes-named','raw-file-excluded','revocable'],coalesce(jurisdiction_code,'ZZ'),jurisdiction_revision,
   (c#>>'{context,subjectBindingRevision}')::bigint from public.profiles where id=p_account_id returning id into signature;
  if a->>'key'=v_key then
   insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,artifact_body_sha256,
    signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,jurisdiction_code,jurisdiction_revision,copilot_recipient_revision)
   select 1,'subject',p_subject_id,v_purpose,a->>'key',(a->>'version')::integer,a->>'sha256',signature,principal,principal,
    (c#>>'{context,subjectBindingRevision}')::bigint,coalesce(jurisdiction_code,'ZZ'),jurisdiction_revision,(c->>'recipientRevision')::bigint
   from public.profiles where id=p_account_id returning purpose_grants.grant_id into v_grant_id;
   insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,relationship_or_pair_revision,direction,self_principal_revision)
   values(v_grant_id,1,principal,p_account_id,(c#>>'{context,accountBindingRevision}')::bigint,'self',(c#>>'{context,principalRevision}')::bigint);
  else
   v_provider_key:='canonical:'||p_account_id::text||':'||(c->>'recipientRevision');
   update public.subject_consents set revoked_at=v_now,revocation_reason='superseded' where account_id=p_account_id
    and subject_id=p_subject_id and consent_type='cloud_model' and copilot_recipient is not null and revoked_at is null;
   insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope,provider_key,grant_revision,copilot_recipient)
   values(signature,p_subject_id,p_account_id,'cloud_model',array['genotypes','variant_search','reports','prs_coverage','chat_messages'],
    v_provider_key,1,recipient);
  end if;
 end loop;
 update public.purpose_grant_nonces set grant_id=v_grant_id where nonce_hash=p_nonce_hash;
 perform private.append_legal_audit_event('purpose.granted',null,'api.consents','accepted',jsonb_build_object('purpose',v_purpose,'direction','self','revision',1));
 existing:=private.own_copilot_authority_v1(p_account_id,p_session_id,p_subject_id,null);
 if existing is null then raise exception using errcode='42501',message='not_found'; end if;
 return existing;
end;
$function$;

create function public.revoke_own_copilot_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_expected jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $function$
declare a jsonb; v_now timestamptz:=clock_timestamp();
begin
 if jsonb_typeof(p_expected) is distinct from 'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 a:=private.own_copilot_authority_v1(p_account_id,p_session_id,p_subject_id,p_expected);
 if a is null then raise exception using errcode='42501',message='not_found'; end if;
 update public.purpose_grants set revoked_at=v_now,revocation_reason='withdrawn' where grant_id=(a->>'copilotGrantId')::uuid;
 update public.directional_grants set status='revoked',ended_at=v_now where grant_id=(a->>'copilotGrantId')::uuid;
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn' where id=(a->>'providerGrantId')::uuid;
 return true;
end;
$function$;

-- Grant recipient provenance survives revocation unchanged; teardown may delete rows.
create function private.freeze_own_copilot_recipient_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
 if TG_TABLE_NAME='purpose_grants' then
  if NEW.copilot_recipient_revision is distinct from OLD.copilot_recipient_revision then
   raise exception using errcode='42501',message='immutable_recipient'; end if;
 else
  if NEW.copilot_recipient is distinct from OLD.copilot_recipient then
   raise exception using errcode='42501',message='immutable_recipient'; end if;
 end if;
 return NEW;
end;
$function$;
create trigger freeze_own_copilot_purpose_recipient before update on public.purpose_grants
 for each row execute function private.freeze_own_copilot_recipient_v1();
create trigger freeze_own_copilot_cloud_recipient before update on public.subject_consents
 for each row execute function private.freeze_own_copilot_recipient_v1();

-- Service-only entrypoints; inherited public execution is always revoked.
do $acl$
declare r record;
begin
 for r in select p.oid::regprocedure signature,n.nspname schema_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.proname in (
 'freeze_own_copilot_recipient_v1','guard_copilot_profile_revision_v1','invalidate_own_copilot_v1','guard_copilot_settings_v1','invalidate_copilot_key_v1',
 'own_copilot_account_v1','save_own_copilot_settings_v1','remove_own_copilot_settings_v1','own_copilot_configuration_v1',
 'own_copilot_presentation_v1','own_copilot_authority_v1','grant_own_copilot_v1','revoke_own_copilot_v1') loop
 execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end;
$acl$;
