begin;
set local statement_timeout='10s';
set local lock_timeout='250ms';
set local search_path=public,extensions;
select plan(57);
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
select * from finish();
rollback;
