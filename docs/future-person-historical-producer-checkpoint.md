# Historical producer fixture checkpoint

2026-10-01. Separate continuation of the reviewed historical fixture plan;
the current release and its original browser journeys remain frozen.

Migration `20261001035000_historical_embryo_producer_clocks.sql` introduces no
durable store, production secret, public clock argument, environment switch or
retention change. It pins the five complete predecessor bodies, signatures,
defaults, configurations, owners and effective ACLs and the exact existing
proposal/mail clock constraints before replacing any definition.

There is one copy of each original algorithm. The disposition and mail shared
cores accept an internal nullable clock; all API roles, including service_role,
are denied execution. Every owner-only `_at` entry rejects NULL and either
infinity. The original seven-argument public disposition wrapper is unchanged.
Its denied delegate passes NULL into the shared core. This keeps the original
live disposition clock, proposal INSERT creation clock and proposal-close
clock at their respective execution points. Mail still checks idempotency
first, locks the current principal and contact, then captures its actual
creation clock. It retains the fixed caller expiry without clamping it.

The owner-only historical path supplies a finite effective instant to the same
algorithms. Proposal creation and its seven-day expiry, confirmation/closure,
mail creation and its thirty-day expiry all use that consistent instant. The
original disposition states, parent matrix, current Auth and artifact checks,
one-use operation nonces, Cards, five transfer phases, revocations, source
identity and signed history remain intact. Current authorization and ordinary
audit recording use actual time; this is no evidence of historical signing.

`scripts/tools/historical-embryo-transfer.run.mts` admits only the registered
TEST-LOCAL test stack. Its strict input contains an embryo UUID and two distinct
parent UUIDs with the actual signed page-issued tokens. The existing application
verifier, using the selected application's existing key, validates each current
account/session/operation/target envelope before only its verified inner nonce
reaches SQL. SQL rechecks current two-parent authority and exact published
canonical source/file/digest/membership identity. No caller time, JWT edit,
fabricated nonce or UPDATE of historical fields is accepted.

The executor derives one actual recording instant R inside its transaction,
uses T = R minus nineteen years six months for the proposal and T plus one
second for confirmation, and checks the unchanged closing deadline remains
future. The synthetic documentary birth date is R's UTC date minus nineteen
years, which must be after transfer and at least eighteen years old. Its only
output is a closed metadata receipt explicitly marked
`time-compressed-synthetic-owner-producer`; raw Cards, credentials, documents,
contacts and source bytes never enter output or diagnostics.

`e2e/helpers/historical-embryo-transfer.ts` obtains those tokens by clicking each
actual parent's control. It aborts each genuine POST before dispatch, without
rewriting a request or substituting a response, and requires the entire hashed
operation/source/signature state to remain unchanged. This proves current
native issuance only. The owner executor then supplies the separately labeled
synthetic producer evidence. It does not prove a native second-parent
confirmation, provider delivery, human review or elapsed years/days. The
original positive native proposal/confirmation journey, default pictures/PDFs,
limits and zero retries are unchanged.

`supabase/tests/future_person_historical_producer.sql` composes the existing
genuine signing, finalization, ingest, QC and canonical-source fixture. It adds
actual-role denial, NULL/nonfinite/current-authority/mode/replay refusals,
exact historical proposal/closure/mail/phase and immutable-source/history
proof, and the ordinary public actual-time proposal, confirmation and mail
path. It ends with every deferred constraint made immediate and rollback.

All20 focused source/token tests, scoped lint, nine ordinary source gates and
the exact SQL fixture include closure pass. The local name gate passes with
root's approved one-entry sentinel at
`/tmp/inherit-integrator-20260930/local-denylist.txt`; this is not the private
comparator. The correctly refused empty-placeholder receipt is retained, and
hosted CI must use the actual encrypted private list. These checks cover the
authored local source, not complete release qualification.

The frozen 4943369f source subsequently passed actual Next type generation and
a nonincremental type check. The separate 853fa292 test-only public-clock
correction passed the exact migration as one owner DO plus all five complete
SQL suites on qualified 360: 481 assertions, zero failures/skips. The complete
catalog before and after equals the qualified baseline, and all 215 migration
rows/digest remain unchanged after rollback. The reviewed capture query keeps
the original seed and complete projection bytes, materializes identical edges
once and records its pinned SHA; its complete JSON equality was verified under
the unchanged 45-second bound. The initial failed assertion and original
capture timeout remain preserved. These are actual executor/catalog proofs;
the native helper/executor still awaits its browser execution.

This prerequisite does not yet provide the complete
positive documentary claim → provider-committed owner notice → objections →
separate assigned fresh EOF/client-ACK read → final operation-specific release
journey. The existing real public thirty-day refusal remains mandatory and
unchanged. No acceptance row or production gate is opened.
