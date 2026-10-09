-- Genuine synthetic approval/release setup. SQL metadata predecessors are
-- test-local; this is not hosted document/provider acceptance.
-- Supply the same bounded synthetic signing ciphertext as the original export
-- authority fixture, before any signature or historical custody capture exists.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir future_person_custody_source.inc
\ir future_person_custody_approved.inc
-- Restore the documentary predecessor. The real attested decision must create
-- every durable claimant, custody and delivery row itself, atomically.
delete from public.future_person_claimant_principals where id=(select claimant from custody_ids);
delete from public.future_person_claims where id=(select review from custody_ids);
delete from public.future_person_claim_sessions where id=(select intake from custody_ids);
delete from public.subject_principals where id=(select principal from custody_ids);
delete from private.claim_review_decisions where review_id=(select review from custody_ids);
delete from private.claim_review_reads where review_id=(select review from custody_ids);
update private.claim_reviews set state='document_review_pending',review_revision=1 where id=(select review from custody_ids);
create function pg_temp.receive(p_document uuid,p_cookie text) returns void language plpgsql as $$
declare d jsonb;proof text;n integer;
begin
 d:=public.open_claim_review_download_v1(p_document,p_cookie);
 perform public.open_claim_review_receipt_v1((d->>'session')::uuid,p_cookie,pg_temp.h('open:'||p_document));
 for n in 0..(d->>'chunkCount')::integer-1 loop
   proof:=pg_temp.h('verified-chunk:'||p_document||':'||n);
   perform public.prepare_claim_review_chunk_receipt_v1((d->>'session')::uuid,p_cookie,n,proof);
   perform public.acknowledge_claim_review_chunk_v1((d->>'session')::uuid,p_cookie,n,proof,pg_temp.h('ack:'||p_document||':'||n));
 end loop;
end $$;
select pg_temp.receive((select photo from custody_ids),pg_temp.h('photo-current'));
select pg_temp.receive((select birth from custody_ids),pg_temp.h('birth-current'));
create function pg_temp.approve() returns jsonb language sql as $$
 select public.decide_claim_review_attested_v1((select review from custody_ids),1,'approve-record-key',pg_temp.h('real-decision'),
   extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),jsonb_build_object('1',pg_temp.h('verified-tuple')),
   ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
   '7e100000-0000-4000-8000-000000000001',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact')));
$$;

select pg_temp.approve();
set constraints all immediate;
set constraints all deferred;
create temporary table release_mail as select m.id from public.mail_outbox m
 join public.future_person_claim_notices n on n.outbox_id=m.id
 where n.claim_id=(select review from custody_ids) and n.notice_kind='release';
create function pg_temp.claim_release() returns table(outbox_id uuid,key text,attempt smallint,token text) language plpgsql as $$
declare r record;n integer;
begin for n in 1..30 loop
 select * into r from public.claim_mail_outbox();
 if r.outbox_id is null then return;end if;
 if r.outbox_id=(select id from release_mail) then return query select r.outbox_id,r.idempotency_key,r.attempt_ordinal,r.delivery_token;return;end if;
 end loop;end $$;

create temporary table delivered as select * from pg_temp.claim_release();
select private.authorize_mail_submission_v1((select outbox_id from delivered),(select attempt from delivered));
select public.complete_mail_attempt((select outbox_id from delivered),(select attempt from delivered),true,pg_temp.h('provider'),'accepted');
create temporary table activated as select * from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select token from delivered),'UTF8'),'sha256'),'hex'),pg_temp.h('deletion-rights'),
 'future-person-deletion-activation-aaaaaaaa');
create function pg_temp.deletion_probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;begin
 begin execute p_setup;execute p_call into result;raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;end;return result;end $$;
