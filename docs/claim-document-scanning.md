# Claim document scanning (ClamAV)

Every Future Person claim document is scanned for malware before anyone may
read it. The scan runs in a worker the operator starts, `pnpm
worker:claim-scan`, against a clamd daemon the operator runs beside it. The
owner chose self-hosted ClamAV on 28 September 2026, so identity documents
never leave our own infrastructure. **Nothing here is deployed, and nothing
in the repository deploys it.**

How a document moves:

| Step | Where | What happens |
| --- | --- | --- |
| Upload | `PUT /api/evidence/[session]/chunks/[sequence]` | Each chunk is sealed under the claim's own data key and written create-only to the private `future-person-identity` bucket, under a key the database makes. |
| Completion | `POST /api/evidence/[session]/complete` | The chunks are checked (exact size, exact SHA-256, type read from the bytes), composed into one sealed object, and recorded **quarantined**. |
| Scan | `pnpm worker:claim-scan` | The worker leases the oldest quarantined document, opens it, checks its size and SHA-256 again, and streams it to clamd. |
| Verdict | `private.record_claim_document_scan_v1` | Only a literal `OK`, bound to the document's own SHA-256, under signatures at most 24 hours old, makes it clean. |
| Refusal | worker, then `jobs.retention` | Infected, unscannable or oversize: refused at once (unreadable from that moment), the object deleted, and the ledger records why. |

The worker fails closed:

- clamd unreachable, a reply it cannot read, a time-out, or signatures older
  than 24 hours: no verdict. The document stays quarantined and is tried
  again. After five attempts it is refused as unscannable and deleted.
- The database refuses an `OK` whose SHA-256 is not the document's, or whose
  signatures are stale or dated in the future. The adapter checks freshness
  before it streams a byte, and the database checks it again.
- The signature name clamd reports is never kept, logged or returned.

Worker environment:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The project URL, as for the app. |
| `SUPABASE_SERVICE_ROLE_KEY` | The service key. The worker reads and deletes objects in `future-person-identity` and calls the scan RPCs. |
| `BYOK_ENCRYPTION_KEY` | The app's deployment key. The worker needs it to open a sealed document, and holds the plaintext only in memory for the one scan. |
| `INHERIT_CLAMD_ADDRESS` | `unix:/run/clamav/clamd.ctl`, or `tcp:127.0.0.1:3310`. Anything else, and the worker refuses to start. |

Never put these in command arguments or logs. The worker prints only coded
outcomes (`claim_document_scan_clean`, `_refused`, `_retry`, `_idle`,
`_failed`).

`INHERIT_CLAMD_ADDRESS=test-double` selects the stand-in scanner CI uses. It
finds only the EICAR test string. The worker accepts it only on a TEST-LOCAL,
non-production build, and it must never be set anywhere else.

## Owner and lead actions before claim documents are scanned

Nothing below has been done. Each step needs the owner's infrastructure, so
none is done by the repository or by CI.

1. Choose the long-lived host that will run the worker. It needs outbound
   access to the Supabase project and to the ClamAV mirror, and nothing else.
2. Install ClamAV on that host: the distribution's `clamav-daemon` and
   `clamav-freshclam` packages, or the official `clamav/clamav` container
   pinned by digest. Run clamd with `TZ=UTC`; the worker reads the signature
   date as UTC, and a wrong zone shifts the freshness check.
3. Configure clamd (`clamd.conf`):
   - `LocalSocket /run/clamav/clamd.ctl`, readable by the worker's user only.
     If TCP is unavoidable, use `TCPSocket 3310` with `TCPAddr 127.0.0.1`.
     Never expose clamd to a network.
   - `StreamMaxLength 21M` and `MaxFileSize 21M`. A claim document is at most
     20,000,000 bytes, and clamd's own size error is read as oversize.
   - `MaxScanSize 100M` and the default archive and PDF limits.
4. Configure freshclam to check at least every two hours (`Checks 12`), and
   alert when it fails. Signatures older than 24 hours stop every scan.
5. Check the scanner before the first document. Stream the EICAR test file to
   clamd, for example with `clamdscan --stream -` fed the 68-byte EICAR string
   from `src/lib/scan/test-double-scanner.ts`. clamd must answer `FOUND`.
6. Set the worker environment above, then start it from the repository root:
   `pnpm worker:claim-scan`. Use `--once` for one pass. It keeps polling
   every five seconds while idle; `SIGINT` or `SIGTERM` stops it.
7. Keep `jobs.retention` scheduled. It deletes fragments, refused documents
   and everything of an ended claim, and the claim is purged only after
   every object behind it is gone.

Until a worker runs, uploaded claim documents stay quarantined, the claimant
is told the file is being checked, and the claim ends with its 24-hour life.
