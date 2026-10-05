# Real isolated scanner proof

This source adds a test of the ClamAV adapter. It does not run a claim worker,
read a document, call a database or open a product feature. No real document,
genome, account, email or provider key is used.

The draft pull request job uses a disposable standard Ubuntu 24.04 runner in
this public repository. The normal complete CI suite remains required before
merge. A separate successful scanner artifact proves these four cases only:

1. A valid, empty synthetic PDF gets `OK`, with its exact full SHA-256 and
   genuinely current ClamAV signatures.
2. The standard harmless EICAR test file gets `FOUND`, with its exact SHA-256.
3. A synthetic file of 20,000,001 bytes gets the adapter's `OVERSIZE` refusal.
   This is an early adapter refusal, not a claim that the daemon scanned it.
4. After the owned container stops and its port is closed, a clean-file request
   gets `UNAVAILABLE`, with reason `unreachable`.

The runner imports the actual `clamdScanner` utility directly. The existing
stand-in tests are retained unchanged; they do not count as real service proof.
No live stale-signature database is fabricated. The existing stale-signature
tests remain unit evidence only.

The image is pinned to the official AMD64 manifest for ClamAV 1.5.4:
`sha256:b14ffd7b2e520c2ff52c33a1a305aa4acb1864f06b24cb408e81bf54e89f8ac6`.
The official Debian source defines the `clamav` user and group as ID 1000,
installs under `/usr`, and stores its configs under `/etc/clamav`. The proof
checks that actual package shape before updating signatures. It bypasses the
packaged entrypoint, which would otherwise schedule updates and change config.
Unexpected image shape stops the proof; it does not trigger a workaround.
The image's default health command expects its packaged Unix socket. This proof
uses its own port readiness check and four required outcomes, so the packaged
health command is not scheduled. No repository assertion is removed.

One container has a 4 GiB memory limit, no extra swap, one CPU, a read-only root,
no capabilities and no public port. Only its new signature store and bounded
temporary files are writable. The host port is exactly `127.0.0.1:45310`.
FreshClam runs once against the official database service, with one attempt per
mirror. Its signature validation and database load test stay enabled. Egress
is removed before scans. A CDN cooldown or failure stops the job. There is no
curl fallback or update loop. A sampled watchdog limits download and disk
growth; it does not claim a packet-exact network quota.

Raw command outcomes are saved before parsing or source checks. Complete source
and original Docker inventories are saved before and after. Only resources
with the proof's unique name, ID and label may be removed. Failure artifacts
remain. No existing Docker volume is mounted, removed or pruned.

This proof does not establish the claim upload, quarantine, retention or purge
flow, the production scanner host, external storage, mail, native database
rollback or readiness for release. The local Mac cannot run this proof today:
its guest memory is below ClamAV's published minimum. Unrelated apps and
containers remain outside this task.

Primary sources: [ClamAV Docker guide](https://docs.clamav.net/manual/Installing/Docker.html),
[official image source](https://github.com/Cisco-Talos/clamav-docker/blob/main/clamav/1.5/debian/Dockerfile),
[FreshClam config](https://github.com/Cisco-Talos/clamav/blob/clamav-1.5.4/etc/freshclam.conf.sample),
and [GitHub runner resources](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
