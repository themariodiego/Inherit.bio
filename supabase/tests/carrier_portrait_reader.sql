begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(24);

-- The Portrait carrier reader over two prepared sources, end to end
-- (migration 20260929130000_carrier_assertions.sql,
-- docs/carrier-importer-design.md point 8). Three synthetic accounts sign,
-- upload and normalize through the real transitions, as
-- portrait_canonical_source_readiness.sql does, over rollback-only object
-- metadata. Each file records its runs measure through the real door; both
-- adults grant Portrait with fresh presentations and acknowledge it. A
-- synthetic release is imported and reviewed through its own doors.
--
-- What the suite holds: the reader proves the captured readiness receipt and
-- then reads each person's current prepared source at the reviewed rule's
-- loci only, never another row of the file; it reads nothing while no
-- reviewed condition is active; and it answers null for a changed receipt, a
-- foreign viewer, a withdrawn grant or an ended session. The runs measure is
-- written once, only for a normalized file, only by its own account.

insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$ select ('79620000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$ select id from public.subjects where subject_account_id=pg_temp.pid(n) and subject_class='self'; $$;
create function pg_temp.principal(n integer) returns uuid language sql as $$ select id from public.subject_principals where subject_id=pg_temp.sid(n) and account_id=pg_temp.pid(n) and principal_kind='account_subject' and status='active'; $$;

-- Person 1's file carries a change at both reviewed loci and one row no rule
-- names; person 2's carries the first reviewed locus and the same unnamed row,
-- and not the second locus. Nothing here is anyone's DNA.
do $$ declare n integer; artifact text; nonce text; claim uuid; v jsonb; o jsonb; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.pid(n),'carrier-reader-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(pg_temp.pid(n+10),pg_temp.pid(n),now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=pg_temp.pid(n);
  perform public.mark_independent_login_v1(pg_temp.pid(n),pg_temp.pid(n+10));
  if n=3 then continue; end if;
  foreach artifact in array array['disclosure.insurance-and-discrimination','consent.upload-self'] loop
   nonce:=encode(extensions.digest('carrier-reader'||n::text||artifact,'sha256'),'hex');
   insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
   values(nonce,pg_temp.pid(n),pg_temp.pid(n+10),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
   perform public.sign_own_upload_artifact_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),artifact,1,
    (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),
    case when artifact='consent.upload-self' then array['own-adult-dna'] else array['understood'] end,1,1,1,1,1,nonce);
  end loop;
  insert into storage.objects(id,bucket_id,name,metadata) values(pg_temp.pid(n+20),'genomes',pg_temp.pid(n+30)::text,'{"size":8}');
  insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
   upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
  values(pg_temp.pid(n+40),pg_temp.pid(n),pg_temp.sid(n),pg_temp.pid(n+30)::text,'Synthetic source','vcf',1,8,repeat('a',64),'uploaded',1,
   'single-logical-sample-v1',clock_timestamp(),repeat('b',64),pg_temp.pid(n+20));
  insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
  values(pg_temp.pid(n+20),pg_temp.pid(n+30)::text,'genomes',pg_temp.pid(n+40),repeat('a',64),8,1,'current');
  v:=jsonb_build_array(
   jsonb_build_object('rsid',999999003,'chrom',1,'pos',61000000,'ref','A','alt','G','genotype','A/G'),
   jsonb_build_object('rsid',null,'chrom',1,'pos',70000000,'ref','C','alt','T','genotype','C/T'));
  if n=1 then v:=v||jsonb_build_array(jsonb_build_object('rsid',null,'chrom',1,'pos',10000000,'ref','C','alt','T','genotype','C/T')); end if;
  o:=jsonb_build_array(
   jsonb_build_object('source_line',9,'source_chrom',1,'source_pos',61000000,'source_ref','A','source_alt','G','source_gt','0/1',
    'rsid',999999003,'chrom',1,'pos',61000000,'ref','A','alt','G','genotype','A/G','quality_state','pass','usable',true),
   jsonb_build_object('source_line',10,'source_chrom',2,'source_pos',135851076,'source_ref','G','source_alt','A','source_gt','0/1',
    'rsid',4988235,'chrom',2,'pos',135851076,'ref','G','alt','A','genotype','A/G','quality_state','pass','usable',true));
  claim:=(public.own_upload_normalization_v1('begin',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40))->>'claim')::uuid;
  perform public.own_upload_normalization_v1('stage',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   jsonb_build_object('kind','variants','sequence',0,'rows',v));
  perform public.own_upload_normalization_v1('stage',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   jsonb_build_object('kind','observed','sequence',0,'rows',o));
  perform public.own_upload_normalization_v1('complete',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),
    'variantCount',jsonb_array_length(v),'observedCallCount',jsonb_array_length(o),'provenance','{}'::jsonb));
 end loop;
end $$;

create function pg_temp.runs(n integer,account integer,body text) returns boolean language sql as $$
 select public.record_own_normalization_runs_v1(pg_temp.pid(account),pg_temp.pid(account+10),pg_temp.pid(n+40),body::jsonb); $$;
