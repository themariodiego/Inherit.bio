# CI font archive cache

The cache contains only nine Ubuntu 24.04 font package archives, totaling
21,086,590 bytes. It contains no installed OS state, APT lists, browser binaries,
database, application build or credentials. The exact package versions, sizes,
archive paths and SHA-256 digests are in `data/ci/browser-font-packages.json`.
The published digests were read from the official Ubuntu package download pages
on 7 October 2026. Runtime admission additionally requires matching freshly
authenticated stock Ubuntu APT metadata; HTTPS page provenance alone is not
enough to use or publish the cache.

Every repository and browser job still runs the complete, unchanged
`playwright install --with-deps chromium` command. Before it, an exact cache
restore can supply font archives to APT's ordinary archive directory. A miss,
extra file, symlink, hardlink, corrupt digest, changed candidate version,
unsupported platform or failed metadata refresh bypasses the cache before use.
The complete official installation remains the fallback. A failure after
privileged copying begins fails closed, including a mismatching destination
digest. The helper never forces a downgrade, changes APT sources/trust settings
or installs an OS snapshot.

The key includes Linux, Noble, amd64, the reviewed Playwright version, the whole
font manifest digest and the frozen dependency lock digest. There are no prefix
restore keys or cross-OS restores. Restores are limited to one minute. Admission
also requires the restore action's exact `cache-hit=true` result. A
primary-key prefix match is ignored even if its archive bytes happen to match.
Admission is limited to four minutes. A miss avoids the extra APT query. A warm
hit performs a fresh `apt-get update --error-on=any`, checks each current candidate
and signed package record, asks APT for its actual epoch-encoded archive names,
and verifies copied bytes before the full installer starts.

Publication happens after the complete browser coverage aggregate in the
existing `checks` job, only on a main push. It first makes a one-minute exact-key
lookup without downloading. An existing key skips publication. On a miss, a
four-minute step refreshes authenticated APT metadata and downloads those same
nine official exact-version packages using stock APT. It verifies the complete
archive set before a separately bounded one-minute save. PR runs skip all four
publication steps. The helper shares a 210-second command budget across metadata
and download work inside the four-minute step. Publication failures leave the complete checks result intact;
the saved-result reader admits failures only for the named, source-bound cache
maintenance steps, and keeps the eight existing jobs and every ordinary mandatory step
strict. The existing ten-minute aggregate-job cap remains unchanged.

The observed PR294 run spent 187 seconds fetching OS archives on its critical
browser shard, with repeated Azure mirror retries for fonts; other shards spent
1–39 seconds. This is a download target, not evidence of a speed improvement.
Cache restoration, hashing, an extra metadata refresh, and main publication also
cost time. Exact-head complete hosted suites and actual cold/warm timing evidence
are required before adoption or any speed claim. The existing setup timing
receipt includes restore/admission time; API step timings separate restore,
admission, full installation and final publication.

Primary references:

- [Ubuntu package download records](https://packages.ubuntu.com/noble/)
- [APT authentication chain](https://manpages.ubuntu.com/manpages/noble/man8/apt-secure.8.html)
- [Official cache restore/save documentation](https://github.com/actions/cache)
- [Playwright browser-cache caveats](https://playwright.dev/docs/ci#caching-browsers)

The cache action is pinned to the official v5 commit
`caa296126883cff596d87d8935842f9db880ef25`. Browser binary caching remains excluded;
Playwright notes that its restoration can cost as much as downloading, and Linux
dependencies still require installation.
