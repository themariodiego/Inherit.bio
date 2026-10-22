#!/usr/bin/env python3
# Send one SQL file to the Supabase Management API's SQL endpoint over HTTPS.
#
#   python3 -I api-run.py <sql-file> <out-prefix> [--json-column NAME]
#
# The cloud sessions reach the internet only through an HTTPS proxy, so psql
# cannot connect to Postgres. This endpoint runs the text as `postgres`, with
# the server's 2-minute statement_timeout (read 16 October 2026), which the
# guarded batches accept. Every batch file is one DO statement, so it is atomic
# whatever the client.
#
# Reads SUPABASE_ACCESS_TOKEN and INHERIT_PROD_PROJECT_REF from the environment.
# The token is never printed or written. Writes <out-prefix>.status (the HTTP
# code, or "no-response") and <out-prefix>.body (the raw response). With
# --json-column, a 2xx result's single row's column is also written as JSON to
# <out-prefix>.json, which check-readback.py reads.
#
# Exit codes, matching the psql stop rules in ../guarded/README.md:
#   0    HTTP 2xx: the statement committed (or the SELECT returned).
#   3    HTTP 4xx/5xx: the server answered with an error, so the statement
#        rolled back. A dry run must end here with the sentinel.
#   124  No response (timeout or connection loss): the outcome is unknown.
#        Read back before doing anything else.
#   2    Usage or local input error. Nothing was sent.
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = os.environ.get('INHERIT_SUPABASE_API', 'https://api.supabase.com')
SENTINEL = 'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED'


def is_sentinel(message):
    # The one ERROR is the dry-run raise, and no other ERROR is reported. The
    # SQLSTATE prefix (P0001) is optional, because the format is confirmed by
    # the probe in RUNBOOK.md step 3 before any dry run.
    errors = re.findall(r'ERROR:\s+(?:P0001:\s+)?([^\n]*)', message)
    return len(errors) == 1 and errors[0].strip() == SENTINEL


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(2)


def main(argv):
    args = argv[1:]
    column = None
    if '--json-column' in args:
        i = args.index('--json-column')
        if i + 1 >= len(args):
            fail('--json-column needs a name')
        column = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        fail('usage: api-run.py <sql-file> <out-prefix> [--json-column NAME]')
    sql_path, out = args
    token = os.environ.get('SUPABASE_ACCESS_TOKEN', '')
    ref = os.environ.get('INHERIT_PROD_PROJECT_REF', '')
    if not token:
        fail('SUPABASE_ACCESS_TOKEN is not set')
    if not re.fullmatch(r'[a-z]{20}', ref):
        fail('INHERIT_PROD_PROJECT_REF must be the 20-letter project ref')
    try:
        text = open(sql_path, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError) as error:
        fail(f'cannot read {sql_path}: {error}')
    body = json.dumps({'query': text}).encode('utf-8')
    request = urllib.request.Request(
        f'{API}/v1/projects/{ref}/database/query', data=body, method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json',
                 'User-Agent': 'inherit-guarded-release/1'})
    status, payload = 'no-response', b''
    try:
        with urllib.request.urlopen(request, timeout=200) as response:
            status, payload = str(response.status), response.read()
    except urllib.error.HTTPError as error:
        status, payload = str(error.code), error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        payload = f'{type(error).__name__}: {error}'.encode('utf-8')
    open(f'{out}.status', 'w').write(status + '\n')
    open(f'{out}.body', 'wb').write(payload)
    print(f'{os.path.basename(sql_path)}: {len(body)} request bytes, status {status}, {len(payload)} response bytes')
    if status == 'no-response':
        sys.exit(124)
    if not status.startswith('2'):
        text = payload.decode('utf-8', 'replace')
        try:
            message = json.loads(text).get('message', text)
        except (ValueError, AttributeError):
            message = text
        # The error body is the server's message, never the query text.
        print(f'server error message: {str(message)[:600]}')
        print(f'exact dry-run sentinel as the error: {is_sentinel(str(message))}')
        sys.exit(3)
    if column is not None:
        rows = json.loads(payload)
        if not isinstance(rows, list) or len(rows) != 1 or column not in rows[0]:
            fail(f'expected one row with column {column}')
        value = rows[0][column]
        if isinstance(value, str):
            value = json.loads(value)
        json.dump(value, open(f'{out}.json', 'w'), sort_keys=True)
    sys.exit(0)


if __name__ == '__main__':
    main(sys.argv)
