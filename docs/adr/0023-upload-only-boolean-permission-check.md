# 0023 — Upload-only boolean permission check

Status: accepted by the operator on 2026-09-06; implementation not released.

## Conflict and evidence

The route register required a live upload/consent lookup from Storage RLS
while forbidding the upload role both SELECT access and any target-checking
definer helper. PostgreSQL evaluates policy expressions with the querying
role's privileges; an ordinary subquery does not inherit the policy author's
table access. See [PostgreSQL row-security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
accessed 2026-09-06.

## Decision

The operator explicitly allowed one private zero-argument yes/no upload check.
`private.authorize_storage_upload_insert()` derives its whole scope from the
validated signed token, verifies live session and the exact unconsumed upload
and consent snapshots, and returns only a boolean. The RLS expression also
matches the proposed bucket and object name to that signed staging key.

Only the upload role and service role may execute this helper. The upload role
receives no SELECT grant on application tables, views or Storage objects, no
UPDATE/DELETE privilege and no generic target-checking function. The existing
zero-argument live-session helper remains a separate prerequisite. Normal
authenticated accounts do not receive the new helper's execution privilege.
This narrow exception overrides the previous sole-helper wording, not any
other restriction or the requirement for full four-path acceptance.

## Verification required

Actual role and Storage tests must prove one authorized insert, wrong-key and
wrong-bucket denial, replay denial, immediate live-session and consent
revocation denial, no application-table access and no object read/list/update/
delete capability. A token signature test or a direct SQL test alone does not
prove the provider transport accepts and enforces the role.
