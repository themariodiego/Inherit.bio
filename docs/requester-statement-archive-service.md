# Private TEST statement archive service

This source is not installed or qualified. Default app and worker paths are closed.
No provider setup, paid resource, database change or production activation is approved here.

The app uses six private settings from `.env.example`: the exact HTTPS service URL
`INHERIT_TEST_STATEMENT_GATEWAY_URL` ending in `/private/case-archive/v1`, a canonical
base64 32-byte `INHERIT_TEST_STATEMENT_GATEWAY_KEY`, the exact existing private TEST
bucket `INHERIT_TEST_STATEMENT_R2_BUCKET`, the independently reviewed configuration
digest `INHERIT_TEST_STATEMENT_R2_BINDING_SHA256`, the dedicated native owner DSN
`INHERIT_TEST_REQUESTER_STATEMENT_R2_DATABASE`, and, when required, the provider's
public CA PEM `INHERIT_TEST_REQUESTER_STATEMENT_R2_DATABASE_CA_CERT`. The shared
database parser still requires the exact paired API/database project and verified
TLS. The native transaction requires the actual postgres owner role. An ordinary
service-role token is not that authority. No key or DSN belongs in chat or source.

The acceptance harness sets `INHERIT_TEST_REQUESTER_STATEMENTS` only with the
existing TEST jurisdiction. The environment gate registers it as harness-owned;
production startup refuses it. Private settings do not set either TEST flag.

`workers/requester-statement-archive/wrangler.json` points to the actual private
Worker module. It has no public route, R2 binding or Durable Object binding and
sets `CASE_ARCHIVE_TEST_ENABLED` to 0. This is deliberate closed configuration,
not a deployment-ready hidden stub. Qualification must record the exact existing
approved TEST R2 bucket as `CASE_ARCHIVE_BUCKET`, its real name as
`CASE_ARCHIVE_BUCKET_NAME`, the actual per-allocation namespace as
`CASE_ARCHIVE_GATEWAYS`, the qualified digest as `CASE_ARCHIVE_BINDING_SHA256`,
and a separately installed private `CASE_ARCHIVE_TRANSPORT_KEY` equal to the app
transport key. These are concrete required bindings; none is guessed or created.
Only after the real all-writer exclusion, conditional final commit, permanent
terminal marker retention, isolated logs/platform copies and native disposal
proofs pass may the TEST flag be enabled. A configuration hash proves no policy.

The project `typecheck` script generates real runtime types with the repository's
pinned Wrangler 4.134.0, then runs the strict Worker project before the Next app
project. No generated types are fabricated in this packet. The Worker config's
compatibility date and bindings determine those types. The generation and
compiler commands remain unrun. See the [Cloudflare TypeScript guide](https://developers.cloudflare.com/workers/languages/typescript/).

The signed private service request is service authentication only. The native
case/author/export/attempt/current authority transaction precedes each operation.
The gateway admits one payload write per random allocation and persists its
terminal fence before cleanup. It never clears that terminal fact. A provider
readback and durable native ACK are required for physical-copy completion.

V5 repairs actual retained body chunks, overflow chunk, decoded request body,
secret and MAC in the Worker, and the app's separate base64 conversion Buffer.
The full producer task/owned-buffer graph must settle before native buffers-zeroed.
Strings, CryptoKey, provider copies, platform memory, swap and logs still require
real qualification. Mail accepted or uncertain sends remain disposal holds.
