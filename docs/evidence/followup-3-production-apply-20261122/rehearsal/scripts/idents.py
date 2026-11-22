"""LOCAL ONLY: every schema-qualified identifier release 4's 21 migrations name,
classified on the pre-state (release 3's rehearsed post-state on the relk4 mirror).

    python3 -I idents.py <out.tsv>

Writes `identifier|class` lines: `fn` (a function of that name exists), `rel:<relkind>`
(a relation exists), `ABSENT` (nothing of that name exists: what the release creates).
Text in SQL comments is ignored. make-prechecks.py reads the file.
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitgit  # noqa: E402
DB = 'postgresql://postgres@127.0.0.1:58322/postgres'
names = set()
for _, data in kitgit.release_files():
    text = data.decode('utf-8')
    text = re.sub(r'--[^\n]*', '', text)
    names |= set(re.findall(r'\b((?:public|private|auth)\.[a-z_][a-z0-9_]*)\b', text))
q = ("select string_agg(x || '|' || case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
     "where n.nspname || '.' || p.proname = x) then 'fn' when to_regclass(x) is not null then 'rel:' || "
     "(select relkind::text from pg_class where oid = to_regclass(x)) else 'ABSENT' end, chr(10) order by x) from unnest(%s::text[]) x"
     % ('array[' + ','.join("'" + n + "'" for n in sorted(names)) + ']'))
out = subprocess.run(['psql', DB, '-X', '-At', '-c', q], check=True, capture_output=True, text=True,
                     env=dict(os.environ, PGCLIENTENCODING='UTF8')).stdout
open(sys.argv[1], 'w').write(out)
rows = [l.split('|') for l in out.splitlines() if l]
print(len(rows), 'identifiers:', {k: sum(1 for _, c in rows if c.split(':')[0] == k) for k in ('fn', 'rel', 'ABSENT')})
