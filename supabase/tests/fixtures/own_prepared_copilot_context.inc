-- Caller supplies one real account/session/subject tuple in this temp table.
-- All settings, permission and context operations use the real public facade.
\ir own_copilot_synthetic_settings.inc
select public.save_own_copilot_settings_v1(account_id,session_id,
 pg_temp.synthetic_copilot_settings(),null,repeat('b',64),null) from prepared_copilot_binding;
create temporary table prepared_copilot_authority as
 select public.grant_own_copilot_v1(account_id,session_id,subject_id,presentation->'snapshot',presentation->'artifacts',
 repeat('c1',32),clock_timestamp()+interval '9 minutes') value
 from prepared_copilot_binding cross join lateral
 (select public.own_copilot_presentation_v1(account_id,session_id,subject_id) presentation) p;
create function pg_temp.prepared_chat(op text,payload jsonb default '{}',chat_id uuid default null,expected jsonb default null)
returns jsonb language sql as $$
 select public.own_copilot_chat_v1(op,account_id,session_id,subject_id,
 (select value from prepared_copilot_authority),expected,chat_id,payload) from prepared_copilot_binding;
$$;
create temporary table prepared_chat_projection as select pg_temp.prepared_chat('prepare') value;
create function pg_temp.prepared_turn(nonce text,chat_id uuid default null,last_ordinal integer default 0)
returns jsonb language plpgsql as $$
begin
 if chat_id is null then
  perform pg_temp.prepared_chat('begin',jsonb_build_object('nonceHash',nonce,'expiresAt',clock_timestamp()+interval '9 minutes'),
   null,(select value from prepared_chat_projection));
 end if;
 return pg_temp.prepared_chat('commit',jsonb_build_object('message','Synthetic question','answer','Synthetic answer',
  'citations','[]'::jsonb,'lastOrdinal',last_ordinal,'nonceHash',nonce),chat_id,(select value from prepared_chat_projection));
end; $$;
grant select on prepared_copilot_binding,prepared_copilot_authority,prepared_chat_projection to service_role;
