begin;
select no_plan();
\ir fixtures/future_person_custody_source.inc
create temporary table publication_before as select to_jsonb(a) artifact,a.artifact_key,a.version,a.body_sha256
  from public.consent_artifacts a where a.artifact_key='consent.upload-embryo' and a.superseded_at is null;
create temporary table publication_signatures as select id,to_jsonb(s) body from public.consent_signatures s;
create temporary table publication_other_artifacts as select artifact_key,version,to_jsonb(a) body
  from public.consent_artifacts a where a.artifact_key<>'consent.upload-embryo';
select throws_ok($$update public.consent_artifacts set superseded_at=clock_timestamp()
  where artifact_key='consent.upload-embryo' and superseded_at is null$$,'55000','immutable row',
  'even the database owner cannot supersede an artifact with an unproved UPDATE');
select throws_ok($$update public.consent_artifacts set body_markdown=body_markdown||' changed'
  where artifact_key='consent.upload-embryo' and superseded_at is null$$,'55000','immutable row',
  'the predecessor body remains immutable');
select throws_ok($$update public.consent_signatures set signed_at=clock_timestamp()
  where id=(select id from publication_signatures limit 1)$$,'55000','immutable row',
  'every signature keeps the original blanket immutable guard');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) r
  where has_function_privilege(r,'private.publish_consent_artifact_v1(text,integer,text,integer,text,text,date,text)','execute')
  or has_function_privilege(r,'private.guard_consent_artifact_publication_v1()','execute')),0::bigint,
  'no API role can publish or invoke the private transition guard');
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),repeat('0',64),(select version+1 from publication_before),
  'Synthetic next body.','Synthetic summary.',current_date,'Synthetic changed body.')$$,
  '55000','consent predecessor changed','a false predecessor digest cannot publish');
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+2 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,
  'Synthetic changed body.')$$,'22023','invalid consent publication','a skipped version is refused');
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+1 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,' ')$$,
  '22023','invalid consent publication','a publication without its change summary is refused');
-- A real API role owns this lookalike. Even exact contents do not confer the
-- administrative publisher's ownership, and caller configuration is ignored.
set local role authenticated;
create temporary table inherit_consent_publication_v1(predecessor jsonb,next_version integer,next_body_sha256 text,published_at timestamptz);
reset role;
insert into pg_temp.inherit_consent_publication_v1 select artifact,version+1,repeat('a',64),clock_timestamp() from publication_before;
select set_config('inherit.consent.publication','approved',true);
select throws_ok($$update public.consent_artifacts set superseded_at=(select published_at from pg_temp.inherit_consent_publication_v1)
  where artifact_key='consent.upload-embryo' and superseded_at is null$$,'55000','immutable row',
  'an API-owned exact temporary capability and forged config cannot authorize supersession');
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+1 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,
  'Synthetic changed body.')$$,'55000','consent publication capability unavailable',
  'a colliding caller relation is refused rather than adopted by the owner');
drop table pg_temp.inherit_consent_publication_v1;
-- A failed successor insert must roll back the predecessor and its one-use
-- temporary authority. This extra fixture guard refuses writes; it never
-- disables or bypasses any product guard.
create function pg_temp.refuse_synthetic_publication() returns trigger language plpgsql as $$
begin raise exception using errcode='55000',message='synthetic successor refused';end $$;
create trigger synthetic_publication_refusal before insert on public.consent_artifacts
  for each row execute function pg_temp.refuse_synthetic_publication();
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+1 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,
  'Synthetic changed body.')$$,'55000','synthetic successor refused','a failed successor insert rolls back the whole owner publication');
select ok((select to_jsonb(a)=b.artifact from public.consent_artifacts a join publication_before b
  on a.artifact_key=b.artifact_key and a.version=b.version)
  and not exists(select 1 from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema()
    and relname='inherit_consent_publication_v1'),'failure preserves the entire live predecessor and removes its temporary capability');
drop trigger synthetic_publication_refusal on public.consent_artifacts;
select lives_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+1 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,
  'Synthetic changed body.')$$,'the actual owner door publishes the immediate genuine successor atomically');
select ok((select to_jsonb(a)-'superseded_at'=b.artifact-'superseded_at'
  and a.superseded_at is not null from public.consent_artifacts a join publication_before b
    on a.artifact_key=b.artifact_key and a.version=b.version),
  'only the exact predecessor superseded timestamp changes; every signed historical field is identical');
select ok((select a.version=b.version+1 and a.body_sha256=encode(extensions.digest(a.body_markdown,'sha256'),'hex')
  and a.body_markdown='Synthetic next body.' and a.summary_markdown='Synthetic summary.'
  and a.summary_of_changes='Synthetic changed body.' and a.effective_on=current_date
  and a.published_at=p.superseded_at and a.superseded_at is null
  from public.consent_artifacts a join publication_before b on a.artifact_key=b.artifact_key
    and a.version=b.version+1 join public.consent_artifacts p on p.artifact_key=b.artifact_key and p.version=b.version),
  'the new version binds the actual full body digest and the same single publication boundary');
select is((select count(*) from public.consent_artifacts where artifact_key='consent.upload-embryo' and superseded_at is null),
  1::bigint,'exactly one genuine current successor remains');
select ok(not exists(select 1 from publication_signatures b full join public.consent_signatures s on s.id=b.id
  where to_jsonb(s) is distinct from b.body),'every original signature, actor, body digest and historical artifact FK stays byte-identical');
select ok(not exists(select 1 from publication_other_artifacts b full join
  (select * from public.consent_artifacts where artifact_key<>'consent.upload-embryo') a
  using(artifact_key,version) where to_jsonb(a) is distinct from b.body),'no other artifact history changes');
select ok(not exists(select 1 from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema()
  and relname='inherit_consent_publication_v1'),'successful publication leaves no reusable capability or permanent store');
select throws_ok($$select private.publish_consent_artifact_v1('consent.upload-embryo',
  (select version from publication_before),(select body_sha256 from publication_before),
  (select version+1 from publication_before),'Synthetic next body.','Synthetic summary.',current_date,
  'Synthetic changed body.')$$,'55000','consent predecessor changed','the old publication cannot replay against its superseded predecessor');
select throws_ok($$update public.consent_artifacts set superseded_at=null where artifact_key='consent.upload-embryo'
  and version=(select version from publication_before)$$,'55000','immutable row','a historical version cannot be revived');
select throws_ok($$update public.consent_artifacts set superseded_at=superseded_at+interval '1 day'
  where artifact_key='consent.upload-embryo' and version=(select version from publication_before)$$,
  '55000','immutable row','the historical publication boundary cannot be moved');
select throws_ok($$update public.consent_artifacts set superseded_at=clock_timestamp()
  where artifact_key='consent.upload-embryo' and superseded_at is null$$,'55000','immutable row',
  'the consumed capability grants no later UPDATE authority');
select finish();
rollback;
