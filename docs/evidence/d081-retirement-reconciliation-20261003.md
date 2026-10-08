# D-081 retirement: source and retained production evidence

3 October 2026. This supersedes the D-081 statements that still schedule the
legacy route removal or wait for its deployment. It preserves the original
rationale, dates and owner hard stop as history. G2.1 and G8.5 remain NO;
no other obligation, acceptance verdict or numerical count changes.

PR [#280](https://github.com/themariodiego/Inherit.bio/pull/280) merged at
09:05:09 UTC on 1 October 2026 as
`0711334e53b043c86ac7fdc96d25c6b61ecc1af8`. The retirement commit is
`a9fec0a4be3bed60b63e4eeae820fadc82c00bce`.
At main071 and the inspected AE source `ae31947e957867cb53f8914dd2f873477dc01977`,
these files are absent:

- `src/app/(marketing)/withdraw/[token]/page.tsx`;
- `src/app/api/withdraw/route.ts`.

The `builtButNotRegistered` and `permissiveDynamicSegment` arrays in
`docs/route-divergence.json` are empty; both D-081 exception rows are gone.
The original authored retirement case replaces the overlap case and requires
GET 404 for the old synthetic-token path, POST 404 for the bare endpoint and
GET 200 for the fragment entry. This paragraph describes retained source;
it does not claim that a browser or POST was executed for this reconciliation.

Canonical rights remain: `/withdraw/request`, `POST /api/rights/activate`,
`/withdraw/session` and `POST /api/withdraw/session`. The register pattern
`/withdraw/[token]` still pins `token` to the literal `session`; it is not a
raw-bearer route. Mail retains the fragment entry. Account-bound confirmation
and accountless refusal/deletion keep their separate existing authority.

The retained Vercel record identifies immutable deployment
`dpl_B6HFWcUFJWgF5sYSC2MyUPQnnBTT`, source main071, target production,
state READY and alias `inherit.bio`. Its ready time is
1 October 2026 at 09:06:21.117 UTC. The GitHub production deployment record
6780383133 reports success at 09:06:22 UTC the same day.
The later retained connector GET review at 00:41:19.497121 UTC on 3 October
records exactly these outcomes at that immutable deployment:

| GET observation | Status |
| --- | --- |
| Old synthetic-token withdrawal path | 404 |
| `/withdraw/request` fragment entry | 200 |
| Anonymous `/withdraw/session` | 404 |

These checks establish only those GET responses and the retained deployment
metadata. They add no POST, native-save, browser, provider delivery or
historical pre-merge verification. The historical immediate pre-merge raw
`no_unexpired_pre_cutover_invitations` Boolean receipt was not found.
The dated 30 September statement remains as history; this reconciliation does
not independently substantiate that past Boolean or infer it from later GETs.
The original read-only precheck source remains unchanged.

Retained workspace evidence is under
`integration-evidence/20261002/embryo-carrier-worker/d081-13oct-readonly-current-source-plan/`
(outside the repository). Exact pins used here are:

| Retained file | SHA-256 |
| --- | --- |
| `original-retirement-commit.patch` | `fc93a622f01fbfd49586da7c2439a454141b6538d7155fde5ebc09099bdc2830` |
| `actual-github-pr280-readonly.json` | `e4484204b42971ec566ff08e77d4213d0d85de9263a094150ef3ef5d02c153de` |
| `actual-github-main071-deployments-readonly.json` | `fca0e2f732f7e437d2e2768dcdd924c52c3cb88b24d5a7cd3e82c243747cbc5d` |
| `actual-github-main071-production-statuses-readonly.json` | `ea21ded50b5d1826757a99e3c834f2bae1caee85bcf146415029ee90a7c6bf99` |
| `authenticated-get-and-deployment-actual/root-independent-receipt.json` | `af80e3d858b5af321f50be11d65a4fa2c084a30a08dc0328db619727f1456cc1` |
| `authenticated-get-and-deployment-actual/deployment.json` | `e1dc2bd672d23bf7417b4b5ba3f9ab778a319507c0ab0e35ecb6e6e05994e762` |
| `authenticated-get-and-deployment-actual/old-token-page.json` | `7cd020b0ad6af4219a6b99ca9e43247ff61828ce4faaa4b52fc728fd8b0baa99` |
| `authenticated-get-and-deployment-actual/entry-page.json` | `050630f40294d62f8e81a7456f4a84e61b9affd9bd3c67375108ee12d79f3e08` |
| `authenticated-get-and-deployment-actual/anonymous-session-page.json` | `c4269d8cbd643d799e0e5728acc5df952218c8356ae2e89e47a8a8d6b20fda77` |

This is a documentation reconciliation prepared from saved evidence.
No new runtime, API, SQL, browser or test invocation was performed. The
13 October checkpoint concerns the retained evidence/documentation limits;
there is no remaining D-081 route deletion to schedule. D-083, D-103 and
all broader rights, hierarchy and register obligations remain unchanged.

## Current-source reconciliation, 8 October 2026

The current-source comparison is limited to main
`4eec89bbecf6db07fb82fe4965369e8dc42ab556`. The retirement commit above is an
ancestor, both obsolete files and both exception rows are absent, and the
four canonical request/activation/session files remain. The register pattern
still pins `session`. The original browser case still requires GET 404,
POST 404 and fragment-entry GET 200; this reconciliation did not execute it.

The 3 October note above is retained byte for byte as historical evidence.
Its deployment/GET proof is bound to older main `0711334e`, not current main.
It establishes no current-main deployment, complete current browser run or
final 13 October closure. Saved PR #280 metadata lists successful checks;
the complete original exact-head run/log/report evidence has not been located
in the reviewed packet. The original immediate pre-merge Boolean raw receipt
also remains unlocated. No new Boolean or GET could reconstruct that past
observation, and none was queried here.

The 9 October documentation reconciliation and 13 October evidence checkpoint
remain distinct. All 65 acceptance verdicts, including G2.1 and G8.5 NO, the
owner's original hard stop, `deleteAfter: 2026-10-14`, and all dated histories
are preserved. D-083, D-103 and the separate processing-state rationale remain
outside this update. No route, test, issuance model, database or provider
change, production query, test execution or release acceptance is claimed.
