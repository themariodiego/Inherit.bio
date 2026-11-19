with f as (
 select n.nspname||'.'||p.proname as fn, pg_catalog.pg_get_functiondef(p.oid) as def
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where ((n.nspname='private' and p.proname in ('claim_next_own_preparation_v1','current_adult_subject_invitation_v1','own_report_generation_v1','own_subject_purpose_grant_v1','read_own_upload_finalization_checkpoint_v1','write_own_upload_finalization_checkpoint_v1'))
   or (n.nspname='public' and p.proname in ('claim_due_research_publication_v1','record_blocked_embryo_response_v1')))
   and (select pg_catalog.set_config('search_path','pg_catalog',true)||pg_catalog.set_config('TimeZone','UTC',true)||pg_catalog.set_config('DateStyle','ISO, MDY',true)||pg_catalog.set_config('IntervalStyle','postgres',true)||pg_catalog.set_config('extra_float_digits','1',true)) is not null
)
select fn||E'\t'||string_agg(l.n::text||':'||left(md5(l.line),12), ',' order by l.n)
from f cross join lateral (select row_number() over () as n, line from regexp_split_to_table(f.def, E'\n') as line) l
group by fn order by fn;
