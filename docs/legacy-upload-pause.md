# Pause new legacy uploads during cutover

`INHERIT_PAUSE_LEGACY_UPLOADS` is a server-only deployment setting. It is off
when unset or `false`; only the exact value `true` pauses new issuance. On
Vercel, changing the saved value requires a new deployment before it applies.

Deploy this bridge with the pause off before scheduling the cutover. After
enabling the pause, authenticated calls to both `/api/uploads` and
`/api/files/upload-session` return HTTP 503 with `{"error":"uploads_paused"}`
and `Cache-Control: private, no-store`. The refusal happens before subject
lookup, upload-lease insertion or Storage access. Authentication is unchanged.

The picker displays the same refresh-and-retry explanation on both file-entry
pages. A bridge tab loaded before the setting changed still handles the live
503 response before starting Storage transport. Tabs running the original
PR74 bundle cannot learn this new message: that bundle discards the response
body and shows its generic authorization failure. Those tabs must refresh to
load the bridge. The server pause still prevents their new leases.

This setting does not stop completion at `/api/uploads/[id]/complete` or
`/api/files/[id]/finalize`. Already-issued uploads retain their original
session and expiry checks. Processing, reports, downloads and deletion are
unchanged. Do not remove the existing Storage policy or switch completion
contracts until existing leases and active finalizations have drained under
their original deadlines. A request already executing on the previous
deployment may still issue a lease; inspect actual outstanding leases after
deployment rather than treating promotion time as the drain boundary.

Before canonical cutover, recovery is to set the pause to `false` and deploy
the bridge again; no schema rollback is needed. Once canonical uploads have
been admitted, this bridge is not a complete application rollback target.
It neither implements the canonical runtime nor its future issuance switch.

Focused route units cover default issuance, both aliases, authentication,
zero privileged work during pause and completion while paused. Presentation
units cover the disabled picker and identical live-response message.

`e2e/upload-pause.spec.ts` adds one CI browser case. A third `next start` on
port 3102 reuses the same build with the pause on; the existing normal and
jurisdiction-off servers keep their meanings. The case exercises both paused
entry pages and authenticated issuance refusals. A pre-pause bridge page
receives the actual paused app's response through an explicitly scoped
app-server transport relay. Zero new leases, file rows and browser Storage
writes must result. The relay does not fabricate a provider response.

The same case then uploads real synthetic bytes through the normal UI and
Storage, aborts its first finalization request, verifies exact staging bytes,
and completes/processes that issued lease through native same-origin browser
requests to the paused app. Its original download must match exactly, with
report and deletion controls still available. Authentication cookies are
reused by the same browser context, never extracted into request tools, and
this case disables tracing.

Fresh CI supplies the PR74 legacy Storage policy. The shared local database
already has the canonical cutover and must not have that policy restored to
run this test. Browser discovery/typecheck are preparation, not a passing
browser receipt. No hosted setting is changed by adding this code.
