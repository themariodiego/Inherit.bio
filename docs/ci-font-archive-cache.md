# CI font archive publication precursor

This precursor publishes verified font archives after the required test work.
It enables no cache restores or warm seeding in repository or browser jobs.
Every job still runs the complete, unchanged
`playwright install --with-deps chromium` command. No installed OS state, APT
lists, browser binaries, database, application build or credentials are cached.

Publication runs only on a main push. The repository job and all six browser
jobs must succeed, then the complete coverage aggregate must succeed inside
`checks`. Its four maintenance steps follow that aggregate; the eighth job
finishes after publication. PRs skip all four maintenance steps. The reader
keeps the eight-job closure and every ordinary mandatory step strict.

A one-minute publisher exact-key lookup skips maintenance, including signed
refresh and downloads, if the entry already exists. This lookup does not restore
an archive or seed a worker. Consumer warm admission is separate and always
requires its existing fresh signed metadata refresh before seeding.
Otherwise a four-minute population step uses a shared 210-second command budget
for the admitted APT driver, current-candidate checks and stock APT downloads of
the nine reviewed exact-version font packages. The fresh `checks` runner invokes
the same driver used by the required workers, preserving source/key custody,
official mirror priorities and a complete signed update with `--error-on=any`.
Every package's
version, architecture, archive path, size and SHA-256 must match authenticated
Ubuntu metadata and the reviewed manifest. Candidate drift or unavailable
metadata skips publication. The whole nine-file set must contain only regular,
single-link, digest-verified archives before `save-ready=true`. Save is limited
to one minute. Only the named lookup/population/save maintenance failures are
optional; the existing ten-minute `checks` cap and complete suites stay required.

Publication uses the existing system supervisor through `systemd-run --wait`.
Its exact fresh transient root service owns all APT descendants, including
children that start another process session. Only documented family 255 is
admitted; each invocation records its actual version line. An unavailable or
unsupported supervisor skips publication without a save.
Service work is at most 155 seconds and shrinks with the shared budget. Five
seconds each are reserved for start and root cgroup stop, followed by fifteen
seconds for closure observation and the catch path. The existing 180-second
per-command and four-minute outer caps are unchanged. Only a successful driver
receipt and an inactive/dead unit with an absent cgroup can precede package
admission. A failed client can stop only its exact verified transient root unit.
Original driver output and closure observations remain in the job log.

The archives total 21,086,590 bytes. Their pins are in
`data/ci/browser-font-packages.json`, based on official Ubuntu download records
read on 7 October 2026. Published HTTPS digests alone do not admit a cache:
freshly authenticated stock Ubuntu APT metadata must independently match them.
The action is pinned to official v5 commit
`caa296126883cff596d87d8935842f9db880ef25`.

The exact key binds Linux, Noble, amd64, Playwright 1.62.1, the whole manifest
and the frozen lockfile. It matches the separate consumer draft, PR295. There
are no prefix restore keys or cross-OS restores. After a successful protected
main publication, that consumer must prove genuine `cache-hit=true` restores
and fresh metadata/byte admission on its final exact head before active-cache
adoption. The helper's dormant consumer logic still rejects primary-key prefix
matches, corruption, symlinks, hardlinks and version drift, and fails closed on
post-copy integrity errors. Explicit synthetic fixtures retain these controls
without executing restoration or seeding in this precursor workflow.

The observed PR294 critical shard spent 187 seconds downloading OS archives
with font mirror retries. The historical main stall occurred in APT metadata
acquisition before font downloads. The font archive cache itself does not repair
that delay; the separately admitted APT driver supplies the reviewed priorities.
Publication has its own wall cost, and cache restore/admission also costs time.
Complete exact-head hosted suites and genuine cold/warm timing evidence remain
required before active restores or any speed claim.

Primary references:

- [Ubuntu package download records](https://packages.ubuntu.com/noble/)
- [APT authentication chain](https://manpages.ubuntu.com/manpages/noble/man8/apt-secure.8.html)
- [Official cache restore/save documentation](https://github.com/actions/cache)
- [Playwright browser-cache caveats](https://playwright.dev/docs/ci#caching-browsers)
- [Transient service wait and output behavior](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd-run.xml)
- [Service runtime and shutdown bounds](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.service.xml)
- [Control-group termination](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.kill.xml)
