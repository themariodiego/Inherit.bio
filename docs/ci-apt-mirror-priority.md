# Signed Ubuntu APT mirror admission

The hosted Ubuntu 24.04 jobs still run the complete, mandatory
`pnpm exec playwright install --with-deps chromium` command. Before its first
invocation, a small root driver admits the actual disposable runner's stock
APT configuration. Local synthetic tests never invoke APT.

The build source for the observed image `ubuntu24/20261004.327` sets one retry and 15-second
HTTP/HTTPS timeouts. Those are connection/data inactivity bounds, not a total
transfer deadline. The mirror transport starts each requested index with its
lowest-priority URI, so falling back for InRelease does not permanently demote
the regional mirror for subsequent Packages files. The existing browser 60-minute deadline
and checks 10-minute deadline remain unchanged.

Admission requires Ubuntu 24.04, x86_64, root, explicit public hosted image
`github-hosted` environment metadata and an observed installed APT 2.8 family version, one of the observed stock states below, the two stock Noble
Deb822 source paragraphs and the existing Ubuntu archive key route. It observes
only selected public network/security configuration leaves, including apt-get
binary overrides, and rejects conflicting or unsupported settings. It also
requires no main apt.conf override and a new fragment that sorts after all
original fragments. Source and public trust files are read through original
regular FDs (including all public `/usr/share/keyrings` members) and pinned before and after; authentication configuration is not
read.

Admission is a closed list of observed stock states. Each is an exact mirror
file paired with the exact `URIs` of the second source paragraph (the stock
security paragraph); the first paragraph must always use
`mirror+file:/etc/apt/apt-mirrors.txt`. Nothing is admitted by pattern, by
image version or by the sources file's hash:

- Azure: `http://azure.archive.ubuntu.com/ubuntu/` priority 1, HTTPS archive
  2, HTTPS security 3; both paragraphs on the mirror list. Observed on
  `ubuntu24/20261004.327`.
- us-east-2, direct security: `http://us-east-2.ec2.archive.ubuntu.com/ubuntu/`
  priority 1, HTTPS archive 2, HTTPS security 3; the second paragraph is
  exactly `http://security.ubuntu.com/ubuntu` with exactly `noble-security`.
  Observed on `ubuntu24/20261111.127.1`.
- us-east-2, mirror list: the same us-east-2 mirror file; both paragraphs on
  the mirror list. Observed on `ubuntu24/20261116.133.1`.

Any other pairing is refused, including the Azure mirror with a direct
security paragraph, any other mirror bytes and any other second-paragraph URI.

Only the three existing priority tokens change: HTTPS archive first, HTTPS
security second, the plain HTTP regional mirror (Azure or us-east-2) third.
URI bytes, row order, suites, repositories, keys and trust remain intact, and
the sources file is never modified. The original mirror bytes, safe selected config,
source/trust pins and signed-update outcome are preserved in a fresh root-owned
0700 directory under `/var/tmp/inherit-ci-apt-*`, whose path appears in the job
log. A root-owned late fragment retains retry1/timeout15 and adds
`APT::Update::Error-Mode "any"`. The driver requires
`apt-get update --error-on=any` to succeed. The later Playwright update inherits
this root configuration even when its sudo invocation drops APT_CONFIG.
Failed metadata refreshes, installs or tests remain fatal.

On the us-east-2 direct-security state, `noble-security` is fetched straight
from `http://security.ubuntu.com/ubuntu` over plain HTTP, exactly as that stock
image configures it, with no mirror fallback. What protects it is APT's check
of the archive's signed `InRelease` against the Ubuntu archive key and the
file hashes it lists, with the unchanged authentication, freshness and
`--error-on=any` checks. There is no transport encryption: the network can see
what is fetched and can delay or withhold it, and a stall on that one host
fails the update instead of falling back.

These are each image's own existing official mirrors. Automatic fallback stays in APT;
there are no new repositories, mirrors, keys, trust exemptions, optional
installs or retries of the workflow. A failure retains its original state and
stops the job. Withdrawing this source change returns a future fresh disposable
runner to its stock priorities; existing runners are not reset or repaired to
manufacture success. The actual image, effective settings, network improvement,
complete installer and full hosted suite remain unqualified until observed in
an original hosted run. By reading, the upstream network configuration script
is unchanged since `ubuntu24/20261004.327` and still writes `zz-retries` with
one retry and 15-second timeouts on x64; the newer images' effective values
are observed only when admission reaches its limited configuration report.

When the mirror file is refused, the driver prints three more JSON lines on
standard output before it writes the unchanged `HOLD` line to standard error;
the job log can interleave the two streams. The first gives the image name and version and the
mirror file's size, line count and SHA-256, then each line. A line is printed
in full only if it is a plain Ubuntu mirror row: `http` or `https`, an
`ubuntu.com` host of lowercase letters, digits, dots and hyphens, the path
`/ubuntu`, one tab and a one-digit priority. Any other line is shown only by
its position, size and SHA-256. The second describes
`/etc/apt/sources.list.d/ubuntu.sources`, read with the same custody checks:
per paragraph, the known field names, and the type, URI, suite, component and
key values only when every word is an expected stock word; anything else is
size and SHA-256 only. The third lists the names, never the contents, of up to
16 `/etc/apt/apt.conf.d` files that sort at or after `zz`. A file that is not
ASCII or is too large (over 1,024 bytes or eight lines for the mirror file;
over 4,096 bytes, eight paragraphs or 16 fields in one paragraph for the
sources file) gets only its size, SHA-256 and, for the mirror file, line
count. A sources file or fragment directory that cannot be safely read gets a
fixed label. A hash can confirm a guessed line, so it is a comparison aid, not
secrecy. When an admitted mirror is paired with a refused sources file, the
driver prints the same sources and fragment-name reports for the bytes it
already read, without reading the file again, and then the unchanged `HOLD`.
These lines change no admission decision: every refused state is
still refused with the same reason, and admitted states print nothing new.

On 19 November 2026, CI run 44546883409 for commit d8dcb61a passed this
admission on some hosted runners and held it on others at
`Unsupported stock mirror URI, priority or format`. The upstream source
configuration script changed after `ubuntu24/20261004.327`. The refusal report
then showed what the holding runners carry. On commit 4367aec9, four hosted
jobs held with the same mirror file (152 bytes, SHA-256
`af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a`, the
us-east-2 row at priority 1) and the late fragment `zz-retries`, and split on
the sources file:

- Image `20261111.127.1`: CI run 44551869930 job `owned-keyfree-smoke` and
  font cache diagnostic run 44551870219 job `font-cache-diagnostic`. Sources
  2,992 bytes, SHA-256
  `fc0fadce467e557a358c63f5532de4590c02933dfff8016028bb0a319b0e8b44`; the
  second paragraph is `http://security.ubuntu.com/ubuntu`, `noble-security`.
- Image `20261116.133.1`: CI run 44551869930 jobs `repository-checks` and
  `browser (5)`. Sources 2,995 bytes, SHA-256
  `4508181e0dd5578c33d1247db48ab4847910b25da85e0789c8e7b3140d1fb289`; both
  paragraphs on the mirror list.

By reading, the current upstream script also routes the security paragraph
through the mirror list; image `20261116.133.1` now shows that by observation.
Nothing is admitted from the upstream script alone: any later combination is
refused and reported, and needs its own observed admission.

Primary sources:

- [Exact observed image source configuration](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/scripts/build/configure-apt-sources.sh)
- [Current upstream source configuration, changed after the observed image](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh)
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
