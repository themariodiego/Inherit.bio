begin;
select no_plan();
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.prepare_future_person_deletion_v1(text,text)','execute')
   or has_function_privilege(role,'private.assert_future_person_deletion_plan_v1(uuid)','execute')),0::bigint,
 'no API role can manufacture or widen a claimed-subject deletion plan');
select ok(has_function_privilege('service_role','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('anon','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute'),
 'only the service worker can drain an already sealed exact source inventory');
select throws_ok($$select private.prepare_future_person_deletion_v1(null,'claimant-delete-nonce-aaaaaaaa')$$,
 '42501','claimant deletion unavailable','missing claimant authority cannot create a deletion plan');
select throws_ok($$select private.prepare_future_person_deletion_v1(repeat('a',64),'claimant-delete-nonce-aaaaaaaa')$$,
 '42501','claimant deletion unavailable','a hash with no live approved claimant session creates no plan');
select throws_ok($$select public.future_person_deletion_parts_v1('claim',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','a missing plan cannot claim a provider object');
select throws_ok($$select public.future_person_deletion_parts_v1('acknowledge',gen_random_uuid(),repeat('a',64),'{}','{}')$$,
 '42501','claimant deletion unavailable','invented provider evidence cannot acknowledge a missing plan');
select throws_ok($$select public.future_person_deletion_parts_v1('proof',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','absence of a plan is never completion');
select throws_ok($$select public.future_person_deletion_parts_v1('complete',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','source disposal cannot claim whole-subject deletion');
select throws_ok($$select public.future_person_deletion_parts_v1('claim',gen_random_uuid(),null)$$,
 '42501','claimant deletion unavailable','a missing claim binding refuses before any provider inventory');
select * from finish();
rollback;
