# Exclusive owned Linux comprehension operator

This is a prepared operator path, not a completed native or paid round. Engineering chooses the host and endpoint under the existing decision in `docs/protocol/decisions.md` (25 September 2026, “Simulated study host and endpoint”). The owned operator requires `maxAttempts: 1`, so it cannot automatically retry inference. The same shared US$50 maximum includes model, infrastructure and any required plan costs. Calibration, the 25% margin, 300 independent task/persona sessions, 30 blind regrades, and two clean full rounds remain required. Nothing here changes the prompt, rubric, thresholds, retry policy, deployment settings or G3 status.

`pnpm comprehension:owned-linux` supports an actual exclusive Linux supervisor as an alternative to the existing authenticated GitHub `fresh-t6` path. It never sets GitHub ownership variables. Both paths use the same fresh ten-task factory, real account upload/report flows and real two-parent embryo publication. Built executable bytes and images may be reused read-only; authority, databases, browser contexts, sessions and mutable app cache are fresh for each pair. A reused or uncertain resource stops the run.

## Host preparation before any private input

Use a separate owned Colima profile and Docker daemon, preserving the stopped default profile and every protected fixture. The existing archive mount is `/Volumes/Mario Laptop Archive`, an HFS+ image backed by the external `/Volumes/MARIODISK`; use it for the new profile's image/cache, never format it. Linux scratch, checkout and ownership markers must live inside the guest filesystem with actual Unix ownership. Do not put security-sensitive ownership files on a mount with ownership disabled.

