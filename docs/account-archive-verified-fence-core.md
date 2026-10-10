# Account archive verified storage and permanent fence core

## Source integration on 3 October 2026

This branch adds two internal server modules and their synthetic tests to the
442915c6 source. It does not approve a provider or enable account archive
generation. `approvedAccountArchiveGeneration()` still returns `null`.
Segmented READY publication, download and mail remain closed. The existing
account erasure refusal for archive attempts remains in force.

`src/lib/exports/archive-segment-verified-storage.ts` composes the existing
create-only Supabase segment writer with the existing whole-object reader.
Before each physical request and after EOF it requires an independent trusted
`assertCurrent` check. That check must prove the live store configuration,
originating authority, exact reserved segment and deployed fence and cleanup
contract. No environment variable or caller option supplies that authority.
The module requires exact object identity, version, ETag, byte count, SHA-256
and EOF before returning an acknowledgement. It retains the original 30-second
operation and 4,000,000-byte segment bounds. Unknown writes remain uncertain.

`src/lib/exports/archive-provider-fence.ts` defines a separate permanent-fence
provider contract and validates its replies. Its stable write identity binds
the complete immutable reservation before upload; its cleanup fingerprint also
binds the acknowledgement. It refuses foreign or unproved history before any
marker mutation. Cleanup requires conditional marker replacement, complete
version inventories, exact owned-version deletion, a second inventory and an
empty marker read to EOF. Failed and late marker bodies are cancelled without
extending the operation clock. These callback requirements are source contracts,
not evidence that any provider implements atomic replacement, ownership,
physical deletion or a permanent late-write fence.

The verified Supabase writer and permanent-fence contract are not connected to
one another by an approved capability. Supabase metadata and ordinary removal
do not establish the required conditional commit or complete physical version
history. Existing embryo provider evidence does not approve export delivery.
No backend has been selected by this integration.

## Required proof before a capability can open

The remaining work includes a qualified provider adapter, live configuration
and write/readback proof, conditional final commit, a permanent late-write
fence, complete version-list/delete/second-list proof, and current EOF and hash
checks. Delete-marker history remains refused until its ownership and conditional
replacement semantics are proved. The immutable opaque reservation issuer and
ledger guards, native catalog pins, legacy uncertain reservation disposition,
and complete account graph collector are also held. Cleanup cannot be called
complete while any of these conditions is missing.

The SQL bridge remains an unbound source proposal outside this checkout. It is
not a migration, deployed RPC or deletion proof. This branch changes no SQL,
table classifications, public authority door, nonce, lease, quota, retention
clock or account deletion contract. No existing reservation is adopted or
backfilled.

## Authored checks and qualification still required

The verified writer adds 38 synthetic cases using the installed SDK with an
injected transport. The fence module adds 17 synthetic callback cases. Neither
set has been executed for this source integration. The tests are automatically
included by the existing `src/**/*.test.ts` Vitest rule; no selector or existing
assertion changes. No new route, environment variable, direct Storage call site,
SQL fixture or browser fixture is introduced.

Full qualification must bind this branch's final committed source. Run all 15
existing quality commands and all 599 unit files, with the unchanged full unit
command and at least 9,776 passed cases, no skipped or todo cases and no
unhandled errors. Verify all source, dependency, mirror and runtime pins before
and after that separate authorized run. The existing fresh database and entire
hosted browser requirements remain required before release; no qualification
for new native or browser behavior is claimed here.

The five additive fence cases include successful nonempty owned-payload
cleanup, unknown post-marker history refusal before deletion, and exact key,
version and deleted-state acknowledgement refusals. Both complete marker
inventories and EOF reads are required by the successful synthetic case.
These cases provide no physical provider or deletion proof.

The D-081 documentation reconciliation is the exact separately reviewed
current-source patch. It preserves all 65 acceptance verdicts, including
G2.1 and G8.5 as NO, and preserves the missing historical immediate-premerge
Boolean caveat. This source integration adds no acceptance credit.