create function pg_temp.presentation(n integer) returns text language sql as $$ select public.family_portrait_grant_presentation_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.pid(3-n)); $$;
create function pg_temp.grant_portrait(n integer,receipt text,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.principal(3-n),pg_temp.pid(3-n),'family.portrait',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt); $$;
create function pg_temp.pair() returns uuid language sql as $$ select id from public.family_pairs where subject_low_id=least(pg_temp.sid(1),pg_temp.sid(2)) and subject_high_id=greatest(pg_temp.sid(1),pg_temp.sid(2)); $$;
create function pg_temp.ready() returns jsonb language sql as $$
 select public.family_portrait_source_readiness_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2)); $$;
create function pg_temp.calls(receipt text) returns jsonb language sql as $$
 select public.family_portrait_carrier_calls_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2),receipt); $$;
/** The side of a reader answer that belongs to person n. */
create function pg_temp.side(answer jsonb,n integer) returns jsonb language sql as $$
 select case when answer#>>'{a,subjectId}'=pg_temp.sid(n)::text then answer->'a'
  when answer#>>'{b,subjectId}'=pg_temp.sid(n)::text then answer->'b' end; $$;
create function pg_temp.loci(side jsonb,kind text) returns text language sql as $$
 select coalesce(string_agg((x->>'chrom')||':'||(x->>'pos')||':'||(x->>'genotype'),',' order by (x->>'chrom')::integer,(x->>'pos')::bigint),'')
 from jsonb_array_elements(side#>array['source',kind]) x; $$;

set local role service_role;

-- ---------------------------------------------------------------------------
-- The runs measure, once per normalized file, by its own account
-- ---------------------------------------------------------------------------

select throws_ok($$select pg_temp.runs(1,2,'{"status":"measured","totalBases":1740000,"coveredBases":9000000,"fraction":0.1933}')$$,
 '42501','not_found','another account cannot record a file''s runs measure');
select ok(pg_temp.runs(1,1,'{"status":"measured","totalBases":1740000,"coveredBases":9000000,"fraction":0.1933}'),
 'the file''s own account records its measure');
select ok(not pg_temp.runs(1,1,'{"status":"not_measurable","reason":"no-reference-calls"}'),
 'a stored measure is never replaced');
select is((select jsonb_build_object('status',roh_status,'reason',roh_reason,'total',roh_total_bases,'covered',roh_covered_bases,
 'fraction',roh_fraction) from public.genome_files where id=pg_temp.pid(41)),
 '{"status":"measured","reason":null,"total":1740000,"covered":9000000,"fraction":0.1933}'::jsonb,
 'the measure is stored exactly as measured');
select ok(pg_temp.runs(2,2,'{"status":"not_measurable","reason":"no-reference-calls"}'),
 'an unmeasurable file records why');
savepoint unnormalized;
reset role;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
values(pg_temp.pid(59),pg_temp.pid(1),pg_temp.sid(1),'synthetic-unnormalized-1','Synthetic older file','vcf',1,8,repeat('c',64),'annotated');
set local role service_role;
select throws_ok($$select pg_temp.runs(19,1,'{"status":"measured","totalBases":1,"coveredBases":1,"fraction":1}')$$,
 '42501','not_found','a file that was never normalized takes no measure');
rollback to unnormalized;

-- ---------------------------------------------------------------------------
-- A current canonical pair
-- ---------------------------------------------------------------------------

select public.acknowledge_portrait_v1(pg_temp.pid(1),pg_temp.sid(1));
select public.acknowledge_portrait_v1(pg_temp.pid(2),pg_temp.sid(2));
create temporary table grants as select 1 n,pg_temp.grant_portrait(1,pg_temp.presentation(1),'carrier-reader-a') grant_id;
insert into grants values(2,pg_temp.grant_portrait(2,pg_temp.presentation(2),'carrier-reader-b'));
create temporary table capture as select pg_temp.ready() value;
select is((select value->>'kind' from capture),'canonical','both prepared sources are ready under two exact grants');

select ok((select pg_temp.calls(value->>'receipt') from capture)->'assertions'='[]'::jsonb
 and pg_temp.side((select pg_temp.calls(value->>'receipt') from capture),1)->'source'='null'::jsonb
 and pg_temp.side((select pg_temp.calls(value->>'receipt') from capture),2)->'source'='null'::jsonb,
 'with no reviewed condition active, the reader reads neither file');

-- A synthetic release with two recessive conditions, reviewed by name.
select ok((public.import_clinical_assertion_release_v1(jsonb_build_object(
 'release',jsonb_build_object('releaseId','synthetic-pgtap-reader','source','synthetic',
  'sourceUrl','https://example.invalid/synthetic-reader','sourceSha256',repeat('a',64),'sourceBytes',1,
  'sourcePublishedOn','2026-09-03','retrievedAt','2026-09-28T08:40:57Z','extractSha256',repeat('b',64),
  'geneValidityUrl','https://example.invalid/gene-validity','geneValiditySha256',repeat('c',64),'geneValidityCreatedOn','2026-09-28'),
 'conditions',jsonb_build_array(
  jsonb_build_object('conditionId','SYNTHETIC:9101','conditionName','Synthetic recessive condition A','geneSymbol','SYNREADA',
   'inheritanceMode','autosomal_recessive','geneValidityClassification','Definitive','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-a'),
  jsonb_build_object('conditionId','SYNTHETIC:9102','conditionName','Synthetic recessive condition B','geneSymbol','SYNREADB',
   'inheritanceMode','autosomal_recessive','geneValidityClassification','Strong','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-b')),
 'assertions',jsonb_build_array(
  jsonb_build_object('variationId',9101,'conditionId','SYNTHETIC:9101','geneSymbol','SYNREADA','variantName','Synthetic change A',
   'classification','Pathogenic','reviewStatus','reviewed by expert panel','reviewStars',3,'conflict',false,
   'lastEvaluated','2024-01-01','grch38',jsonb_build_array(1,61000000,'A','G'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  jsonb_build_object('variationId',9102,'conditionId','SYNTHETIC:9102','geneSymbol','SYNREADB','variantName','Synthetic change B',
   'classification','Likely pathogenic','reviewStatus','criteria provided, multiple submitters, no conflicts','reviewStars',2,
   'conflict',false,'lastEvaluated',null,'grch38',jsonb_build_array(1,10000000,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb))
 ))->>'assertions')::integer=2, 'a synthetic release imports through its door');
select ok(public.review_carrier_condition_v1('SYNTHETIC:9101',1,'activate','A Reviewer','Genetic counsellor','docs/reviews/pgtap-reader-a','not_serious')>0
 and public.review_carrier_condition_v1('SYNTHETIC:9102',1,'activate','A Reviewer','Genetic counsellor','docs/reviews/pgtap-reader-b','not_serious')>0,
 'a named reviewer activates both conditions');

create temporary table answer as select pg_temp.calls(value->>'receipt') value from capture;
select is((select value->>'receipt' from answer),(select value->>'receipt' from capture),'the reader answers for the captured receipt');
select is((select jsonb_array_length(value->'assertions') from answer),2,'the reader returns the rule''s two assertions');
-- The closed row shape `carrierAssertionRowSchema` (src/lib/family/carrier-assertions.ts) accepts, key for key.
select is((select array_agg(k order by k) from answer,jsonb_object_keys(value->'assertions'->0) k),
 array['alt','assertion_id','chrom','classification','condition_id','condition_name','equivalents','gene_symbol',
  'gene_validity_read_on','inheritance_mode','last_evaluated','penetrance_citation','penetrance_class','pos','ref',
  'release_id','review_stars','review_status','variant_name','variation_id']::text[],
 'each assertion carries exactly the fields the application reads');
select is(pg_temp.loci(pg_temp.side((select value from answer),1),'variants'),'1:10000000:C/T,1:61000000:A/G',
 'person 1''s file is read at both reviewed loci and at no other row');
select is(pg_temp.loci(pg_temp.side((select value from answer),2),'variants'),'1:61000000:A/G',
 'person 2''s file is read at the one reviewed locus it reports');
select is(pg_temp.loci(pg_temp.side((select value from answer),1),'observed'),'1:61000000:A/G',
 'observed calls are read at reviewed loci only');
select is(pg_temp.side((select value from answer),1)#>>'{source,fileId}',pg_temp.pid(41)::text,
 'each side names its own current prepared file');
select is(pg_temp.side((select value from answer),1)#>'{source,runs}',
 '{"status":"measured","reason":null,"totalBases":1740000,"coveredBases":9000000,"fraction":0.193300}'::jsonb,
 'each side carries its own stored runs measure');
select is(pg_temp.side((select value from answer),2)#>'{source,runs}',
 '{"status":"not_measurable","reason":"no-reference-calls","totalBases":null,"coveredBases":null,"fraction":null}'::jsonb,
 'an unmeasurable file says so');
select ok((select value::text !~ '70000000|135851076' from answer),'no row outside the rule reaches the answer');

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select is(pg_temp.calls(repeat('0',64)),null::jsonb,'another receipt answers nothing');
select is(public.family_portrait_carrier_calls_v1(pg_temp.pid(3),pg_temp.pid(13),pg_temp.pair(),pg_temp.pid(1),
 (select value->>'receipt' from capture)),null::jsonb,'a foreign viewer is refused');
savepoint session_end;
reset role;
delete from auth.sessions where id=pg_temp.pid(11);
set local role service_role;
select is((select pg_temp.calls(value->>'receipt') from capture),null::jsonb,'an ended session is refused');
rollback to session_end;
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from grants where n=2));
select is((select pg_temp.calls(value->>'receipt') from capture),null::jsonb,'a withdrawn grant closes the reader at once');

select * from finish();
rollback;
