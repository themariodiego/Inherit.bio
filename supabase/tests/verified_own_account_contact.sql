begin;
select no_plan();
-- Actual v2 draft → publication → transfer → optional profile → reviewer /
-- documentary completion. All Auth/document/provider metadata is synthetic;
-- no browser-issued Auth, human documentary or provider delivery credit.
\ir fixtures/verified_account_keyless_documents.inc
create temporary table account_contact as select contact.* from public.encrypted_contact_references contact
 join public.subject_principals principal on principal.id=contact.principal_id
 where principal.account_id='7a000000-0000-0000-0000-000000000001' and principal.principal_kind='account_subject'
  and contact.status='current';
select is((select count(*) from account_contact),1::bigint,'v2 actually produces exactly one self-account contact');
select ok((select c.account_mail_contact_revision=p.mail_contact_revision and c.authority_revision=sp.principal_revision
 from account_contact c join public.subject_principals sp on sp.id=c.principal_id join public.profiles p on p.id=sp.account_id),
 'the produced contact binds independent current mail and principal revisions');
select ok((select bool_and(contact.account_mail_contact_revision is null) from public.encrypted_contact_references contact
 join public.subject_principals sp on sp.id=contact.principal_id where sp.principal_kind<>'account_subject'),
 'distinct genetic-parent and legacy contacts receive no inferred account authority');
create temporary table contact_snapshot as select jsonb_build_object('contact',(select to_jsonb(c) from account_contact c),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h
  where h.contact_reference_id=(select id from account_contact))) body;
create function pg_temp.account_draft(p_nonce text,p_session uuid default '7a000000-0000-4000-8000-0000000000a1',
 p_email text default 'embryo-owner@example.invalid',p_count integer default 3,p_set jsonb default jsonb_build_object('1',repeat('a',64)))
returns jsonb language sql as $$
 select to_jsonb(d) from public.create_embryo_cohort_draft_v2('7a000000-0000-0000-0000-000000000001',p_session,
  'own_embryos','true_two_parent',p_count,extensions.gen_random_bytes(64),null,
  array[repeat('bb',64)],null,p_nonce,true,p_set,jsonb_build_array(jsonb_build_object('1',repeat('b',64))),p_email) d;
$$;
set local role service_role;
select lives_ok($$select pg_temp.account_draft('account-v2-reuse-0001')$$,'actual service v2 reuses exact current account authority');
select throws_ok($$select pg_temp.account_draft('account-v2-foreign-session','7a000000-0000-4000-8000-0000000000b1')$$,
 '42501','recent_reauthentication_required','foreign actual session cannot produce own contact');
select throws_ok($$select pg_temp.account_draft('account-v2-email-mismatch',p_email=>'stranger@example.invalid')$$,
 '42501','verified account contact unavailable','server email must match the current verified Auth row');
select throws_ok($$select pg_temp.account_draft('account-v2-bad-count-0001',p_count=>0)$$,
 '22023','invalid draft request','original canonical draft refusal remains exact');
select throws_ok($$select pg_temp.account_draft('account-v2-reuse-0001')$$,
 '23505','operation nonce already used','the actual v1 nonce is neither replaced nor consumed twice');
reset role;
select is(jsonb_build_object('contact',(select to_jsonb(c) from public.encrypted_contact_references c where id=(select id from account_contact)),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h where h.contact_reference_id=(select id from account_contact))),
 (select body from contact_snapshot),'reuse and refused requests preserve contact/index rows byte-exact without renewing deadlines');
-- Each planted invalid authority runs in a rollback-only subtransaction.
create function pg_temp.refuse_changed_contact(p_case text) returns boolean language plpgsql as $$
declare result boolean;
begin
 begin
  if p_case='unconfirmed' then update auth.users set email_confirmed_at=null where id='7a000000-0000-0000-000000000001';
  elsif p_case='deleted' then update auth.users set deleted_at=clock_timestamp() where id='7a000000-0000-0000-000000000001';
  elsif p_case='expired' then update auth.sessions set not_after=clock_timestamp() where id='7a000000-0000-4000-8000-0000000000a1';
  elsif p_case='stale' then update public.encrypted_contact_references set account_mail_contact_revision=account_mail_contact_revision+1 where id=(select id from account_contact);
  elsif p_case='legacy' then update public.encrypted_contact_references set account_mail_contact_revision=null where id=(select id from account_contact);
  elsif p_case='duplicate' then insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision)
   select principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision from account_contact;
  elsif p_case='hold' then update public.profiles set deletion_requested_at=clock_timestamp() where id='7a000000-0000-0000-000000000001';
  else raise exception 'unknown fixture case';end if;
  begin perform pg_temp.account_draft('v2-invalid-'||p_case||'-000001');result:=false;
  exception when insufficient_privilege then result:=true;end;
  raise exception using errcode='P0002',message=case when result then 'refused' else 'accepted' end;
 exception when no_data_found then result:=sqlerrm='refused';end;
 return result;
