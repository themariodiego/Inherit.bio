begin;
set local statement_timeout='10s';
set local lock_timeout='250ms';
set local search_path=public,extensions;
select plan(167);
-- Public invented values only. Temporary function/tables disappear on rollback.
-- The compactor suffix below is byte-exact to the reviewed production emitter.
create function pg_temp.fitted_proof_compact_v1(p_value jsonb) returns text
language sql immutable set search_path='' as $body$
with fitted_proof_compact_value(proof) as materialized(
select p_value
), fitted_proof_compact_text as materialized(
 select proof, regexp_replace(proof::text, $fitted_json_string$("(?:[^"\\]|\\.)*")|[[:space:]]+$fitted_json_string$, $fitted_json_keep$\1$fitted_json_keep$, 'g') as compact_text
 from fitted_proof_compact_value
)
 select case when proof is not null and compact_text::jsonb is not distinct from proof
 then compact_text else null end from fitted_proof_compact_text;$body$;
create temporary table fitted_compact_cases(id text primary key,proof jsonb,expected text);
insert into fitted_compact_cases values
 ('empty-object',$json${}$json$::jsonb,$oracle${}$oracle$),
 ('empty-array',$json$[]$json$::jsonb,$oracle$[]$oracle$),
 ('json-null',$json$null$json$::jsonb,$oracle$null$oracle$),
 ('boolean-true',$json$true$json$::jsonb,$oracle$true$oracle$),
 ('boolean-false',$json$false$json$::jsonb,$oracle$false$oracle$),
 ('quoted-escape',$json$"quoted \"value\" and \\\"tail\""$json$::jsonb,$oracle$"quoted \"value\" and \\\"tail\""$oracle$),
 ('backslash-escape',$json$"backslashes \\ \\\\ literal \\n"$json$::jsonb,$oracle$"backslashes \\ \\\\ literal \\n"$oracle$),
 ('colon-space-string',$json$"left: right, [ a ] { b }"$json$::jsonb,$oracle$"left: right, [ a ] { b }"$oracle$),
 ('unicode-string',$json$"Å ø 漢字 🧬  preserved"$json$::jsonb,$oracle$"Å ø 漢字 🧬  preserved"$oracle$),
 ('control-escapes',$json$"tab\tnewline\nreturn\rbackspace\bfence\f"$json$::jsonb,$oracle$"tab\tnewline\nreturn\rbackspace\bfence\f"$oracle$),
 ('numeric-precision',$json$123456789012345678901234567890.123456789012345678900$json$::jsonb,$oracle$123456789012345678901234567890.123456789012345678900$oracle$),
 ('negative-fraction',$json$-0.0000000000000000000001234500$json$::jsonb,$oracle$-0.0000000000000000000001234500$oracle$),
 ('nested-array',$json$[ true, false, null, [ 1, 2 ], { "a" : "x: y", "b" : "a\\b" } ]$json$::jsonb,$oracle$[true,false,null,[1,2],{"a":"x: y","b":"a\\b"}]$oracle$),
 ('nested-object',$json${ "c" : { "b" : null, "a" : "space : kept" }, "b" : [ 1, true, false ], "a" : 12345678901234567890 }$json$::jsonb,$oracle${"a":12345678901234567890,"b":[1,true,false],"c":{"a":"space : kept","b":null}}$oracle$);
create temporary table fitted_compact_actual as
 select id,proof,expected,pg_temp.fitted_proof_compact_v1(proof) emitted from fitted_compact_cases;
select is(emitted::jsonb,proof,'complete native JSONB round-trip: '||id) from fitted_compact_actual order by id;
select is(convert_to(emitted,'UTF8'),convert_to(expected,'UTF8'),'whole independent compact UTF8 oracle: '||id)
 from fitted_compact_actual order by id;
select is(encode(digest(convert_to(emitted,'UTF8'),'sha256'),'hex'),
 encode(digest(convert_to(expected,'UTF8'),'sha256'),'hex'),'complete oracle digest: '||id)
 from fitted_compact_actual order by id;
select ok(octet_length(convert_to(emitted,'UTF8'))<=octet_length(convert_to(proof::text,'UTF8')),
 'only outside-string JSON formatting bytes removed: '||id) from fitted_compact_actual order by id;
select is(pg_temp.fitted_proof_compact_v1(null::jsonb),null::text,'SQL NULL refuses emission; JSON null remains a real tested scalar');

