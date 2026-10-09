# Signed Ubuntu APT mirror admission

The hosted Ubuntu 24.04 jobs still run the complete, mandatory
`pnpm exec playwright install --with-deps chromium` command. Before its first
invocation, a small root driver admits the actual disposable runner's stock
APT configuration. Local synthetic tests never invoke APT.

The build source for the observed image `ubuntu24/20261004.327` sets one retry and 15-second
HTTP/HTTPS timeouts. Those are connection/data inactivity bounds, not a total
transfer deadline. The mirror transport starts each requested index with its
lowest-priority URI, so falling back for InRelease does not permanently demote
Azure for subsequent Packages files. The existing browser 60-minute deadline
and checks 10-minute deadline remain unchanged.

Admission requires Ubuntu 24.04, x86_64, root, explicit public hosted image
`github-hosted` environment metadata and an observed installed APT 2.8 family version, the exact three original URI/priority rows, the two stock Noble
Deb822 source paragraphs and the existing Ubuntu archive key route. It observes
only selected public network/security configuration leaves, including apt-get
binary overrides, and rejects conflicting or unsupported settings. It also
requires no main apt.conf override and a new fragment that sorts after all
original fragments. Source and public trust files are read through original
regular FDs (including all public `/usr/share/keyrings` members) and pinned before and after; authentication configuration is not
read.

Only the three existing priority tokens change: HTTPS archive first, HTTPS
security second, HTTP Azure third. URI bytes, row order, suites, repositories,
keys and trust remain intact. The original mirror bytes, safe selected config,
source/trust pins and signed-update outcome are preserved in a fresh root-owned
0700 directory under `/var/tmp/inherit-ci-apt-*`, whose path appears in the job
log. A root-owned late fragment retains retry1/timeout15 and adds
`APT::Update::Error-Mode "any"`. The driver requires
`apt-get update --error-on=any` to succeed. The later Playwright update inherits
this root configuration even when its sudo invocation drops APT_CONFIG.
Failed metadata refreshes, installs or tests remain fatal.

These are the three existing official mirrors. Automatic fallback stays in APT;
there are no new repositories, mirrors, keys, trust exemptions, optional
installs or retries of the workflow. A failure retains its original state and
stops the job. Withdrawing this source change returns a future fresh disposable
runner to its stock priorities; existing runners are not reset or repaired to
manufacture success. The actual image, effective settings, network improvement,
complete installer and full hosted suite remain unqualified until observed in
an original hosted run.

Primary sources:

- [Exact observed image source configuration](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/scripts/build/configure-apt-sources.sh)
- [Exact observed image network configuration](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/scripts/build/configure-apt.sh)
- [Mirror priorities and fallback](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html)
- [APT configuration order and binary overrides](https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html)
- [HTTP connection/data timeouts](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-http.1.html)
- [Strict metadata update failures](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)
- [Signed repository authentication](https://manpages.ubuntu.com/manpages/noble/man8/apt-secure.8.html)
- [Reported Azure mirror stalls](https://github.com/actions/runner-images/issues/14594)

The upstream report's nonfatal update/install workaround is deliberately absent.
Archive and security can share infrastructure, so their priority does not imply
independent availability or a total runtime bound.
