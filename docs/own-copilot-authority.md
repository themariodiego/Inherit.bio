# Own Copilot provider authority

Saving a provider and granting permission are separate actions. Settings writes
atomically update the model, encrypted key and recipient configuration while
revoking prior canonical Copilot and cloud disclosure grants. Legacy Settings
requests retain their shape; legacy database writes invalidate canonical
metadata instead of upgrading it. A missing canonical recipient must be saved
and explicitly authorized. Reusing a stored key after changing its destination
requires entering that key again.

The service-only authority resolver returns current account/session, own-subject,
store and principal context; a monotonic Settings/recipient revision; provider
class; transport policy version and actual deployment fingerprint; and exact
Copilot-purpose and optional cloud-disclosure grant identities. It never returns
the private key or credential fingerprint. A prepared raw source alone does not
authorize a model call. Report and PRS projections also require their separately
selected current report purpose and exact completed source.

Consent presentation binds the current snapshot, every displayed artifact and
hash, account/session, expiry and single-use nonce. Cloud permission records a
separate signed subject consent containing the immutable recipient tuple.
Nothing is backfilled or implicitly granted by Save. Settings changes, key
changes/removal and explicit withdrawal make old authority fail immediately.
The chat integration must freeze and execute its exact purpose-derived purge
manifest for affected complete turn pairs and dependent history. This module
alone does not establish physical cleanup or a scheduling deadline.

## Local transport

The operator must establish a same-host, egress-isolated network before setting:

- `INHERIT_DEPLOYMENT_KIND=self-hosted-development`
- `ALLOW_LOCAL_MODEL_ENDPOINTS=1`
- `INHERIT_LOCAL_MODEL_HOST_ATTESTATION=same-host-egress-isolated-v1`
- `INHERIT_LOCAL_MODEL_ORIGINS` to a JSON array of exact permitted origins.

The attestation records the operator's claim; it does not create or independently
verify network isolation. Both `VERCEL` and `VERCEL_ENV` must be absent.
Declared preview/production deployments never enable local mode. `NODE_ENV`
controls the optimized Next build and does not override the deployment kind.
Local destinations must resolve exclusively to loopback. A private LAN address
is not a same-host model. Other providers require HTTPS and public addresses.

Every model POST resolves all addresses again, rejects mixed/forbidden answers,
pins its connection to a validated address, and rechecks current permission at
connection time. Model redirects are refused without a second request. Requests
and buffered responses are size-bounded; DNS, socket inactivity and response
completion have explicit time limits. No model request is made by Save.

## Verification boundary

Focused tests cover endpoint policy, consent presentations and atomic Settings
RPC delegation. The rollback-only SQL fixture uses actual signed upload consent,
Settings and explicit Copilot grant operations. It inserts no completed analysis
or fabricated purpose grant. Integration requires that SQL fixture, the chat
cleanup fixture and actual application/browser proof; unit success alone does
not establish a released own-Copilot journey.
