# Private prepared-artifact gateway

`worker.mjs` is a Cloudflare module Worker bound to one private Standard R2
bucket. It accepts only short-lived ES256 capabilities minted after the app's
current database authorization checks. It has no public upload, key listing,
delete, token minting, or browser CORS interface.

Required bindings:

| Binding | Value |
| --- | --- |
| `ARTIFACTS` | R2 bucket binding |
| `BUCKET_NAME` | Exact bucket name, matching app and SQL configuration |
| `TOKEN_ISSUER` | Existing upload signer's issuer |
| `SIGNING_PUBLIC_KEYS` | JSON array of public P-256 JWKs with their existing `kid` values |

Never put private JWK fields or the database service key in this Worker. Use the
reviewed public half of the existing upload signer. Configure compatibility date
`2026-09-08`, with request-body logging and observability disabled. Keep R2 public
access disabled. A deployed Worker URL alone grants no access to an artifact.

The app uses `INHERIT_PREPARED_R2_ORIGIN` and `INHERIT_PREPARED_R2_BUCKET`.
Database configuration selects provider `r2` and the identical bucket. Admission
also requires the separate app flag and database enablement; deploying this
gateway does not enable either. Cleanup must remain available after disabling
new ingestion.

Every object is reserved in SQL before upload. PUT verifies the full checksum
and uses R2's atomic create-only condition. The writer independently reads and
hashes the complete object before acknowledging its actual provider version.
GET requires that exact version, ETag and size, including for a byte range.

Cleanup replaces the payload with an empty object and independently reads it to
EOF before acknowledging the exact marker. **Do not configure lifecycle expiry
or delete these markers:** they permanently prevent an already admitted or
replayed create-only upload from recreating a payload. This proves current
payload removal and write fencing, not physical-media erasure or key absence.

The synthetic provider verification covered an 8 MiB signed round trip,
range reads, stale-version refusal and rewrite refusal. A separate actual R2
race consumed half an upload before writing the marker; after the upload
settled, the same empty marker remained. Neither test establishes full-genome
application capacity. The production worker host, allowance, complete journey,
original retention and measured file limits remain deployment requirements.
