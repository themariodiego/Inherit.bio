-- Temporary claimant contact is a working-only lifetime, independent of durable custody.

create or replace function private.queue_future_person_release_v1(p_claim uuid,p_contact uuid,p_cipher bytea,p_contact_set jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare cp public.future_person_claimant_principals;sp public.subject_principals;s public.subjects;
  contact_set jsonb;active_revision bigint;outbox uuid;candidate uuid;expiry timestamptz;contact_expiry timestamptz;v_now timestamptz;
  v_retention uuid;v_envelope jsonb;
begin
 select * into cp from public.future_person_claimant_principals where claim_id=p_claim and status='current' for update;
 select * into sp from public.subject_principals where id=cp.principal_id for update;
 select * into s from public.subjects where id=sp.subject_id for update;
 if cp.id is null or s.lifecycle<>'claimed_unbound' or s.claimant_principal_id is distinct from cp.id
   or p_contact is null or p_cipher is null or octet_length(p_cipher) not between 29 and 16384 then
   raise exception using errcode='42501',message='claim review unavailable'; end if;
 contact_set:=private.resolve_hmac_set_v1('contact',null,p_contact_set);
 active_revision:=private.hmac_active_revision_v1('contact');v_now:=clock_timestamp();
 contact_expiry:=v_now+interval '24 months';expiry:=least(v_now+interval '7 days',contact_expiry);
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,created_at)
 values(p_contact,sp.id,p_cipher,contact_set->>active_revision::text,active_revision,sp.principal_revision,v_now);
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,expires_at)
 select p_contact,value,key::bigint,contact_expiry from jsonb_each_text(contact_set);
 update public.future_person_claimant_principals set contact_expires_at=contact_expiry where id=cp.id;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
   recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
 values('future-person-release','approved-future-person-release','claimed-subject',s.id,sp.id,p_contact,
   sp.principal_revision,cp.release_revision,encode(extensions.digest(convert_to('future-person-release-v1|'||cp.id||'|'||cp.release_revision,'UTF8'),'sha256'),'hex'),
   'approved-future-person-release',s.id,'{}',expiry) returning id into outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(outbox,'approved-future-person-release','claimed-subject',s.id,cp.release_revision,expiry) returning id into candidate;
 insert into public.future_person_claim_release_credentials(claim_id,claimant_principal_id,credential_hash,credential_revision,status,
   expires_at,candidate_id,subject_id,subject_lifecycle_revision,subject_binding_revision,contact_reference_id)
 values(p_claim,cp.id,encode(extensions.gen_random_bytes(32),'hex'),cp.release_revision,'current',expiry,candidate,s.id,
   s.lifecycle_revision,s.subject_binding_revision,p_contact);
 insert into public.future_person_claim_notices(claim_id,outbox_id,notice_kind,notice_revision)
 values(p_claim,outbox,'release',cp.release_revision);
 if not private.future_person_release_current_v1(candidate) then
   raise exception using errcode='42501',message='claim review unavailable'; end if;
 v_envelope:=jsonb_build_object('version',1,'subjectId',s.id,'claimantPrincipalId',cp.id,
   'principalId',sp.id,'contactReferenceId',p_contact,'outboxId',outbox,'releaseRevision',cp.release_revision);
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
 values('future-person.claimed-unbound-24mo','claim',cp.id,cp.release_revision,s.lifecycle_revision,1,contact_expiry)
 returning id into v_retention;
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 values(v_retention,'future-person.claimed-unbound-24mo','claimed-unbound-working-data-purge','purge',1,contact_expiry,
   'claim',cp.id,s.lifecycle_revision,1,'claimant-working-material',cp.release_revision,v_envelope);
 insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(v_retention,'claimed-unbound-working-data-purge',1,'notice-contact-working',1,
   encode(extensions.digest(convert_to(v_envelope::text,'UTF8'),'sha256'),'hex'));
end $$;
revoke all on function private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb) from public,anon,authenticated,service_role;

