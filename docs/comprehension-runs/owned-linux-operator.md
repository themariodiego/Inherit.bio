# Exclusive owned Linux comprehension operator

This is a prepared operator path, not a completed native or paid round. Engineering chooses the host and endpoint under the existing decision in `docs/protocol/decisions.md` (25 September 2026, “Simulated study host and endpoint”). The owned operator requires `maxAttempts: 1`, so it cannot automatically retry inference. The same shared US$50 maximum includes model, infrastructure and any required plan costs. Calibration, the 25% margin, 300 independent task/persona sessions, 30 blind regrades, and two clean full rounds remain required. Nothing here changes the prompt, rubric, thresholds, retry policy, deployment settings or G3 status.

`pnpm comprehension:owned-linux` supports an actual exclusive Linux supervisor as an alternative to the existing authenticated GitHub `fresh-t6` path. It never sets GitHub ownership variables. Both paths use the same fresh ten-task factory, real account upload/report flows and real two-parent embryo publication. Built executable bytes and images may be reused read-only; authority, databases, browser contexts, sessions and mutable app cache are fresh for each pair. A reused or uncertain resource stops the run.

## Host preparation before any private input

Use a separate owned Colima profile and Docker daemon, preserving the stopped default profile and every protected fixture. The existing archive mount is `/Volumes/Mario Laptop Archive`, an HFS+ image backed by the external `/Volumes/MARIODISK`; use it for the new profile's image/cache, never format it. Linux scratch, checkout and ownership markers must live inside the guest filesystem with actual Unix ownership. Do not put security-sensitive ownership files on a mount with ownership disabled.

The installed Colima 0.10.3 help supports separate profiles, `--activate=false`, `--ssh-agent=false`, `--ssh-config=false` and `--mount none`. Its [official configuration documentation](https://github.com/abiosoft/colima/blob/v0.10.3/docs/FAQ.md) supports a separate `COLIMA_HOME`; the [official 0.10.2 release](https://github.com/abiosoft/colima/releases/tag/v0.10.2) adds `COLIMA_CACHE_HOME`, also available in 0.10.3. A proposed initial profile uses 2 CPUs, 4 GiB memory, a 16 GiB root disk and 24 GiB Docker disk, with both Colima home/cache on the archive. These are finite setup sizes, not measured capacity or permission to bypass the fresh margins. Keep the profile inactive as the default Docker context, disable host-home mounts and SSH-agent forwarding, and never address the default daemon. No start command has run.

The saved read-only host inventory proves only that Colima/Lima/Docker/SSH are installed and the default profile is stopped. Guest Node, pnpm, Docker permissions, Linux dependency binaries, free capacity and native fit are not yet qualified. Do not mount/reuse the Mac's Darwin dependency installation as a Linux runtime. Install exactly the lockfile's Linux dependencies and `pnpm@10.33.0` into the isolated profile/cache when reversible setup is authorized. Build the existing credential-free `scripts/ci-browser/Dockerfile` and the exact product revision; no model key is present during installation or build.

Before VM start and again after boot, require genuine matching AC and the existing memory/disk margins (4 GiB available host memory and 2 GiB system free disk). Choose finite VM resources leaving those margins; a nominal 4 GiB guest is a capacity proposal, not measured fit. Before a native workload, verify the real guest tools, empty isolated daemon, owned socket, exact clean checkout, build inputs, capacity and standard operation caps. No profile or native workload has been started by source preparation.

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

No actual operator credential has been supplied, no provider call has been made, and no native/full-round result is credited by this guide. The remaining setup is the isolated Linux profile, authenticated public host identity, exact Linux tools/build and key-free native lifecycle proof, followed by the existing owner-shell key and provider cap when the owner actually supplies them. This is separate from mandatory complete hosted unit/database/browser qualification of the changed source.
