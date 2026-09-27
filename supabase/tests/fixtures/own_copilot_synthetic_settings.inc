-- Exact synthetic recipient JSON shared from the canonical Copilot fixture.
-- No endpoint is contacted by these rollback-only SQL tests.
create function pg_temp.synthetic_copilot_settings(model_name text default 'synthetic-model',class text default 'cloud')
returns jsonb language sql immutable as $$
 select jsonb_build_object('provider','openai_compatible','baseUrl',case when class='local' then 'http://localhost:3103/v1' else 'https://model.synthetic.invalid/v1' end,'model',model_name,
 'origin',case when class='local' then 'http://localhost:3103' else 'https://model.synthetic.invalid' end,'providerLabel','Synthetic model','providerClass',class,'runtimeAttestationFingerprint',repeat('a',64));
$$;