-- Classify only delivery working state with delivery stores. Frozen historical
-- manifests are never rewritten to make a new selector appear compatible.
do $$ declare v_order integer;v_store text;begin
 if exists(select 1 from public.purge_manifest_entries where target_id='claim-review-working-packages'
   and store_name in('public.future_person_claim_notices','public.future_person_claim_release_credentials')) then
   raise exception using errcode='55000',message='claimant delivery classification already frozen';end if;
 select max(store_order) into v_order from public.purge_target_stores where target_id='mail-token-and-rights-delivery-state';
 foreach v_store in array array['public.future_person_claim_notices','public.future_person_claim_release_credentials'] loop
   v_order:=v_order+1;
   insert into public.purge_target_stores(target_id,store_name,store_order)
    values('mail-token-and-rights-delivery-state',v_store,v_order);
   delete from public.purge_target_stores where target_id='claim-review-working-packages' and store_name=v_store;
 end loop;
end $$;

create function private.future_person_contact_manifest_rows_v1(p_claimant uuid,p_contact uuid,p_outbox uuid)
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $$
 select 'mail-token-and-rights-delivery-state','public.mail_outbox',jsonb_build_object('id',m.id) from public.mail_outbox m where m.id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.mail_deliveries',jsonb_build_object('id',d.id) from public.mail_deliveries d where d.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.mail_provider_attempts',jsonb_build_object('id',a.id) from public.mail_provider_attempts a where a.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.token_candidates',jsonb_build_object('id',t.id) from public.token_candidates t where t.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.token_hashes',jsonb_build_object('id',h.id) from public.token_hashes h join public.token_candidates t on t.id=h.candidate_id where t.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.rights_sessions',jsonb_build_object('id',s.id) from public.rights_sessions s join public.token_hashes h on h.id=s.token_hash_id join public.token_candidates t on t.id=h.candidate_id where t.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.rights_nonces',jsonb_build_object('rightsSessionId',n.rights_session_id,'nonceRevision',n.nonce_revision) from public.rights_nonces n join public.rights_sessions s on s.id=n.rights_session_id join public.token_hashes h on h.id=s.token_hash_id join public.token_candidates t on t.id=h.candidate_id where t.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.future_person_claim_notices',jsonb_build_object('id',n.id) from public.future_person_claim_notices n where n.outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.future_person_claim_release_credentials',jsonb_build_object('id',r.id) from public.future_person_claim_release_credentials r where r.claimant_principal_id=p_claimant and r.contact_reference_id=p_contact
 union all select 'contact-refusal-and-rate-limit-state','public.encrypted_contact_references',jsonb_build_object('id',c.id) from public.encrypted_contact_references c where c.id=p_contact
 union all select 'contact-refusal-and-rate-limit-state','public.contact_hmac_indexes',jsonb_build_object('contactReferenceId',h.contact_reference_id,'hmacKeyRevision',h.hmac_key_revision) from public.contact_hmac_indexes h where h.contact_reference_id=p_contact;
$$;
revoke all on function private.future_person_contact_manifest_rows_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The worker supplies its trusted database clock. The private clock argument
-- also permits deadline tests without editing any frozen retention binding.
create function private.purge_future_person_contact_phase_v1(p_row uuid,p_now timestamptz)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare t public.retention_rows;p public.retention_due_phases;m public.purge_manifests;
 cp public.future_person_claimant_principals;s public.subjects;contact uuid;outbox uuid;v_count integer;v_hash text;v_now timestamptz;