-- Public synthetic references only: no application/native authority fixture.
create function pg_temp.fitted_proof_reference_v1(p_value jsonb) returns text
language sql immutable set search_path='' as $reference_body$
with fitted_proof_compact_value(proof) as materialized(
select p_value
), fitted_proof_compact_text as materialized(
 select proof,transport,restored,regexp_replace(transport::text,
 $fitted_json_string$("(?:[^"\\]|\\.)*")|[[:space:]]+$fitted_json_string$,
 $fitted_json_keep$\1$fitted_json_keep$,'g') as compact_text
 from (
  select proof,transport,case when jsonb_typeof(transport->'proof')='object' then
   jsonb_set(jsonb_set(jsonb_set(transport->'proof',
   '{jobs,0,payload,capture,conditions,0,reference_receipt}',transport->'referenceReceipt',true),
   '{scores,0,computation_receipt,reference_receipt}',transport->'referenceReceipt',true),
   '{scores,1,computation_receipt,reference_receipt}',transport->'referenceReceipt',true)
   else null::jsonb end as restored
  from (
   select proof,jsonb_build_object('version','embryo-fitted-proof-reference-v1',
    'referenceReceipt',proof#>'{jobs,0,payload,capture,conditions,0,reference_receipt}',
    'proof',case when jsonb_typeof(proof)='object' then
     proof#-'{jobs,0,payload,capture,conditions,0,reference_receipt}'
          #-'{scores,0,computation_receipt,reference_receipt}'
          #-'{scores,1,computation_receipt,reference_receipt}'
     else null::jsonb end) as transport
   from fitted_proof_compact_value
  ) encoded
 ) reconstructed
)
 select case when proof is not null
 and case when jsonb_typeof(proof)='object' then
  (select count(*) from jsonb_object_keys(proof))=6
  and proof ?& array['bindingsCurrent','fitPackage','wholeRowHashes','jobs','scores','calls'] else false end
 and case when jsonb_typeof(proof->'jobs')='array' then jsonb_array_length(proof->'jobs')=1 else false end
 and case when jsonb_typeof(proof->'scores')='array' then jsonb_array_length(proof->'scores')=2 else false end
 and case when jsonb_typeof(proof#>'{jobs,0,payload,capture,conditions}')='array' then
  jsonb_array_length(proof#>'{jobs,0,payload,capture,conditions}')=1 else false end
 and case when jsonb_typeof(transport->'referenceReceipt')='object' then
  (select count(*) from jsonb_object_keys(transport->'referenceReceipt'))=12
  and (transport->'referenceReceipt') ?& array['singleton','version','panel_sha256','panel','system_identifier',
   'database_name','database_oid','server_version','runtime_binding','installed_at','fit_artifact_sha256','fit_package_digest'] else false end
 and restored is not distinct from proof
 and compact_text::jsonb is not distinct from transport
 then compact_text else null end from fitted_proof_compact_text;$reference_body$;
create function pg_temp.fitted_proof_restore_v1(p_transport jsonb) returns jsonb
language sql immutable set search_path='' as $restore_body$
select jsonb_set(jsonb_set(jsonb_set(p_transport->'proof',
 '{jobs,0,payload,capture,conditions,0,reference_receipt}',p_transport->'referenceReceipt',true),
 '{scores,0,computation_receipt,reference_receipt}',p_transport->'referenceReceipt',true),
 '{scores,1,computation_receipt,reference_receipt}',p_transport->'referenceReceipt',true);$restore_body$;
create temporary table fitted_reference_cases as
with refs as(
 select id,jsonb_build_object('singleton',true,'version',1,'panel_sha256',repeat('a',64),
 'panel',jsonb_build_object('publicOracle',proof),'system_identifier','12345','database_name','postgres',
 'database_oid',5,'server_version',170006,'runtime_binding',jsonb_build_object('publicSynthetic',true),
 'installed_at','2026-10-11T00:00:00.000Z','fit_artifact_sha256',repeat('b',64),'fit_package_digest',repeat('c',64)) ref,
 proof oracle from fitted_compact_cases
), fixture_rows as(
 select id,oracle,jsonb_build_object('id','public-job','status','done','attempts',1,'output_kind','embryo.statistical-estimate',
 'computation_revision','embryo-test-statistical-fit-v1','claim_token_hash',null,'claim_expires_at',null,'claimed_by',null,
 'payload',jsonb_build_object('capture',jsonb_build_object('conditions',jsonb_build_array(
 jsonb_build_object('conditionId','SYNTHETIC:9001','reference_receipt',ref,'retained',oracle))))) job,
 jsonb_build_array(jsonb_build_object('id','public-score-0','embryo_id','public-embryo-0','finding',null,
 'model_id',null,'model_version',null,'citations',jsonb_build_object(),'coverage_state','not_covered',
 'computation_receipt',jsonb_build_object('publication','synthetic-fitted-test-only','interpretation','held',
 'clinicalPublication',false,'reference_receipt',ref,'retained',oracle)),
 jsonb_build_object('id','public-score-1','embryo_id','public-embryo-1','finding',null,
 'model_id',null,'model_version',null,'citations',jsonb_build_object(),'coverage_state','not_covered',
 'computation_receipt',jsonb_build_object('publication','synthetic-fitted-test-only','interpretation','held',
 'clinicalPublication',false,'reference_receipt',ref,'retained',oracle))) scores from refs
)
 select id,jsonb_build_object('bindingsCurrent',true,'fitPackage',jsonb_build_object('retained',oracle),
 'wholeRowHashes',jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',job->>'id',
 'sha256',encode(digest(convert_to(job::text,'UTF8'),'sha256'),'hex'))),
 'scores',(select jsonb_agg(jsonb_build_object('id',s->>'id','sha256',encode(digest(convert_to(s::text,'UTF8'),'sha256'),'hex'))
 order by ordinal) from jsonb_array_elements(scores) with ordinality as x(s,ordinal))),
 'jobs',jsonb_build_array(job),'scores',scores,'calls',jsonb_build_array(
 jsonb_build_object('embryoId','public-embryo-0','qc',jsonb_build_object('call_rate',1),'calls',jsonb_build_array(oracle)),
 jsonb_build_object('embryoId','public-embryo-1','qc',jsonb_build_object('call_rate',1196::numeric/1208),'calls',jsonb_build_array(oracle)))) proof
 from fixture_rows;
