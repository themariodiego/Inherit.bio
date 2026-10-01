begin;
select plan(8);
select ok((select prosecdef and proconfig=array['search_path=""']::text[]
  from pg_proc where oid='public.authorize_mail_submission_v1(uuid,smallint)'::regprocedure),
  'the canonical native service RPC delegates under its fixed owner and empty search path');
select ok(not has_function_privilege('service_role','private.authorize_mail_submission_v1(uuid,smallint)','EXECUTE'),
  'the service API cannot call the private dispatcher directly');
select ok(not has_function_privilege('service_role','private.authorize_mail_submission_before_keyless_notice_v1(uuid,smallint)','EXECUTE'),
  'the service API cannot bypass the canonical notice branch through its private delegate');
select ok(not has_function_privilege('anon','public.authorize_mail_submission_v1(uuid,smallint)','EXECUTE')
  and not has_function_privilege('authenticated','public.authorize_mail_submission_v1(uuid,smallint)','EXECUTE')
  and not has_function_privilege('inherit_upload_only','public.authorize_mail_submission_v1(uuid,smallint)','EXECUTE'),
  'every human browser and upload role remains denied at the native machine door');
set local role service_role;
select throws_ok($$select private.authorize_mail_submission_v1(null,1::smallint)$$,'42501',
  'permission denied for function authorize_mail_submission_v1','real service execution cannot enter the private dispatcher');
select is(public.authorize_mail_submission_v1(null,1::smallint),false,
  'real service execution reaches the native door and refuses a missing outbox');
reset role;
set local role authenticated;
select throws_ok($$select public.authorize_mail_submission_v1(null,1::smallint)$$,'42501',
  'permission denied for function authorize_mail_submission_v1','an authenticated human cannot select provider eligibility');
reset role;
set local role anon;
select throws_ok($$select public.authorize_mail_submission_v1(null,1::smallint)$$,'42501',
  'permission denied for function authorize_mail_submission_v1','an anonymous caller cannot select provider eligibility');
reset role;
select * from finish();
rollback;