begin
 select * into p from public.retention_due_phases where retention_row_id=p_row and phase_id='claimed-unbound-working-data-purge' and phase_revision=1;
 if p.retention_row_id is null then return false;end if;
 perform 1 from public.subjects where id=(p.immutable_envelope->>'subjectId')::uuid for update;
 select * into t from public.retention_rows where id=p_row for update;
 select * into s from public.subjects where id=(p.immutable_envelope->>'subjectId')::uuid for update;
 select * into cp from public.future_person_claimant_principals where id=p.target_id for update;
 select * into p from public.retention_due_phases where retention_row_id=p_row and phase_id='claimed-unbound-working-data-purge' and phase_revision=1 for update;
 if p.status='succeeded' then return false;end if;
 select * into m from public.purge_manifests where retention_row_id=p_row and phase_id=p.phase_id and phase_revision=p.phase_revision for update;
 contact:=(p.immutable_envelope->>'contactReferenceId')::uuid;outbox:=(p.immutable_envelope->>'outboxId')::uuid;
 if t.retention_id<>'future-person.claimed-unbound-24mo' or t.target_kind<>'claim' or t.target_id is distinct from cp.id
   or p_now is null or t.state not in('scheduled','active') or t.fixed_deadline>p_now or p.phase_deadline is distinct from t.fixed_deadline
   or p.retention_id<>t.retention_id or p.phase_kind<>'purge' or p.target_kind<>t.target_kind or p.target_id<>t.target_id
   or p.recipient_authority_kind<>'claimant-working-material' or p.recipient_authority_revision<>t.retention_revision
   or p.status not in('pending','retry') or m.id is null or m.manifest_class<>'notice-contact-working' or m.state<>'frozen'
   or cp.id is null or s.id is null or cp.status<>'current' or s.claimant_principal_id is distinct from cp.id
   or s.lifecycle not in('claimed_unbound','claimed_bound')
   or p.immutable_envelope is distinct from jsonb_build_object('version',1,'subjectId',s.id,'claimantPrincipalId',cp.id,
     'principalId',cp.principal_id,'contactReferenceId',contact,'outboxId',outbox,'releaseRevision',t.retention_revision)
   or m.source_binding_fingerprint is distinct from encode(extensions.digest(convert_to(p.immutable_envelope::text,'UTF8'),'sha256'),'hex')
   or not exists(select 1 from public.encrypted_contact_references c where c.id=contact and c.principal_id=cp.principal_id
     and t.fixed_deadline=c.created_at+interval '24 months')
   or not exists(select 1 from public.mail_outbox o where o.id=outbox and o.contact_reference_id=contact
     and o.recipient_principal_id=cp.principal_id and o.purpose='approved-future-person-release'
     and o.target_kind='claimed-subject' and o.target_id=s.id and o.semantic_revision=t.retention_revision)
   or exists(select 1 from public.mail_outbox o where o.contact_reference_id=contact and o.id<>outbox)
   or exists(select 1 from public.future_person_claim_release_credentials r where r.contact_reference_id=contact
     and (r.claimant_principal_id<>cp.id or r.credential_revision<>t.retention_revision)) then
   raise exception using errcode='55000',message='claimant contact purge binding unavailable';end if;
 if exists(select 1 from public.purge_manifest_entries where manifest_id=m.id) then
   raise exception using errcode='55000',message='claimant contact manifest already frozen';end if;
 select count(*) into v_count from private.future_person_contact_manifest_rows_v1(cp.id,contact,outbox);
 if v_count not between 3 and 128 then raise exception using errcode='55000',message='claimant contact manifest unavailable';end if;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m.id,r.target_id,r.store_name,r.row_key,row_number() over(order by r.target_id,r.store_name,r.row_key::text)
 from private.future_person_contact_manifest_rows_v1(cp.id,contact,outbox) r;
 if exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and not exists(
   select 1 from public.purge_manifest_class_targets c where c.manifest_class=m.manifest_class and c.target_id=e.target_id)) then
   raise exception using errcode='55000',message='claimant contact manifest scope unavailable';end if;
 select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('target',target_id,'store',store_name,'key',row_key) order by entry_revision)::text,'UTF8'),'sha256'),'hex')
 into v_hash from public.purge_manifest_entries where manifest_id=m.id;
 v_now:=clock_timestamp();
 update public.purge_manifests set state='executing',physical_purge_started_at=v_now,frozen_manifest_hash=v_hash where id=m.id;
 delete from public.rights_nonces where rights_session_id in(select r.id from public.rights_sessions r join public.token_hashes h on h.id=r.token_hash_id join public.token_candidates c on c.id=h.candidate_id where c.outbox_id=outbox);
 delete from public.rights_sessions where token_hash_id in(select h.id from public.token_hashes h join public.token_candidates c on c.id=h.candidate_id where c.outbox_id=outbox);
 delete from public.future_person_claim_release_credentials where claimant_principal_id=cp.id and contact_reference_id=contact;
 delete from public.future_person_claim_notices where outbox_id=outbox;
 delete from public.token_hashes where candidate_id in(select id from public.token_candidates where outbox_id=outbox);
 delete from public.token_candidates where outbox_id=outbox;
 delete from public.mail_deliveries where outbox_id=outbox;
 delete from public.mail_provider_attempts where outbox_id=outbox;
 delete from public.mail_outbox where id=outbox;
 delete from public.contact_hmac_indexes where contact_reference_id=contact;
 delete from public.encrypted_contact_references where id=contact;
 if exists(select 1 from private.future_person_contact_manifest_rows_v1(cp.id,contact,outbox)) then
   raise exception using errcode='55000',message='claimant contact purge residual';end if;
 update public.purge_manifest_entries set status='deleted' where manifest_id=m.id;
 update public.purge_manifests set state='complete',batch_cursor=v_count where id=m.id;
 update public.retention_due_phases set status='succeeded',completed_at=v_now,terminal_outcome_code='working-material-purged',claim_token_hash=null,claim_expires_at=null where retention_row_id=p_row and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.retention_rows set state='complete',ended_at=v_now where id=p_row;
 perform private.assert_future_person_subject_custody_v1(s.id);
 return true;