create temporary table fitted_reference_actual as
 select id,proof,pg_temp.fitted_proof_reference_v1(proof) emitted from fitted_reference_cases;
select ok(emitted is not null,'closed reference transport emitted: '||id) from fitted_reference_actual order by id;
select is(pg_temp.fitted_proof_restore_v1(emitted::jsonb),proof,
 'complete reference reconstruction equals original six-field proof: '||id) from fitted_reference_actual order by id;
select is(pg_temp.fitted_proof_restore_v1(emitted::jsonb)->'wholeRowHashes',proof->'wholeRowHashes',
 'entire original native row hash bags/order preserved: '||id) from fitted_reference_actual order by id;
select ok(not (((emitted::jsonb)#>'{proof,jobs,0,payload,capture,conditions,0}') ? 'reference_receipt')
 and not (((emitted::jsonb)#>'{proof,scores,0,computation_receipt}') ? 'reference_receipt')
 and not (((emitted::jsonb)#>'{proof,scores,1,computation_receipt}') ? 'reference_receipt'),
 'one whole reference carried and all three repeated paths removed: '||id) from fitted_reference_actual order by id;
select is(encode(digest(convert_to((pg_temp.fitted_proof_restore_v1(emitted::jsonb)#>'{jobs,0}')::text,'UTF8'),'sha256'),'hex'),
 proof#>>'{wholeRowHashes,jobs,0,sha256}','complete reconstructed job still matches original row hash: '||id)
 from fitted_reference_actual order by id;
select ok((select bool_and(encode(digest(convert_to(s::text,'UTF8'),'sha256'),'hex')=
 (proof#>>array['wholeRowHashes','scores',(ordinal-1)::text,'sha256']))
 from jsonb_array_elements(pg_temp.fitted_proof_restore_v1(emitted::jsonb)->'scores') with ordinality as x(s,ordinal)),
 'both complete reconstructed scores still match original ordered row hashes: '||id) from fitted_reference_actual order by id;
create temporary table fitted_reference_faults as
with base as(select proof from fitted_reference_cases where id='nested-object')
 select 'different-score-0-reference' id,jsonb_set(proof,'{scores,0,computation_receipt,reference_receipt,database_oid}','6') proof from base union all
 select 'different-score-1-reference' id,jsonb_set(proof,'{scores,1,computation_receipt,reference_receipt,server_version}','170007') proof from base union all
 select 'missing-job-reference' id,proof#-'{jobs,0,payload,capture,conditions,0,reference_receipt}' proof from base union all
 select 'missing-score-reference' id,proof#-'{scores,1,computation_receipt,reference_receipt}' proof from base union all
 select 'null-job-reference' id,jsonb_set(proof,'{jobs,0,payload,capture,conditions,0,reference_receipt}','null') proof from base union all
 select 'scalar-job-reference' id,jsonb_set(proof,'{jobs,0,payload,capture,conditions,0,reference_receipt}','5') proof from base union all
 select 'missing-reference-key' id,jsonb_set(jsonb_set(jsonb_set(proof,'{jobs,0,payload,capture,conditions,0,reference_receipt}',(proof#>'{jobs,0,payload,capture,conditions,0,reference_receipt}')-'database_oid'),'{scores,0,computation_receipt,reference_receipt}',(proof#>'{scores,0,computation_receipt,reference_receipt}')-'database_oid'),'{scores,1,computation_receipt,reference_receipt}',(proof#>'{scores,1,computation_receipt,reference_receipt}')-'database_oid') proof from base union all
 select 'extra-reference-key' id,jsonb_set(jsonb_set(jsonb_set(proof,'{jobs,0,payload,capture,conditions,0,reference_receipt}',(proof#>'{jobs,0,payload,capture,conditions,0,reference_receipt}')||'{"extra":true}'),'{scores,0,computation_receipt,reference_receipt}',(proof#>'{scores,0,computation_receipt,reference_receipt}')||'{"extra":true}'),'{scores,1,computation_receipt,reference_receipt}',(proof#>'{scores,1,computation_receipt,reference_receipt}')||'{"extra":true}') proof from base union all
 select 'missing-job' id,jsonb_set(proof,'{jobs}','[]') proof from base union all
 select 'extra-job' id,jsonb_set(proof,'{jobs}',(proof->'jobs')||(proof->'jobs')) proof from base union all
 select 'missing-score' id,jsonb_set(proof,'{scores}',jsonb_build_array(proof#>'{scores,0}')) proof from base union all
 select 'extra-score' id,jsonb_set(proof,'{scores}',(proof->'scores')||jsonb_build_array(proof#>'{scores,0}')) proof from base union all
 select 'missing-condition' id,jsonb_set(proof,'{jobs,0,payload,capture,conditions}','[]') proof from base union all
 select 'extra-condition' id,jsonb_set(proof,'{jobs,0,payload,capture,conditions}',(proof#>'{jobs,0,payload,capture,conditions}')||(proof#>'{jobs,0,payload,capture,conditions}')) proof from base union all
 select 'extra-proof-field' id,proof||'{"extra":null}' proof from base union all
 select 'missing-proof-field' id,proof-'calls' proof from base;
select is(pg_temp.fitted_proof_reference_v1(proof),null::text,'reference copy drift refuses emission: '||id)
 from fitted_reference_faults order by id;
select is(pg_temp.fitted_proof_reference_v1(null::jsonb),null::text,'SQL NULL stays a refusal in the new transport');
select is((pg_temp.fitted_proof_restore_v1(pg_temp.fitted_proof_reference_v1(
 jsonb_set(proof,'{bindingsCurrent}','false'))::jsonb)->>'bindingsCurrent')::boolean,false,
 'false native bindings are transported exactly and never promoted to success')
 from fitted_reference_cases where id='nested-object';

-- Unsupported roots are refusals; path deletion/restoration must not run on scalars or arrays.
select is(pg_temp.fitted_proof_reference_v1('null'::jsonb),null::text,'unsupported proof root refuses emission: JSON-null');
select is(pg_temp.fitted_proof_reference_v1('5'::jsonb),null::text,'unsupported proof root refuses emission: numeric-scalar');
select is(pg_temp.fitted_proof_reference_v1('true'::jsonb),null::text,'unsupported proof root refuses emission: true-scalar');
select is(pg_temp.fitted_proof_reference_v1('false'::jsonb),null::text,'unsupported proof root refuses emission: false-scalar');
select is(pg_temp.fitted_proof_reference_v1('"public unsupported root"'::jsonb),null::text,'unsupported proof root refuses emission: string-scalar');
select is(pg_temp.fitted_proof_reference_v1('[]'::jsonb),null::text,'unsupported proof root refuses emission: empty-array');
select is(pg_temp.fitted_proof_reference_v1('[1,{"retained":"public"}]'::jsonb),null::text,'unsupported proof root refuses emission: nonempty-array');
select is(pg_temp.fitted_proof_reference_v1('{}'::jsonb),null::text,'unsupported proof root refuses emission: empty-object');
select * from finish();
rollback;
