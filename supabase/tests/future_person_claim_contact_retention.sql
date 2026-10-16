begin;
select no_plan();
\ir fixtures/future_person_custody_source.inc
\ir fixtures/future_person_custody_approved.inc
-- The custody fixture targets the exact retained working-material effect.
-- The separate release journey proves creation through the human API door.
select private.detach_future_person_subject_v1((select review from custody_ids));
select private.queue_future_person_release_v1((select review from custody_ids),
 '7e100000-0000-4000-8000-000000000002',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact-retention')));
create temporary table contact_retention as select t.id,t.fixed_deadline,p.immutable_envelope,m.id manifest_id
 from public.retention_rows t join public.retention_due_phases p on p.retention_row_id=t.id
 join public.purge_manifests m on m.retention_row_id=t.id where t.retention_id='future-person.claimed-unbound-24mo'
 and t.target_id=(select claimant from custody_ids);
select is((select count(*) from contact_retention),1::bigint,'release commits exactly one fixed claimant-working retention row');
select ok((select t.fixed_deadline=c.created_at+interval '24 months' and p.phase_deadline=t.fixed_deadline
 and p.target_id=(select claimant from custody_ids) and t.target_kind='claim'
 from public.retention_rows t join public.retention_due_phases p on p.retention_row_id=t.id
 join public.encrypted_contact_references c on c.id=(p.immutable_envelope->>'contactReferenceId')::uuid
 where t.id=(select id from contact_retention)), 'only contact delivery starts the fixed clock; no subject-source clock is introduced');
select is(public.purge_due_future_person_contacts_v1(),0,'the selector-free service drain cannot purge contact before its fixed deadline');
select throws_ok($$update public.retention_rows set fixed_deadline=fixed_deadline+interval '1 day' where id=(select id from contact_retention)$$,
 '23514','claimant contact deadline is immutable','the original contact deadline cannot be extended');
select throws_ok($$update public.retention_due_phases set immutable_envelope=jsonb_set(immutable_envelope,'{subjectId}',to_jsonb(gen_random_uuid())) where retention_row_id=(select id from contact_retention)$$,
 '23514','claimant contact deadline is immutable','a due phase cannot be moved to another subject');
select ok(not has_function_privilege('service_role','private.purge_future_person_contact_phase_v1(uuid,timestamptz)','execute')
 and not has_function_privilege('authenticated','private.purge_future_person_contact_phase_v1(uuid,timestamptz)','execute')
 and has_function_privilege('service_role','public.purge_due_future_person_contacts_v1()','execute')
 and not has_function_privilege('authenticated','public.purge_due_future_person_contacts_v1()','execute'),
 'the public worker cannot accept a claimant selector or supplied clock and no API can invoke the private test clock');
create function pg_temp.claim_release() returns text language plpgsql as $$
declare r record;n integer;
begin for n in 1..30 loop
 select * into r from public.claim_mail_outbox();
 if r.outbox_id is null then return null;end if;
 if r.outbox_id=((select immutable_envelope from contact_retention)->>'outboxId')::uuid then return r.delivery_token;end if;
 end loop;return null;end $$;
create temporary table delivery as select pg_temp.claim_release() token;
select ok((select token~'^[A-Za-z0-9_-]{43}$' from delivery),'contact fixture uses the real hash-only worker token');
select public.activate_rights_session_v1(encode(extensions.digest(convert_to((select token from delivery),'UTF8'),'sha256'),'hex'),
 pg_temp.h('contact-rights'),'contact-retention-activation-nonce');
select public.issue_future_person_recovery_key_v1(pg_temp.h('contact-rights'),'contact-retention-recovery-nonce',pg_temp.h('contact-recovery'));
create function pg_temp.durable_snapshot() returns jsonb language sql as $$
 select jsonb_build_object('subject',(select to_jsonb(s) from public.subjects s where id=(select subject from custody_ids)),
 'source',(select to_jsonb(s) from private.embryo_canonical_sources s where file_id=(select file from custody_ids)),
 'parts',(select jsonb_agg(to_jsonb(p) order by p.sequence) from private.embryo_canonical_parts p join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids)),
 'memberships',(select jsonb_agg(to_jsonb(m) order by m.sequence) from private.embryo_canonical_source_parts m where m.file_id=(select file from custody_ids)),
 'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.embryo_variants v where source_file_id=(select file from custody_ids)),
 'custody',(select to_jsonb(x) from private.future_person_custody_slices x where subject_id=(select subject from custody_ids)),
 'claimant',(select to_jsonb(c) from public.future_person_claimant_principals c where id=(select claimant from custody_ids)),
 'identity',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.future_person_claimant_identity_hmacs h where claimant_principal_id=(select claimant from custody_ids)),
 'recovery',(select jsonb_agg(to_jsonb(k) order by k.key_revision) from public.future_person_recovery_key_hashes k where claimant_principal_id=(select claimant from custody_ids)));
$$;
create temporary table original_durable as select pg_temp.durable_snapshot() body;
select ok(private.purge_future_person_contact_phase_v1((select id from contact_retention),(select fixed_deadline from contact_retention)),
 'the exact registered manifest purges contact at its original deadline without changing frozen clocks');
set constraints all immediate;
select is(pg_temp.durable_snapshot(),(select body from original_durable),'source, genotypes, immutable parts, agreement slice, claimant, identity HMAC and Recovery Key are byte-identical after contact expiry');
select is((select count(*) from private.future_person_contact_manifest_rows_v1((select claimant from custody_ids),
 ((select immutable_envelope from contact_retention)->>'contactReferenceId')::uuid,((select immutable_envelope from contact_retention)->>'outboxId')::uuid)),0::bigint,
 'service executor proves zero residual working-contact, release, token, session, nonce and mail rows');
select ok((select m.state='complete' and m.physical_purge_started_at is not null and m.frozen_manifest_hash is not null
 and m.batch_cursor>0 and t.state='complete' and p.status='succeeded'
 from public.purge_manifests m join public.retention_rows t on t.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=t.id and p.phase_id=m.phase_id where m.id=(select manifest_id from contact_retention)),
 'completion follows physical start, immutable PK receipts and positive zero-residual proof');
select ok(not exists(select 1 from public.purge_manifest_entries where manifest_id=(select manifest_id from contact_retention)
 and (status<>'deleted' or store_name~'custody|claimant_principals|identity_hmacs|recovery_key|canonical|variants|subjects')),
 'the working-only manifest never selects any durable claimant record');
select is(public.future_person_rights_view_v1(pg_temp.h('contact-rights')),null::jsonb,'expired contact credentials cannot reopen a claimant page');
select is(public.purge_due_future_person_contacts_v1(),0,'a completed phase is replay-safe and cannot select unrelated working material');
select * from finish();
rollback;
