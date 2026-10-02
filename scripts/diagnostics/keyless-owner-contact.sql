-- Owner-executed, disposable local diagnostic ONLY. No production execution.
-- Same canonical SQL fixture producers as the existing notice suite, without
-- its manually inserted account_subject contact. Synthetic document/provider
-- metadata and fixture JWT are not browser Auth, delivered bytes or human proof.
-- Root must run this file with psql -X -v ON_ERROR_STOP=1 on the owned test DB.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir ../../supabase/tests/fixtures/future_person_keyless_documents.inc

-- Do not insert/update an account contact to make this witness succeed.
create temporary table owner_contact_diagnostic as
select r.id review_id,s.id subject_id,e.id embryo_id,c.id cohort_id,
  p.id account_id,sp.id account_principal_id,sp.principal_revision,
  r.deadline,r.created_at+interval '62 days' package_expiry,
  s.id=e.subject_id subject_matches_embryo,
  c.owner_account_id=p.id cohort_matches_owner,
  p.deletion_requested_at is null owner_not_deleting,
  (select count(*) from public.encrypted_contact_references contact
    where contact.principal_id=sp.id and contact.status='current'
      and contact.contact_ciphertext is not null
      and contact.authority_revision=sp.principal_revision) account_contacts,
  (select count(*) from public.draft_participant_slots slot
    join public.subject_principals parent on parent.id=slot.principal_id
    join public.encrypted_contact_references contact on contact.principal_id=parent.id
      and contact.status='current' and contact.contact_ciphertext is not null
      and contact.authority_revision=parent.principal_revision
    where slot.embryo_draft_id=c.draft_id and slot.state='current'
      and parent.account_id=p.id and parent.principal_kind='genetic_parent'
      and parent.status='active' and parent.id<>sp.id) own_parent_contacts
from private.claim_reviews r
join keyless_ids fixture on fixture.review=r.id
join public.embryos e on e.id=fixture.embryo
join public.subjects s on s.id=e.subject_id
join public.embryo_cohorts c on c.id=e.cohort_id
join public.profiles p on p.id=s.owner_account_id
join lateral(select principal.* from public.subject_principals principal
  where principal.account_id=p.id and principal.principal_kind='account_subject'
    and principal.status='active' order by principal.created_at,principal.id limit 1) sp on true;

select is((select count(*) from owner_contact_diagnostic),1::bigint,
  'the actual native draft resolves exactly one current owner account subject');
select is((select account_contacts from owner_contact_diagnostic),0::bigint,
  'native cohort production has not established the account-subject contact required by the notice consumer');
select is((select own_parent_contacts from owner_contact_diagnostic),1::bigint,
  'the owner contact exists only on its distinct current genetic-parent slot');
select ok((select subject_matches_embryo and cohort_matches_owner and owner_not_deleting
  and deadline>clock_timestamp() and package_expiry>clock_timestamp()+interval '31 days'
  from owner_contact_diagnostic),'the settled owner/lifecycle/fixed-clock prerequisites remain true');
select is(pg_temp.keyless_lookup()#>>'{case,caseKind}','unclaimed_keyless',
  'the actual current authenticated documentary lookup still finds the unique parent-controlled candidate');
select ok(not exists(select 1 from public.future_person_claims
  where id=(select review_id from owner_contact_diagnostic)),
  'there is no competing already-persisted claim for this review');
set local role authenticated;
select is(pg_temp.keyless_lookup()#>>'{case,caseKind}','unclaimed_keyless',
  'the unique current lookup succeeds under the same actual API role used for the notice request');
reset role;

-- Hash all public/private rows plus Auth users/sessions before/after the
-- refused real public operation. Raw rows, contacts, tokens and IDs never print.
-- This scratch helper has no durable/API grant and disappears at ROLLBACK.
create function pg_temp.owner_contact_graph_digest() returns text language plpgsql as $$
declare relation record; rows_json jsonb; inventory jsonb:='[]';
begin
  for relation in select namespace.nspname,class.relname from pg_class class
    join pg_namespace namespace on namespace.oid=class.relnamespace
    where (namespace.nspname in('public','private') and class.relkind in('r','p'))
      or (namespace.nspname='auth' and class.relname in('users','sessions') and class.relkind='r')
    order by namespace.nspname collate "C",class.relname collate "C" loop
    execute format('select coalesce(jsonb_agg(to_jsonb(stored_row) order by to_jsonb(stored_row)::text collate "C"),''[]''::jsonb) from %I.%I stored_row',
      relation.nspname,relation.relname) into rows_json;
    inventory:=inventory||jsonb_build_array(jsonb_build_object('relation',relation.nspname||'.'||relation.relname,
      'hash',encode(extensions.digest(convert_to(rows_json::text,'UTF8'),'sha256'),'hex')));
  end loop;
  return encode(extensions.digest(convert_to(inventory::text,'UTF8'),'sha256'),'hex');
end $$;
create temporary table owner_contact_before as select pg_temp.owner_contact_graph_digest() digest;

-- The original fixture established the current reviewer/session/assignment
-- and full-document metadata. Exercise the actual authenticated public door,
-- not an owner-only call or a contact-table ACL bypass.
set local role authenticated;
select throws_ok($operation$
  select public.prepare_keyless_owner_notice_v1(
    (select review from keyless_ids),1,pg_temp.keyless_hash('owner-contact-diagnostic-decision'),
    extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
    jsonb_build_object('1',repeat('a',64)),jsonb_build_object('1',repeat('b',64)),
    pg_temp.keyless_lookup()#>>'{scope,comparisonReceiptDigest}',
    extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),
    gen_random_uuid(),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64)))
$operation$,'42501','claim review unavailable',
  'the unchanged authenticated notice producer refuses the genuinely missing account-subject contact');
reset role;
select is(pg_temp.owner_contact_graph_digest(),(select digest from owner_contact_before),
  'the complete refused operation preserves every public/private/Auth row byte-for-byte');
select is((select count(*) from public.future_person_claim_notices
  where claim_id=(select review from keyless_ids)),0::bigint,'refusal emits no owner notice');
select is((select count(*) from public.future_person_claim_review_packages
  where claim_id=(select review from keyless_ids)),0::bigint,'refusal retains no comparison package');
select is((select account_contacts from owner_contact_diagnostic),0::bigint,
  'the diagnostic did not transplant or manufacture an account contact');
select * from finish();
rollback;
