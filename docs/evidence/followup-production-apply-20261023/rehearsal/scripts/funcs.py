"""LOCAL ONLY: every function's md5s and attributes on the relfu stack (127.0.0.1:56322).

    python3 -I funcs.py <out.json>

Per function (schema.name(identity args), rendered under the session's settings):
  prosrc     md5(prosrc), what an md5(prosrc) guard compares;
  def_sess   md5(pg_get_functiondef) under the psql session's settings, what an
             md5(pg_get_functiondef) guard compares when a batch restores the
             session's settings before each migration;
  def_pin    md5(pg_get_functiondef) under fingerprint.sql's pinned settings
             (search_path pg_catalog), which is the fingerprint's def_md5;
  acl, owner, secdef, config, volatile, lang, kind.
The caller exports PGPASSWORD for the local stack.
"""
import json
import os
import subprocess
import sys

DB = os.environ.get('RELFU_DB', 'postgresql://postgres@127.0.0.1:56322/postgres')
assert ':54322/' not in DB
ENV = dict(os.environ, PGCLIENTENCODING='UTF8')
WHERE = ("from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace "
         "join pg_catalog.pg_language l on l.oid = p.prolang "
         "where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' "
         "and p.prokind <> 'a'")
Q = (r"""select coalesce(jsonb_object_agg(p.oid::text, jsonb_build_object(
 'key', n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
 'prosrc', md5(p.prosrc), 'def', md5(pg_catalog.pg_get_functiondef(p.oid)),
 'owner', pg_catalog.pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig,
 'acl', p.proacl::text, 'volatile', p.provolatile::text, 'lang', l.lanname, 'kind', p.prokind::text)), '{}') """
     + WHERE)
QPIN = r"select coalesce(jsonb_object_agg(p.oid::text, md5(pg_catalog.pg_get_functiondef(p.oid))), '{}') " + WHERE
PIN = ("set local search_path = pg_catalog; set local TimeZone = 'UTC'; set local DateStyle = 'ISO, MDY';"
       " set local IntervalStyle = 'postgres'; set local extra_float_digits = 1; set local bytea_output = 'hex';")


def run(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                       capture_output=True, text=True, env=ENV, check=True)
    return r.stdout.strip()


def capture():
    sess = json.loads(run(Q))
    pin = json.loads(run('begin; ' + PIN + ' ' + QPIN + '; commit;').split('\n')[0])
    out = {}
    for oid, v in sess.items():
        v = dict(v)
        key = v.pop('key')
        v['def_sess'] = v.pop('def')
        v['def_pin'] = pin[oid]
        v['oid'] = int(oid)
        out[key] = v
    return out


if __name__ == '__main__':
    out = capture()
    json.dump(out, open(sys.argv[1], 'w'), sort_keys=True, indent=0)
    print(sys.argv[1], len(out), 'functions;',
          sum(1 for v in out.values() if v['def_sess'] != v['def_pin']), 'whose definition md5 depends on search_path')
