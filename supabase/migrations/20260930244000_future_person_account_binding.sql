-- TEST-LOCAL claimant binding. Closed until the exact relocation executor is verified.
-- Historical canonical source rows remain immutable; current object locations are separate.
create table private.future_person_binding_config (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
insert into private.future_person_binding_config(singleton) values(true);
alter table private.future_person_binding_config enable row level security;
revoke all on private.future_person_binding_config from public,anon,authenticated,service_role;
create table private.future_person_account_bindings (
 id uuid primary key default gen_random_uuid(),
 subject_id uuid not null unique references public.subjects(id) on delete restrict,
 claimant_principal_id uuid not null unique references public.future_person_claimant_principals(id) on delete restrict,
 claim_id uuid not null references public.future_person_claims(id) on delete restrict,
 subject_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 claimant_revision bigint not null check(claimant_revision>0),
 release_revision bigint not null check(release_revision>0),
 principal_revision bigint not null check(principal_revision>0),
 account_id uuid not null references auth.users(id) on delete restrict,
 auth_session_id uuid not null,
 account_auth_session_revision bigint not null check(account_auth_session_revision>0),
 originating_session_revision bigint not null check(originating_session_revision>0),
 subject_binding_revision bigint not null check(subject_binding_revision>0),
 subject_lifecycle_revision bigint not null check(subject_lifecycle_revision>0),
 bound_at timestamptz not null default clock_timestamp(),
 audit_principal_id uuid not null references public.audit_principals(id) on delete restrict
);
alter table private.future_person_account_bindings enable row level security;
revoke all on private.future_person_account_bindings from public,anon,authenticated,service_role;
create table private.future_person_object_relocations (
 id uuid primary key default gen_random_uuid(),
 binding_id uuid not null references private.future_person_account_bindings(id) on delete restrict,
 part_id uuid not null unique references private.embryo_canonical_parts(id) on delete restrict,
 source_file_id uuid not null references public.genome_files(id) on delete restrict,
 old_bucket text not null, old_key text not null, old_version text not null, old_etag text not null,
 new_bucket text not null, new_key text not null unique,
 expected_bytes integer not null check(expected_bytes between 1 and 4004096),
 expected_sha256 text not null check(expected_sha256~'^[0-9a-f]{64}$'),
 state text not null default 'queued' check(state in('queued','copying','swapped','complete','cancelled')),
 claim_token_hash text, claim_expires_at timestamptz,
 new_version text, new_etag text,
 check((state='copying')=(claim_token_hash is not null and claim_expires_at is not null)),
 check((state in('swapped','complete'))=(new_version is not null and new_etag is not null))
);
alter table private.future_person_object_relocations enable row level security;
revoke all on private.future_person_object_relocations from public,anon,authenticated,service_role;

create function private.guard_future_person_binding_identity_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='future_person_account_bindings' then
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception using errcode='23514',message='claimant binding is immutable';end if;
 elsif to_jsonb(new)-array['state','claim_token_hash','claim_expires_at','new_version','new_etag']
  is distinct from to_jsonb(old)-array['state','claim_token_hash','claim_expires_at','new_version','new_etag'] then
  raise exception using errcode='23514',message='claimant relocation identity is immutable';
 end if;
 return new;
end $$;
revoke all on function private.guard_future_person_binding_identity_v1() from public,anon,authenticated,service_role;
create trigger claimant_binding_immutable before update on private.future_person_account_bindings
 for each row execute function private.guard_future_person_binding_identity_v1();
create trigger claimant_relocation_immutable before update on private.future_person_object_relocations
 for each row execute function private.guard_future_person_binding_identity_v1();

create function private.future_person_binding_account_v1()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb:=auth.jwt(); live jsonb; a uuid; s uuid;
begin
 if j->>'role' is distinct from 'authenticated' then return null;end if;
 live:=private.assert_live_authenticated_session();
 if live->>'authorized' is distinct from 'true' then return null;end if;
 a:=(j->>'sub')::uuid;s:=(j->>'session_id')::uuid;
 perform private.validate_sensitive_account_session_v1(a,s);
 if exists(select 1 from auth.mfa_factors where user_id=a and status::text='verified') then
  if j->>'aal' is distinct from 'aal2' or jsonb_typeof(j->'amr') is distinct from 'array' then return null;end if;
  if not exists(select 1 from jsonb_array_elements(j->'amr') x where x->>'method' in('totp','webauthn','phone')
   and jsonb_typeof(x->'timestamp')='number' and (x->>'timestamp')::numeric between
   extract(epoch from clock_timestamp())-900 and extract(epoch from clock_timestamp())+60) then return null;end if;
 end if;
 return live||jsonb_build_object('accountId',a,'sessionId',s);
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end $$;
revoke all on function private.future_person_binding_account_v1() from public,anon,authenticated,service_role;

create function public.future_person_binding_context_v1(p_rights_session_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a jsonb;rs public.rights_sessions;cp public.future_person_claimant_principals;s public.subjects;
begin
 if not exists(select 1 from private.future_person_binding_config where singleton and enabled) then return null;end if;
 a:=private.future_person_binding_account_v1();if a is null then return null;end if;
 rs:=private.future_person_rights_session_v1(p_rights_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'bind-account','api.future-person-claimant-bind') then return null;end if;
 select * into s from public.subjects where id=rs.target_id for update;
 select * into cp from public.future_person_claimant_principals where id=s.claimant_principal_id for update;
 if cp.status is distinct from 'current' or cp.principal_id is distinct from rs.principal_id
  or s.lifecycle is distinct from 'claimed_unbound' or exists(select 1 from private.future_person_account_bindings where subject_id=s.id)
  or not exists(select 1 from public.future_person_claimant_identity_hmacs where claimant_principal_id=cp.id and expires_at is null)
  then return null;end if;
 return a||jsonb_build_object('rightsSessionId',rs.id,'claimantPrincipalId',cp.id,'claimId',cp.claim_id,
  'claimantRevision',cp.claimant_revision,'releaseRevision',cp.release_revision,
  'subjectId',s.id,'subjectBindingRevision',s.subject_binding_revision,'subjectLifecycleRevision',s.lifecycle_revision);
end $$;
revoke all on function public.future_person_binding_context_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.future_person_binding_context_v1(text) to authenticated;

create function public.bind_future_person_account_v1(p_rights_session_hash text,p_nonce text,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare ctx jsonb;rs public.rights_sessions;s public.subjects;cp public.future_person_claimant_principals;
 sp public.subject_principals;ap uuid;v_now timestamptz;binding uuid;a uuid;audit uuid;r record;outbox uuid;contact uuid;
begin
 ctx:=public.future_person_binding_context_v1(p_rights_session_hash);
 if ctx is null or p_expected is distinct from ctx then raise exception using errcode='42501',message='claimant rights unavailable';end if;
 a:=(ctx->>'accountId')::uuid;
 rs:=private.future_person_rights_session_v1(p_rights_session_hash,true);
 select * into s from public.subjects where id=rs.target_id for update;
 select * into cp from public.future_person_claimant_principals where id=s.claimant_principal_id for update;
 select * into sp from public.subject_principals where id=cp.principal_id for update;
 select id into ap from public.subject_principals where account_id=a and principal_kind='account_subject'
  and status='active' and subject_id in(select id from public.subjects where subject_account_id=a and subject_class='self' and lifecycle='active') for update;
 if ap is null or sp.account_id is not null then raise exception using errcode='42501',message='claimant rights unavailable';end if;
 perform private.assert_future_person_subject_custody_v1(s.id);
 if not exists(select 1 from private.future_person_custody_slices x join private.embryo_canonical_source_parts m on m.file_id=x.source_file_id
  join private.embryo_canonical_parts part on part.id=m.part_id and part.state='landed'
  where x.subject_id=s.id) then raise exception using errcode='42501',message='claimant rights unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);v_now:=clock_timestamp();
 insert into public.audit_principals default values returning id into audit;
 insert into private.future_person_account_bindings(subject_id,claimant_principal_id,claim_id,subject_principal_id,claimant_revision,release_revision,principal_revision,account_id,auth_session_id,
  account_auth_session_revision,originating_session_revision,subject_binding_revision,subject_lifecycle_revision,audit_principal_id)
 values(s.id,cp.id,cp.claim_id,sp.id,cp.claimant_revision+1,cp.release_revision+1,sp.principal_revision+1,a,(ctx->>'sessionId')::uuid,(ctx->>'account_auth_session_revision')::bigint,
  (ctx->>'session_revision')::bigint,s.subject_binding_revision+1,s.lifecycle_revision+1,audit) returning id into binding;
 insert into private.future_person_object_relocations(binding_id,part_id,source_file_id,old_bucket,old_key,old_version,old_etag,
  new_bucket,new_key,expected_bytes,expected_sha256)
 select binding,p.id,x.source_file_id,p.provider_bucket,p.provider_key,p.provider_version,p.provider_etag,
  p.provider_bucket,'claimant/'||a::text||'/'||gen_random_uuid()::text,p.byte_count,p.sha256
 from private.future_person_custody_slices x join private.embryo_canonical_source_parts m on m.file_id=x.source_file_id
 join private.embryo_canonical_parts p on p.id=m.part_id where x.subject_id=s.id and p.state='landed';
 if (select count(*) from private.future_person_object_relocations where binding_id=binding) is distinct from
   (select part_count::bigint from private.embryo_canonical_sources where subject_id=s.id) then
  raise exception using errcode='42501',message='claimant rights unavailable';end if;
 update public.subject_relationships set status='revoked',ended_at=v_now,relationship_revision=relationship_revision+1 where subject_id=s.id and status in('pending','current');
 update public.subject_account_bindings set status='revoked',ended_at=v_now,binding_revision=binding_revision+1 where subject_id=s.id and status in('pending','current');
 update public.purpose_grants set revoked_at=v_now,revocation_reason='claim-bound' where target_kind='subject' and target_id=s.id and revoked_at is null;
 update public.subject_consents set revoked_at=v_now,revocation_reason='superseded' where subject_id=s.id and revoked_at is null;
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1 where target_kind='subject' and target_id=s.id and status='active';
 update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,claim_expires_at=null,claimed_by=null
  where status in('queued','running') and (subject_id=s.id or file_id in(select id from public.genome_files where subject_id=s.id))
  and kind not in('revoke_purge','retention_purge');
 update public.subject_principals set account_id=a,principal_revision=principal_revision+1 where id=sp.id;
 update public.subjects set lifecycle='claimed_bound',owner_account_id=a,subject_account_id=a,
  subject_binding_revision=subject_binding_revision+1,lifecycle_revision=lifecycle_revision+1,updated_at=v_now where id=s.id;
 update public.embryos set status='claimed_bound',disposition_revision=disposition_revision+1 where subject_id=s.id;
 update public.genome_files set user_id=a where subject_id=s.id;
 insert into public.subject_account_bindings(subject_id,subject_principal_id,account_id,account_principal_id,binding_kind,binding_revision,status)
 values(s.id,sp.id,a,ap,'future_person_claim',s.subject_binding_revision+1,'current');
 -- Only exact claim-owned unbound material is removed. Immutable deadlines are never moved.
 for r in select c.contact_reference_id,tc.outbox_id from public.future_person_claim_release_credentials c
  join public.token_candidates tc on tc.id=c.candidate_id where c.claimant_principal_id=cp.id for update of c loop
  contact:=r.contact_reference_id;outbox:=r.outbox_id;
  if exists(select 1 from public.mail_outbox where contact_reference_id=contact and id<>outbox) then
   raise exception using errcode='42501',message='claimant rights unavailable';end if;
  delete from public.rights_nonces where rights_session_id in(select id from public.rights_sessions where principal_id=sp.id);
  delete from public.rights_sessions where principal_id=sp.id;
  delete from public.future_person_claim_release_credentials where claimant_principal_id=cp.id and contact_reference_id=contact;
  delete from public.future_person_claim_notices where outbox_id=outbox;
  delete from public.token_hashes where candidate_id in(select id from public.token_candidates where outbox_id=outbox);
  delete from public.token_candidates where outbox_id=outbox;
  delete from public.mail_deliveries where outbox_id=outbox;
  delete from public.mail_provider_attempts where outbox_id=outbox;
  delete from public.mail_outbox where id=outbox;
  delete from public.contact_hmac_indexes where contact_reference_id=contact;
  delete from public.encrypted_contact_references where id=contact and principal_id=sp.id;
 end loop;
 delete from public.future_person_recovery_key_hashes where claimant_principal_id=cp.id;
 delete from public.future_person_claimant_identity_hmacs where claimant_principal_id=cp.id;
 update public.future_person_claimant_principals set claimant_revision=claimant_revision+1,release_revision=release_revision+1,contact_expires_at=v_now where id=cp.id;
 update public.retention_due_phases set status='cancelled',completed_at=v_now,terminal_outcome_code='account-bound-working-material-purged',claim_token_hash=null,claim_expires_at=null
  where target_kind='claim' and target_id=cp.id and retention_id='future-person.claimed-unbound-24mo' and status in('pending','retry','claimed');
 update public.purge_manifests set state='cancelled' where retention_row_id in(select id from public.retention_rows where target_kind='claim' and target_id=cp.id and retention_id='future-person.claimed-unbound-24mo') and state='frozen';
 update public.retention_rows set state='cancelled',ended_at=v_now where target_kind='claim' and target_id=cp.id and retention_id='future-person.claimed-unbound-24mo' and state in('scheduled','active');
 perform private.assert_future_person_subject_custody_v1(s.id);
 perform private.append_legal_audit_event('claimant.account_bound',audit,'api.future-person-claimant-bind','accepted','{}');
 return true;
end $$;
revoke all on function public.bind_future_person_account_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bind_future_person_account_v1(text,text,jsonb) to authenticated;
-- One exact queued part is the worker's authority. Historical source rows are never rewritten.
create function private.future_person_relocation_current_v1(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 return exists(select 1 from private.future_person_object_relocations r
  join private.future_person_account_bindings b on b.id=r.binding_id
  join public.subjects s on s.id=b.subject_id and s.lifecycle='claimed_bound' and s.claimant_principal_id=b.claimant_principal_id
   and s.owner_account_id=b.account_id and s.subject_account_id=b.account_id
   and s.subject_binding_revision=b.subject_binding_revision and s.lifecycle_revision=b.subject_lifecycle_revision
  join public.future_person_claimant_principals cp on cp.id=b.claimant_principal_id and cp.status='current'
   and cp.claimant_revision=b.claimant_revision and cp.release_revision=b.release_revision
  join public.subject_principals sp on sp.id=cp.principal_id and sp.id=b.subject_principal_id and sp.status='active'
   and sp.account_id=b.account_id and sp.principal_revision=b.principal_revision
  join public.future_person_claims c on c.id=b.claim_id and c.id=cp.claim_id and c.status='approved' and c.claimant_principal_id=sp.id
  join public.genome_files f on f.id=r.source_file_id and f.subject_id=s.id and f.user_id=b.account_id
  join private.future_person_custody_slices x on x.subject_id=s.id and x.source_file_id=f.id and x.claimant_principal_id=cp.id
  join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id
   and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
  join private.embryo_canonical_source_parts m on m.file_id=f.id and m.part_id=r.part_id
  join private.embryo_canonical_parts p on p.id=m.part_id and p.state='landed'
   and p.provider_bucket=r.old_bucket and p.provider_key=r.old_key and p.provider_version=r.old_version
   and p.provider_etag=r.old_etag and p.byte_count=r.expected_bytes and p.sha256=r.expected_sha256
  join auth.users u on u.id=b.account_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  join public.profiles pr on pr.id=u.id and pr.deletion_requested_at is null
  where r.id=p_id);
end $$;
revoke all on function private.future_person_relocation_current_v1(uuid) from public,anon,authenticated,service_role;
create function public.claim_future_person_relocation_v1(p_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.future_person_object_relocations;
begin
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return null;end if;
 select * into r from private.future_person_object_relocations where id=p_id for update;
 perform 1 from public.subjects s join private.future_person_account_bindings b on b.subject_id=s.id where b.id=r.binding_id for update of s,b;
 if r.id is null or r.state<>'queued' or not private.future_person_relocation_current_v1(r.id) then return null;end if;
 update private.future_person_object_relocations set state='copying',claim_token_hash=p_token_hash,claim_expires_at=clock_timestamp()+interval '5 minutes' where id=r.id;
 return jsonb_build_object('id',r.id,'oldBucket',r.old_bucket,'oldKey',r.old_key,'oldVersion',r.old_version,'oldEtag',r.old_etag,
  'newBucket',r.new_bucket,'newKey',r.new_key,'bytes',r.expected_bytes,'sha256',r.expected_sha256);
end $$;
create function public.check_future_person_relocation_v1(p_id uuid,p_token_hash text)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.future_person_object_relocations;
begin
 select * into r from private.future_person_object_relocations where id=p_id for update;
 perform 1 from public.subjects s join private.future_person_account_bindings b on b.subject_id=s.id where b.id=r.binding_id for update of s,b;
 return coalesce(r.state='copying' and r.claim_expires_at>clock_timestamp()
  and private.claim_hash_matches_v1(r.claim_token_hash,p_token_hash) and private.future_person_relocation_current_v1(r.id),false);
end $$;
create function public.swap_future_person_relocation_v1(p_id uuid,p_token_hash text,p_bytes integer,p_sha256 text,p_version text,p_etag text)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.future_person_object_relocations;
begin
 if not public.check_future_person_relocation_v1(p_id,p_token_hash) then return false;end if;
 select * into r from private.future_person_object_relocations where id=p_id for update;
 if p_bytes is distinct from r.expected_bytes or p_sha256 is distinct from r.expected_sha256
  or p_version is null or p_version!~'^[0-9a-f]{32}$' or p_etag is null or p_etag!~'^[0-9a-f]{32}$' then return false;end if;
 update private.future_person_object_relocations set state='swapped',new_version=p_version,new_etag=p_etag,
  claim_token_hash=null,claim_expires_at=null where id=r.id;
 return true;
end $$;
-- A swapped row is the current canonical location. The old immutable descriptor is historical only.
create function public.finish_future_person_relocation_v1(p_id uuid,p_old_version text,p_old_etag text)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.future_person_object_relocations;
begin
 select * into r from private.future_person_object_relocations where id=p_id for update;
 perform 1 from public.subjects s join private.future_person_account_bindings b on b.subject_id=s.id where b.id=r.binding_id for update of s,b;
 if r.state is distinct from 'swapped' or p_old_version is distinct from r.old_version or p_old_etag is distinct from r.old_etag
  or not private.future_person_relocation_current_v1(r.id) then return false;end if;
 update private.future_person_object_relocations set state='complete' where id=r.id;return true;
end $$;
revoke all on function public.claim_future_person_relocation_v1(uuid,text),public.check_future_person_relocation_v1(uuid,text),
 public.swap_future_person_relocation_v1(uuid,text,integer,text,text,text),public.finish_future_person_relocation_v1(uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.claim_future_person_relocation_v1(uuid,text),public.check_future_person_relocation_v1(uuid,text),
 public.swap_future_person_relocation_v1(uuid,text,integer,text,text,text),public.finish_future_person_relocation_v1(uuid,text,text)
 to service_role;
notify pgrst,'reload schema';
