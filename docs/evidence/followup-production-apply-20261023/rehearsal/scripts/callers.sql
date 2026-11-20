-- LOCAL ONLY: public entry points (and triggers) that reach a changed function, by body-text search.
with recursive f as (
 select p.oid, n.nspname, p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private')),
edge as (select callee.oid callee, caller.oid caller from f callee join f caller
  on caller.oid<>callee.oid and caller.prosrc ~ ('\m'||callee.proname||'\M')
     and (caller.nspname=callee.nspname or caller.prosrc ~ (callee.nspname||'\.'||callee.proname))),
seed(oid, name) as (select f.oid, f.nspname||'.'||f.proname from f where f.nspname||'.'||f.proname = any(:'targets'::text[])),
walk(seed, oid, depth) as (select name, oid, 0 from seed
 union select w.seed, e.caller, w.depth+1 from walk w join edge e on e.callee=w.oid where w.depth<12)
select w.seed, string_agg(distinct f.nspname||'.'||f.proname, ' ' order by f.nspname||'.'||f.proname)
 filter (where f.nspname='public' or exists(select 1 from pg_trigger t where t.tgfoid=f.oid))
from walk w join f on f.oid=w.oid group by w.seed order by 1;