end $$;
revoke all on function private.purge_future_person_contact_phase_v1(uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.purge_due_future_person_contacts_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare r record;v_count integer:=0;
begin
 for r in select p.retention_row_id from public.retention_due_phases p
   where p.retention_id='future-person.claimed-unbound-24mo' and p.phase_id='claimed-unbound-working-data-purge'
     and p.phase_deadline<=clock_timestamp() and p.status in('pending','retry')
   order by p.phase_deadline,p.retention_row_id limit 50 loop
   if private.purge_future_person_contact_phase_v1(r.retention_row_id,clock_timestamp()) then v_count:=v_count+1;end if;
 end loop;
 return v_count;
end $$;
revoke all on function public.purge_due_future_person_contacts_v1() from public,anon,authenticated,service_role;
grant execute on function public.purge_due_future_person_contacts_v1() to service_role;

create function private.guard_future_person_contact_retention_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='retention_rows' then
   if old.retention_id='future-person.claimed-unbound-24mo' or new.retention_id='future-person.claimed-unbound-24mo' then
     if to_jsonb(new)-array['state','ended_at'] is distinct from to_jsonb(old)-array['state','ended_at'] then
       raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
   end if;
 elsif tg_table_name='retention_due_phases' then
   if old.retention_id='future-person.claimed-unbound-24mo' or new.retention_id='future-person.claimed-unbound-24mo' then
     if to_jsonb(new)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at']
       is distinct from to_jsonb(old)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at'] then
       raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
   end if;
 else
   if old.phase_id='claimed-unbound-working-data-purge' or new.phase_id='claimed-unbound-working-data-purge' then
     if to_jsonb(new)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       is distinct from to_jsonb(old)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       or (old.physical_purge_started_at is not null and new.physical_purge_started_at is distinct from old.physical_purge_started_at)
       or (old.frozen_manifest_hash is not null and new.frozen_manifest_hash is distinct from old.frozen_manifest_hash)
       or new.batch_cursor<old.batch_cursor then
       raise exception using errcode='23514',message='claimant contact manifest is immutable';end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_future_person_contact_retention_v1() from public,anon,authenticated,service_role;
create trigger future_person_contact_retention_immutable before update on public.retention_rows
 for each row execute function private.guard_future_person_contact_retention_v1();
create trigger future_person_contact_phase_immutable before update on public.retention_due_phases
 for each row execute function private.guard_future_person_contact_retention_v1();
create trigger future_person_contact_manifest_immutable before update on public.purge_manifests
 for each row execute function private.guard_future_person_contact_retention_v1();