The installed Colima 0.10.3 help supports separate profiles, `--activate=false`, `--ssh-agent=false`, `--ssh-config=false` and `--mount none`. Its [official configuration documentation](https://github.com/abiosoft/colima/blob/v0.10.3/docs/FAQ.md) supports a separate `COLIMA_HOME`; the [official 0.10.2 release](https://github.com/abiosoft/colima/releases/tag/v0.10.2) adds `COLIMA_CACHE_HOME`, also available in 0.10.3. The initial profile proposal uses 2 CPUs, 6 GiB memory, a 16 GiB root disk and 24 GiB Docker disk, with both Colima home/cache on the archive. Keep the profile inactive as the default Docker context, disable host-home mounts and SSH-agent forwarding, and never address the default daemon.

The 10 October key-free smoke on exact `6eb844379a4a7d07db5473d1a37a4a18419f1a10` failed after 222.991 seconds with a nominal 4 GiB guest and the full native stack. The saved kernel diagnosis records `Out of memory: Killed process 14188 (next-build (v16)` with `anon-rss:1646276kB`; Next remained in the compile stage with no `BUILD_ID`. Stack cleanup completed, and no browser or model ran. The originals are in `integration-evidence/20261010/owned-linux-host-setup/{key-free-native-smoke-result,failed-smoke-kernel-diagnosis,failed-smoke-build-diagnosis}.json`. The materially changed 6 GiB smoke also failed after 123.668 seconds, at Next type-checking, without a kernel OOM, `BUILD_ID`, browser or model. A subsequent exact-6eb static compiler diagnosis found the default Node heap exhausting near 2 GiB. These failures remain unqualified; overall 6 GiB capacity remains **UNPROVEN** until the complete native smoke succeeds. Finite setup sizes do not bypass the fresh margins.

The exact-6eb Linux compiler passed with `--max-old-space-size=4096` in 37.398 seconds under its unchanged 120-second diagnostic cap, with no native stack or credential. The owned operator therefore supplies the authored `NODE_OPTIONS=--max-old-space-size=4096` only to its `pnpm build` child, whose Next type-checking child inherits it. Parent Node options remain forbidden or scrubbed; infrastructure, app and inference environments do not receive this setting. This static result does not qualify the complete native build or smoke. The existing 600-second build, 900-second session setup, action and whole-run limits remain unchanged.

The saved read-only host inventory proves only that Colima/Lima/Docker/SSH are installed and the default profile is stopped. Guest Node, pnpm, Docker permissions, Linux dependency binaries, free capacity and native fit must be verified from actual guest results. Do not mount/reuse the Mac's Darwin dependency installation as a Linux runtime. Install exactly the lockfile's Linux dependencies and `pnpm@10.33.0` into the isolated profile/cache when reversible setup is authorized. Build the existing credential-free `scripts/ci-browser/Dockerfile` and the exact product revision; no model key is present during installation or build.

Before opening a new study session, verify that the clean public checkout can be traversed at its read-only `/app` bind boundary by the namespace's initial UID 0 without DAC capabilities. The 10 October diagnostic on exact `6b458589534014f0e6a42c19473dba8a37d021a1` stopped before the shell's phase marker: the public checkout root was owned mode `0700`. The bounded actual proof in `integration-evidence/20261010/owned-linux-host-setup/root-study-resume-2def-actual-v1/61-public-checkout-traversal-relative-read-proof-reviewed.json` refused the script read at `0700` and permitted it after changing only that same directory's search bit to `0701`. Intermediate public directories and the script retained their existing modes; no Docker capability or private mode changed. Pin the public directory's inode and ownership, verify only `.env.example` and credential-free Git configuration, and make only this bind root searchable. Prove a bounded public script open relative to that boundary with UID/EUID 0 and DAC capabilities absent; an absolute path through a private home tests a different boundary. Do not change home, challenge, scratch, key or journal permissions. Search permission supplies neither directory listing nor write permission. A failed session still requires the existing explicit durable journal reconciliation, fresh admission and a new one-use request before another unchanged key-free smoke; the setup proof supplies no comprehension acceptance.

Before VM start and again after boot, require genuine matching AC and the existing memory/disk margins (4 GiB available host memory and 2 GiB system free disk). Choose finite VM resources leaving those margins. Before accepting any private input, the Linux supervisor reads actual `/proc/meminfo` once at initial admission and requires `MemTotal` at least 5.5 GiB (allowing OS reservation from a nominal 6 GiB guest) and `MemAvailable` at least 4 GiB. Missing, duplicate, malformed or impossible readings refuse. Signed children do not repeat the dynamic available-memory check while their owned stack is live. Before a native workload, also verify the real guest tools, empty isolated daemon, owned socket, exact clean checkout, build inputs and standard operation caps.

Authenticate SSH using a separately verified public host key and strict pinned checking. The generated default Lima SSH configuration uses `StrictHostKeyChecking no` and `/dev/null` for known hosts, so it is not an authenticated private channel. Do not use that configuration or accept a first-use key automatically. Establish the new profile's public host key from independent local VM identity/console or trusted public disk metadata, and pin it in an owner-only public known-hosts file. No private SSH key content is read or copied into the checkout.

The public owner request is a strict JSON object containing version 1, a newly generated UUID nonce, the independently observed guest boot UUID, exact committed head, canonical Linux checkout/scratch paths, and the exact isolated daemon's Unix socket. Scratch must be owned mode 0700. Initial admission rejects every nonignored untracked file and every tracked modification. Ignored dependency/cache outputs do not qualify unknown source.

The supervisor verifies actual Linux UID/GID, boot, PID/start time, anonymous stdin, source and daemon identity. It atomically retains a public one-use nonce marker under the actual Linux account home, outside the checkout and configurable scratch. That marker survives lease release and supervisor restarts. A separate lease keyed to the real daemon prevents competing supervisors even with different scratch paths. Failed or uncertain cleanup keeps the lease. Neither file contains a provider credential or model identifier.

The supervisor signs a public capability over an inherited anonymous app-control descriptor. The child must be its actual direct child and match the live UID/boot/PID/start and exact receipt/socket. A copied JSON object or environment flag cannot mint that capability. Its lifetime is the actual live supervisor, not a 45-minute timestamp borrowed from the two-persona smoke workflow. That workflow's existing 45-minute cap and every existing session, child, HTTP, setup, cleanup and build cap remain unchanged. No measured full-round time/cost fit is claimed.

Every invocation observes and closes a new native bootstrap before its persona stacks. Reusing executable bytes does not reuse authority, data or assumed keys. The existing build receipt must still match the exact source and observed public configuration; a mismatch refuses reuse rather than silently rebuilding or accepting invented configuration.

## Owner shell handoff

Perform a key-free local-stub native smoke first. The manual GitHub smoke remains deterministic and has no paid secret input. A full callable factory is not proof that Linux isolation, the native seed, complete cleanup or the full round fits. Measure the actual smoke and review its original outputs before calibration or a paid round. The probe must observe that SSH fd0 is genuinely an anonymous pipe and Node fd3 genuinely the inherited socket; source code does not prove either transport property.

For the owned operator, the owner keeps the key in their own interactive shell. Supply configuration and, only for a real provider, one credential in one canonical UTF-8 JSON frame through the authenticated SSH connection's anonymous stdin pipe. The key is not an argument, exported receiver environment variable, file, `.env`, GitHub/hosting secret or deployment setting. The receiver starts with only PATH, HOME, LANG=C.UTF-8, NODE_ENV=production and optional TZ=UTC; ambient credential/debug/CI configuration refuses.

The frame must use the exact JavaScript `JSON.stringify` encoding (integer-valued numbers use `0`, not `0.0`; duplicate keys and alternate encodings refuse). The following is an operator-side handoff outline for a configuration using that canonical number representation. `ssh_args` must already contain the genuine host/user/port, independently pinned public known-hosts file, `StrictHostKeyChecking=yes`, `BatchMode=yes`, no agent forwarding, `ConnectTimeout=10`, and finite SSH keepalive failure detection (`ServerAliveInterval=15`, `ServerAliveCountMax=3`). `public_owner` and `linux_node_path` contain public, independently checked values. Do not execute this outline until the host and key-free native smoke are qualified.

```python
# In the owner's terminal only. No credential is stored in a file or argv.
import base64, getpass, json, os, select, shlex, subprocess, sys, threading, time
owner_arg = base64.urlsafe_b64encode(json.dumps(public_owner, separators=(",", ":")).encode()).decode().rstrip("=")
remote = ["env", "-i", "PATH=" + linux_public_path, "HOME=" + linux_account_home,
          "LANG=C.UTF-8", "NODE_ENV=production", "TZ=UTC", linux_node_path,
          "--import", "tsx", "scripts/comprehension/run-owned-linux.mts", "--owner", owner_arg]
# Execute from the exact canonical Linux checkout; append --prepare only when
# a source-bound production build is required. Each invocation still observes
# and closes its own native bootstrap to bind actual local keys/configuration;
# only the immutable build is reused. The remote command is public.
command = "cd " + shlex.quote(public_owner["root"]) + " && " + shlex.join(remote)
# Collect private data locally before the bounded remote ready handshake.
configuration = json.loads(getpass.getpass("Private run configuration JSON (no credential): "))
frame = {"configuration": configuration}
if configuration["run"]["provider"]["kind"] != "local-deterministic-stub":
    frame["credential"] = getpass.getpass("Operator-only model credential: ")
raw = bytearray((json.dumps(frame, separators=(",", ":"), ensure_ascii=False) + "\n").encode())
if not 0 < len(raw) <= 65536:
    raise RuntimeError("Private frame exceeds the fixed bound")
child = subprocess.Popen([*ssh_args, command], stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "LANG": "C.UTF-8"})
try:
    # No data is written until exact readiness on the authenticated connection.
    deadline = time.monotonic() + 10
    ready = bytearray()
    while not ready.endswith(b"\n"):
        left = deadline - time.monotonic()
        if left <= 0 or not select.select([child.stderr], [], [], left)[0]:
            raise RuntimeError("Owned host did not become ready; do not send a key")
        chunk = os.read(child.stderr.fileno(), 4096 - len(ready))
        if not chunk or len(ready) + len(chunk) >= 4096:
            raise RuntimeError("Bounded owner readiness refused")
        ready.extend(chunk)
    if ready != ("OWNED_LINUX_READY:" + public_owner["nonce"] + "\n").encode():
        raise RuntimeError("Owned host refused; do not send a key")
    child.stdin.write(raw); child.stdin.close()  # Exactly one frame then EOF.
finally:
    raw[:] = b"\0" * len(raw)
# Receiver diagnostics are explicitly public; continuously drain stderr so a
# long run cannot block on a full pipe. Stdout remains the terminal, not a pipe.
def drain_public_stderr():
    while True:
        chunk = os.read(child.stderr.fileno(), 8192)
        if not chunk:
            break
        sys.stderr.buffer.write(chunk)
        sys.stderr.buffer.flush()
drainer = threading.Thread(target=drain_public_stderr, daemon=True)
drainer.start()
code = child.wait()  # Actual SSH/receiver terminal outcome, never PID absence.
drainer.join(5)
if drainer.is_alive():
    raise RuntimeError("Public diagnostic channel did not settle; retain HOLD")
child.stderr.close()
if code != 0:
    raise RuntimeError("Owned run failed; retain original status and cleanup HOLD")
# Also inspect actual owned cleanup and recorded task outcomes; transport exit
# zero alone is not a completed/native-qualified or scientifically passed round.
# No claim is made that Python/JavaScript immutable strings can be erased.
```

The receiver prints only the public ready nonce before it reads private input. Once the receive step begins, its fixed 10-second EOF deadline and 64 KiB maximum apply; duplicate keys, alternate JSON encoding, extra frames and non-UTF-8 bytes refuse. The sender collects its private configuration/key before beginning the bounded receive handshake, so interactive typing cannot exceed this deadline. Do not increase the receive cap.

Only the isolated inference child receives the credential. Infrastructure, database, app, mail, Storage proxy, build and browser children receive explicit scrubbed environment maps. The input credential remains in supervisor memory while needed; no byte-erasure claim is made for immutable strings. A real run still writes raw responses/verdicts only under its required `docs/comprehension-runs/<date>/<runId>` directory. After creation, exact source checks admit only that current producer's five fixed inert record/temp filenames; any other untracked path, executable, symlink, nested file or tracked change refuses. Calibration records must be reviewed/committed before admitting the next exact clean source revision.

## Explicit manual key-free dry reconciliation

This source operation requires a separate, explicit owner action after review
of the original failed run and genuine cleanup. It is never part of ordinary
run admission or a failed-run handler. It recovers only an unanswered, stopped
local-stub smoke's browser-resource marker in the dry ledger; it cannot recover
a paid/live run, an unfinished run, inference uncertainty or a spending lock.
No actual recovery is qualified by the source or unit tests.

Every new owner admission first durably writes its complete public proof to
`~/.inherit-comprehension-challenges/<nonce>.owner.json`, using an exclusive
owner-only file and file/directory synchronization, before readiness or input.
Lease release retains this companion and the permanent `<nonce>.used.json`
challenge. A persistence failure refuses readiness and consumes that challenge;
never replace or adopt its partial output. Neither file contains a private key.

Prepare the public request from the preserved original owner proof, exact
failed run/session IDs, SHA-256 of the complete original dry-history prefix,
and SHA-256 of the reviewed public cleanup original. That cleanup must establish
the old supervisor's boot/PID/start identity is dead, the exact isolated daemon
has no containers or volumes and only its three default networks, and the
preserved scratch has no stack lock. Preserve its original native terminal
outcome, zero responses/no inference, every reservation and one-use nonce.
Never infer a zero charge from an empty daemon. Do not read a private key,
configuration or expense-journal value to prepare this request.

Use the existing strict pinned SSH and canonical anonymous-pipe handoff above,
with a new public owner nonce, the exact clean recovery source revision and
protected scratch. Replace only the remote entrypoint with
`scripts/comprehension/run-manual-dry-reconciliation.mts --owner <base64url-public-owner>`
and require `OWNED_LINUX_RECONCILIATION_READY:<new-nonce>` before sending this
one canonical JSON frame, followed by EOF within the unchanged 10-second/64 KiB
input bound:

```text
{"version":1,"ledger":"dry","directory":"<canonical-protected-effort-directory>","runId":"<original-run>","sessionId":"<original-session>","historyPrefixSha256":"<exact-prefix-sha256>","publicCleanupSha256":"<reviewed-public-cleanup-sha256>","previousOwner":<complete-original-public-owner-proof>}
```

If a legacy run lost its complete public proof, the explicit older-boot-only
alternative replaces `previousOwner` with this public object (never both):

```text
"previousChallenge":{"kind":"older-boot-challenge","challenge":{"version":1,"nonce":"<original-nonce>","bootId":"<original-boot>","head":"<original-source-head>","uid":<original-uid>,"createdAt":<original-created-at>},"scratch":"<actual-home>/inherit-native-smoke-<original-nonce>"}
```

The protected permanent challenge must match these exact canonical bytes. Its
boot must differ from the actual current kernel boot, proving old-process death
without inventing a PID, start time or public key. Its source must match the
original run in the complete preserved history prefix. The nonce-specific old
scratch and records stay present and protected; its native stack lock must be
absent. Current authenticated source, daemon/socket, full empty inventory and
absence of other owned work are checked exactly as for the full-proof path.
Same-boot recovery still requires the complete original proof. A closure uses
`previousChallengeSha256` for the retained-marker bytes, or
`previousOwnerSha256` for the complete proof; the former is not a full-proof
digest. Both alternatives retain every dry-only, unanswered, finished,
no-inference-uncertainty and accounting refusal.

The operator checks actual authority and cleanup around the durable append.
It permits only its SSH/tool ancestors and its own process-inventory child,
refusing other owned-user work. Only one closure is appended; the original
failed finish and traces remain byte-exact. The spend file is checked by
identity metadata only and never opened, hashed, settled or reset. Both old and
new one-use challenges and scratch survive. A new run needs a new identity and
its own reservations; recovery neither retries nor qualifies the old smoke.

If any append/sync or later cleanup check is uncertain, retain the existing
history/recovery guard and all originals. Do not delete either lock or repeat
the operation automatically. The printed fixed result is not a native smoke,
cost or scientific qualification.

No actual operator credential has been supplied, no provider call has been made, and no native/full-round result is credited by this guide. The remaining setup is the isolated Linux profile, authenticated public host identity, exact Linux tools/build and key-free native lifecycle proof, followed by the existing owner-shell key and provider cap when the owner actually supplies them. This is separate from mandatory complete hosted unit/database/browser qualification of the changed source.
