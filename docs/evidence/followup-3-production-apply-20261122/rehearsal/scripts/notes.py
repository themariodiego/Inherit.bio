"""LOCAL ONLY: the read-only pre-check SELECT of each of release 4's 21 migrations, as
docs/evidence/release-4-notes-20261119.md gives it, and the rule for each of its columns.

    python3 -I notes.py <outdir>      writes notes-precheck-NN.sql (one per migration) and
                                      prints how each was found

steps.py runs notes-precheck-NN.sql on the mirror just before it applies migration NN
(the state each section was written for) and checks every must_be_* column:
  must_be_zero_* and must_be_0_* -> 0; must_be_<N>_* -> N; must_be_true_* -> true;
  must_be_false_* -> false. context_* columns are recorded, not checked.
Each section's SQL is the first ```sql block after its "Read-only pre-checks" heading,
read up to its closing fence. One section's block has no closing fence before the next
section starts (20261119150000: the SELECT stops after `context_live_self_upload_consents,`
and the next section's heading follows); it is taken up to that heading and closed with
the two context columns every other section ends with. That repair is recorded in the
output and in the kit's README; the notes themselves are not edited here.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitgit  # noqa: E402

NOTES = os.path.join(kitgit.TOP, 'docs/evidence/release-4-notes-20261119.md')
TAIL = " current_user as context_current_user,\n current_setting('search_path') as context_search_path;"


def sections():
    lines = open(NOTES, encoding='utf-8').read().split('\n')
    files = [f for f, _ in kitgit.release_files()]
    out = {}
    for i, f in enumerate(files, 1):
        heads = [n for n, l in enumerate(lines) if l.startswith('#') and f'`{f}`' in l]
        assert len(heads) == 1, (f, heads)
        h = heads[0]
        pre = next(n for n in range(h + 1, len(lines)) if lines[n].startswith('#') and 'Read-only pre-checks' in lines[n])
        start = next(n for n in range(pre + 1, len(lines)) if lines[n] == '```sql')
        body, note = [], 'closed by its fence'
        for n in range(start + 1, len(lines)):
            if lines[n] == '```':
                break
            if lines[n].startswith('# '):
                note = f'no closing fence; taken up to line {n + 1} and closed with the two context columns'
                while body and not body[-1].strip():
                    body.pop()
                assert body[-1].rstrip().endswith(','), body[-1]
                body.append(TAIL)
                break
            body.append(lines[n])
        sql = '\n'.join(body).strip()
        assert sql.startswith('select') and sql.endswith(';'), (f, sql[-80:])
        out[i] = dict(file=f, heading_line=h + 1, sql_line=start + 2, sql=sql, note=note)
    return out


def rule(col):
    m = re.match(r'must_be_(zero|true|false|\d+)_', col)
    if not m:
        return None
    w = m.group(1)
    return {'zero': 0, 'true': True, 'false': False}.get(w, int(w) if w.isdigit() else None)


def wrap(sql):
    """One jsonb row of the SELECT's columns, in column order."""
    return 'select row_to_json(q)::text from (\n' + sql.rstrip(';').rstrip() + '\n) q;\n'


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for i, s in sections().items():
        open(os.path.join(out, f'notes-precheck-{i:02d}.sql'), 'w', encoding='utf-8').write(wrap(s['sql']))
        print(f"#{i:02d} {s['file']} section line {s['heading_line']}, SQL line {s['sql_line']}: {s['note']}")