end $$;
select ok(pg_temp.refuse_changed_contact(mode),'v2 refuses exact planted '||mode||' authority without promotion')
 from unnest(array['unconfirmed','deleted','expired','stale','legacy','duplicate','hold']) mode;
-- Genuine current reviewer API. Unlike the old notice fixture, no account
-- contact is manually inserted: the canonical v2 publication produced it.
set local role authenticated;
create temporary table produced_notice as select public.prepare_keyless_owner_notice_v1(
 (select review from keyless_ids),1,pg_temp.keyless_hash('v2-owner-notice-decision'),extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
 ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
 jsonb_build_object('1',repeat('a',64)),jsonb_build_object('1',repeat('b',64)),pg_temp.keyless_lookup()#>>'{scope,comparisonReceiptDigest}',
 extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),gen_random_uuid(),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64))) body;
select is((select body->>'state' from produced_notice),'approved_pending_owner_notice','actual v2 contact enables the real authenticated notice transaction');
reset role;
select ok(private.keyless_owner_notice_current_v1((select review from keyless_ids)),'the current immutable notice binds the newly produced contact');
create temporary table preserved_notice as select to_jsonb(n) body from public.future_person_claim_notices n where claim_id=(select review from keyless_ids);
create temporary table preserved_parent_contacts as select jsonb_agg(to_jsonb(c) order by c.id) body from public.encrypted_contact_references c
 join public.subject_principals sp on sp.id=c.principal_id where sp.principal_kind='genetic_parent';
update auth.users set email='new-verified-owner@example.invalid' where id='7a000000-0000-0000-0000-000000000001';
select ok((select status='rotated' and ended_at is not null from public.encrypted_contact_references where id=(select id from account_contact)),
 'actual Auth email transition rotates only the proven old self-account contact');
select ok(not exists(select 1 from public.contact_hmac_indexes where contact_reference_id=(select id from account_contact) and status='current'),
 'actual Auth transition revokes every exact old account contact index');
select is(private.keyless_owner_notice_current_v1((select review from keyless_ids)),false,'old immutable notice loses authority after actual email transition');
select is((select to_jsonb(n) from public.future_person_claim_notices n where claim_id=(select review from keyless_ids)),
 (select body from preserved_notice),'email transition never rewrites notice identity or fixed deadlines');
select is((select jsonb_agg(to_jsonb(c) order by c.id) from public.encrypted_contact_references c join public.subject_principals sp on sp.id=c.principal_id
 where sp.principal_kind='genetic_parent'),(select body from preserved_parent_contacts),'email transition preserves every distinct genetic-parent contact byte-exact');
set local role service_role;
select throws_ok($$select pg_temp.account_draft('v2-old-email-after-change')$$,'42501','verified account contact unavailable','old server email refuses after current Auth changes');
select lives_ok($$select pg_temp.account_draft('v2-new-email-after-change',p_email=>'new-verified-owner@example.invalid')$$,
 'a fresh v2 request can independently create new current verified account authority');
reset role;
select is((select count(*) from public.encrypted_contact_references c join public.subject_principals sp on sp.id=c.principal_id
 where sp.principal_kind='account_subject' and sp.account_id='7a000000-0000-0000-000000000001' and c.status='current'),1::bigint,
 'the successor account authority is unique and does not resurrect the old notice');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 cross join unnest(array['private.create_verified_account_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)',
 'private.invalidate_verified_account_auth_contact_v1()']) fn where has_function_privilege(role,fn,'execute')),0::bigint,'all API roles are denied every new private helper');
select ok(has_function_privilege('service_role','public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute')
 and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role where has_function_privilege(role,
 'public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute')),
 'only service can execute the new public producer door');
set constraints all immediate;
select * from finish();
rollback;
