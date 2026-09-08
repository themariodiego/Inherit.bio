# Standard CI browser runtime

The standard `pnpm e2e` gate runs every existing project and case. On the fresh
GitHub-hosted Ubuntu job, its actual Storage bootstrap also owns one isolated
Next/Copilot container. Local execution continues using its existing servers.
This does not enable local-model permission or exempt any model endpoint policy.

The production build runs after the workflow exports the actual local public
Supabase configuration. `record-build` binds that build to the unchanged source
revision, public configuration hash, and Node major version. All three Next
variants use the same build. The image is constructed without app credentials;
the runtime uses its resolved image ID and the Linux dependencies already
installed in this job. It does not copy Mac dependencies or download a browser
inside the container.

Only the exact live `supabase_kong_sequence` in `supabase_network_sequence` can
supply the sole permitted network destination: that gateway's TCP port 8000.
The new container has its own network/PID namespace, read-only root and source,
no Docker socket, no new privileges, and only NET_ADMIN for initial policy setup.
Application, probe, mail relay and synthetic daemon run as the runner's non-root
numeric identity with zero effective capabilities. IPv4 and IPv6 OUTPUT default
to DROP, DNS is blocked including Docker's loopback resolver, and the only
allowances are loopback, established replies and the checked gateway. No host
firewall, routes, DNS or CA store are changed.

Docker's create-time `--add-host` maps the fixed synthetic hostname to
203.0.114.10 on this container's own loopback. Create-time `--dns`, `--dns-option`
and `--dns-search` request only loopback DNS with bounded lookup attempts and no
inherited search suffix; namespace startup never writes Docker-managed `/etc`
files. The firewall still blocks Docker's embedded resolver and all DNS ports,
including when Docker retains its embedded resolver on the custom network. Real HTTPS uses an ephemeral CA and leaf in a 0700 tmpfs; only Next and
the transport probe receive the extra CA. The CA signing key is removed after
issuance. No TLS private key is written to the checkout, host, logs or artifacts.
The probe runs the actual production classifier, DNS resolver and pinned fetch,
requires permission denial to send no request, and checks TLS and egress denial.
Its standalone loader removes only the initial Next server-only import marker;
all production policy and transport code remains unchanged. Positive kernel
DROP counters prove the rejected probes reached the firewall.
This is proof of the real policy and TLS transport using a synthetic endpoint;
it is not a call to an external model service.

The reviewed daemon and all 64 output fixtures are reused without changes.
Only host-loopback control port 8130 and the three app ports are published.
Playwright waits for each actual sign-in HTTP response, because a published
Docker TCP socket alone does not prove Next is running.
Daemon environment has no app credentials. App configuration travels over its
private stdin, never Docker environment/arguments. The mail relay accepts only
POST /emails and exchanges bounded bytes over another stdin/stdout pipe with the
host's fixed 127.0.0.1:8124 mock. It cannot choose a URL or follow redirects.
A fresh disposable CI database is required for the existing global mail tests.

Cleanup requires both the fixed container name and its exact random ownership
receipt under RUNNER_TEMP, outside the mounted checkout. Ordinary completion,
startup failure and the workflow's always-run fallback remove only that container.
No existing project is reset and no images or volumes are pruned.

## Coordinated Linux proof

Use the existing `.github/workflows/ci.yml` on the standard fresh GitHub-hosted
runner. After its unchanged install, SQL, seed and gates, it runs:

```sh
docker build --tag inherit-ci-browser:local --file scripts/ci-browser/Dockerfile scripts/ci-browser
pnpm build
INHERIT_DISPOSABLE_LOCAL_E2E=true pnpm exec tsx scripts/ci-browser-runtime.run.mts record-build
INHERIT_DISPOSABLE_LOCAL_E2E=true pnpm e2e
```

The job's existing CI/GitHub-hosted indicators and actual local keys are required;
setting these flags on a shared machine is not a substitute for a disposable job.
No selectors or alternate configuration are accepted in CI. Discovery remains
available through `playwright test --list` without starting this runtime.

The earlier isolated local baseline was 73 Copilot cases with no skips/retries,
including all 64 output cases. This portable implementation still needs its
coordinated Linux transport and complete standard-suite run before claiming CI
success. Focused unit checks use a simulated Docker CLI solely to test startup,
refusal and cleanup; they do not claim kernel/network verification.

The create-time host/DNS correction was checked on 2026-09-07 in a fresh local
ARM64 container built from this Dockerfile, with the read-only root and only the
existing `/tmp` and `/tls` tmpfs mounts. The unchanged native Node 22 transport
probe passed as UID 501/GID 20 with no effective capabilities: real synthetic
TLS, permission and invalid-TLS refusal, exact gateway reachability, blocked
Docker DNS with positive DROP counters, and outside-destination refusal. No
additional `/run` write access was needed. This bounded namespace/transport
proof does not claim a completed standard CI browser suite.
