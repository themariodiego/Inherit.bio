"""Build comment-stripped CREATE OR REPLACE statements for the 8 functions whose
production bodies lack full-line SQL comments. Input: pg_get_functiondef output
captured under linehash.sql's pinned settings, one record per function as
name \\x1f definition \\x1e. Output: one SQL file of CREATE OR REPLACE statements.
CREATE OR REPLACE keeps the owner and ACL; SET clauses come from the text."""
import re, sys
src, out = sys.argv[1], sys.argv[2]
parts = []
for rec in open(src, encoding='utf-8').read().split('\x1e'):
    rec = rec.strip('\n')
    if not rec:
        continue
    name, _, d = rec.partition('\x1f')
    lines = d.split('\n')
    kept = [l for l in lines if not re.match(r'^\s*--', l)]
    assert kept[0].startswith('CREATE OR REPLACE FUNCTION '), name
    parts.append(f"-- {name}: {len(lines) - len(kept)} full-line comment lines removed\n" + '\n'.join(kept) + ';\n')
    print(name, len(lines) - len(kept))
open(out, 'w', encoding='utf-8').write(''.join(parts))
print(len(parts), 'functions')
