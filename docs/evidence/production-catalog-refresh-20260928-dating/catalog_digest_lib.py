"""Digest repo report templates exactly as Postgres renders jsonb::text, for md5 parity."""
import json, os, hashlib, sys
from decimal import Decimal

class Num:
    def __init__(self, s): self.s = s
def pnum(s):
    d = Decimal(s)
    return Num(str(d) if 'e' not in s.lower() else format(d, 'f'))

def jsonb_text(v):
    if isinstance(v, dict):
        items = sorted(v.items(), key=lambda kv: (len(kv[0].encode()), kv[0].encode()))
        return '{' + ', '.join(json.dumps(k, ensure_ascii=False) + ': ' + jsonb_text(x) for k, x in items) + '}'
    if isinstance(v, list):
        return '[' + ', '.join(jsonb_text(x) for x in v) + ']'
    if isinstance(v, Num): return v.s
    if v is True: return 'true'
    if v is False: return 'false'
    if v is None: return 'null'
    if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    raise TypeError(type(v))

md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
def digest_template(t):
    return dict(t=md5(t['title']), s=md5(t['summary']), v=md5(jsonb_text(t['variants'])), c=md5(jsonb_text(t['citations'])))
