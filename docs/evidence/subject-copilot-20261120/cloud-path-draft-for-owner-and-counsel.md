# Draft for the owner: the cloud path of Copilot for another adult's record (not applied)

**Status: a draft decision, for the owner and for counsel. Nothing here is built, applied or registered.** The owner's entry of 19 November 2026 ("G8.5: Copilot for another adult's record opens") states the intent ("On the hosted service too") and does not sanction it: "The register's `cloudProvider` `absolute-deny` for this relationship stays until a separate decision rewrites it. Engineering brings the owner the register change and the consent wording as that separate decision, and counsel should review it first." This is that draft. It assumes the self-hosted part (migration `20261120130000_subject_copilot_scope.sql`) as built: reports only, `copilot.local`, two relationships (grantee through the Family relationship; uploader of a Path B record its person holds with their own account).

## 1. The question to put to the owner

> On the hosted service, may a person ask a cloud AI provider about another adult's shared reports, if that adult has agreed to that exact provider receiving them? Offered: "Yes, reports only, with the adult's consent to the named provider", "Yes, with further limits", "No, keep it local only".

If "Yes", everything below changes; if "No", nothing does and the hosted site keeps its unavailable page.

## 2. What the adult would agree to, and who chooses the provider

On the hosted service the asker (the grantee or the uploader) has already chosen a cloud provider for their own Copilot (Settings, `llm_settings`, `cloud-model-consent-v1.recipientTuple`: config revision, normalized origin, named provider, one-way key fingerprint). The adult whose results would be sent did not choose it and has no contract with it. So the adult's permission must name that exact recipient, and must end whenever the asker changes provider, model, origin or key (a new tuple is a new recipient). This is stricter than the asker's own cloud consent, which binds the asker's own data only.

Proposed: a new directional purpose `copilot.cloud` from the adult to one recipient relationship (the same signer rule as `copilot.local`: the exact current adult subject principal, for this recipient relationship), plus a recipient binding that names the asker's current `recipientTuple` revision. The adult sees the provider's name and origin before signing. Reports projection only; ancestry and variants stay local-only or are not built.

## 3. The exact register change (old → new)

All paths are in `docs/route-register.json`; each new value would be marked `registered-YYYY-MM-DD-<decision title>`.

1. `policyResolvers.scope-derived-v1.cases.subject:adult.principalRelationshipCases.uploader-or-grantee`
   - `providerClass`: `{"const": "local"}` → removed, replaced by
     ```json
     "providerCases": {
       "local": {
         "providerClass": {"const": "local"},
         "requiredLiveCopilotPurpose": "copilot.local-signed-by-the-exact-current-adult-subject-principal-for-this-recipient-relationship"
       },
       "cloud": {
         "providerClass": {"const": "cloud"},
         "requiredLiveCopilotPurpose": "copilot.cloud-signed-by-the-exact-current-adult-subject-principal-for-this-recipient-relationship",
         "requiredLiveProviderGrant": "consent.copilot-cloud-model-other-adult-signed-by-the-exact-current-adult-subject-principal-for-the-exact-recipient-account-provider-recipientTuple-and-config-revision",
         "projections": ["reports"]
       }
     }
     ```
   - `requiredLiveCopilotPurpose` (top level of the case) → moved into `providerCases.local` (above).
   - `requiredLivePurposesByProjection.variants.cloudProvider`: `absolute-deny` → **unchanged**.
   - `requiredLivePurposesByProjection.ancestry` → add `"cloudProvider": "absolute-deny"` (keeps the cloud case to reports).
2. `policyResolvers.copilot-transport-availability-v1`
   - `trueNonSelfScopes`: `["subject:adult-uploader-or-grantee", "report:adult-uploader-or-grantee", "family:any", "cohort:any"]` → `["report:adult-uploader-or-grantee", "family:any", "cohort:any"]`, and a new case
     ```json
     "subject-adult-uploader-or-grantee": "a-local-provider-follows-true-non-self; a-cloud-provider-is-available-only-after-scope-derived-v1.cases.subject:adult.principalRelationshipCases.uploader-or-grantee.providerCases.cloud-and-every-scope-purpose-capability-and-mitigation-check-passes"
     ```
   - `cases.true-non-self.hostedCloudRemoteOrUnverified` → unchanged for the other true non-self scopes.
3. `policyContracts.cloud-model-consent-v1` (the consent register, around line 2560 today)
   - `cloudProvider`: `permitted-only-for-an-exact-own-subject…` → append `; or-for-subject:adult-uploader-or-grantee-reports-only-under-scopeRequirements.subject:adult-uploader-or-grantee`.
   - `nonSelfSubjectClass`: `absolute-deny-cloud-provider-when-the-acting-principal-is-not-the-exact-subject.subject_account_id-including-uploader-grantee-…` → `absolute-deny-cloud-provider-when-the-acting-principal-is-not-the-exact-subject.subject_account_id-including-parent-and-embryo-contexts-regardless-of-data-projection-or-consent; except-subject:adult-uploader-or-grantee-for-the-reports-projection-under-the-adult's-own-current-consent-to-the-exact-recipient-tuple`.
   - `scopeRequirements.true-nonself` → drop `uploader-grantee` from its list and add `"subject:adult-uploader-or-grantee": "exact-other-adult-subject-consent-signed-by-the-exact-current-adult-subject-principal-naming-the-exact-recipient-account-provider-recipientTuple-and-config-revision-reports-only"`.
   - `cloudRawVariantRule` → **unchanged** (raw variants never go to a cloud provider for anyone but oneself).
4. `policyResolvers.copilot-context-v1.closedProjections.nonSelfRawVariantsForCloudProvider` → unchanged (`forbidden-even-with-raw-export-grant-v1`).
5. `routes[copilot.scope].policy.pageBranches.subject-adult-uploader-or-grantee` (added 20 November) → add a cloud branch: on the hosted service, render the chat surface only when the cloud case passes; otherwise `true-non-self-unavailable` as today.
6. `routes[settings.copilot].hostedBranch`: `…no-claim-that-a-cloud-provider-enables-family-cohort-uploader-grantee-or-other-true-non-self-scopes` → `…no-claim-that-a-cloud-provider-enables-family-cohort-or-other-true-non-self-scopes; it-may-say-that-another-adult-can-let-this-provider-read-reports-they-share`.
7. `routes[api.consents]`: `grant-purpose.purposeKey` already lists `copilot.cloud`; `recipientRevision: required-only-for-copilot.cloud-and-must-match-the-current-server-owned-recipientTuple` → extend to name the **recipient account's** tuple when the target is another account's subject; `signerCases.other-adult-subject-artifact-or-purpose` unchanged.
8. Withdrawal (`withdrawalRoutes.cases`): `copilot.cloud` from an adult to a recipient is the analytic row (`purpose-revocation-v1`, `revoke_directional_purpose_with_nonce_v1`), and the recipient's provider change supersedes it (new tuple, new recipient), with the cloud-specific obligations of `cloud-consent-revocation-v1` ("invalidate matching chat contexts and pending provider jobs, delete uncommitted provider payloads").
9. The report scope (`scope-derived-v1.cases.report.adult-uploader-or-grantee.cloudProvider: absolute-deny`) → unchanged unless the owner asks for it too.

Outside the register, the brief and the product say the opposite today and would have to change with it (owner's documents and wording):
- `docs/inherit-v2-brief.md` line 1924: "**Cloud Copilot is restricted by subject class.** `copilot.cloud` is unavailable for any `subject_id` whose class is `other_adult`, `embryo_own` or `embryo_third_party`. Copilot over those subjects is **local-model only**…", and its sentence "For anyone's genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit." Note: the grantee case reads another account's `self` record, not an `other_adult` one, so the brief's class rule would not literally cover it; its sentence does.
- `COPILOT_LOCAL_ONLY` (`src/copy/family/person.ts`), shown on Family pages and every true non-self Copilot page, and `LOCAL_UNAVAILABLE_REQUIREMENT`.
- `PERMISSION_ROWS` (`copilot.local` row) and the Path B Copilot choice built on 20 November.
- `docs/retention.md` `cloud-model.access-immediate`.

## 4. Consent wording (drafts, for the owner and counsel)

A new legal artifact, `consent.copilot-cloud-model-other-adult` (version 1), signed by the adult in their own account, one per recipient and provider. Body draft (plain language, grade ≤ 8):

> **Let {recipient name} ask {provider name} about your shared reports**
>
> {recipient name} uses {provider name} ({provider origin}) to answer questions in Copilot. If you say yes, Inherit will send that company the reports you already share with {recipient name}, when {recipient name} asks a question about you.
>
> - Only reports you share with {recipient name}. Never your DNA file, never single letters of it, never your ancestry.
> - {provider name} is not part of Inherit. Its own rules decide how long it keeps what it receives and what it does with it. Inherit cannot take back what was already sent.
> - This permission names {provider name} only. If {recipient name} changes to another company, model or key, it ends, and you would be asked again.
> - You can turn it off any time, here or on your Permissions page. From then on, nothing more is sent, and {recipient name}'s Copilot chats about you are deleted from Inherit.
>
> ☐ I let Inherit send the reports I share with {recipient name} to {provider name} when {recipient name} asks Copilot about me.

Row on the Permissions page (grantee) and the Path B choices (uploader), drafts:
- label: `Copilot with {provider name}`
- consequence: `They can ask {provider name}, a company outside Inherit, about the reports you share. It only works while they use that company.`

Wording that would replace "Nothing leaves Inherit" (draft): `For anyone's genome but your own, Copilot runs on a model you host yourself, unless that person lets a named company read the reports they share with you.`

## 5. Risks

1. **A third party's special-category data goes to a processor that party never chose.** The provider's terms bind the asker (whose key it is), not the adult. Retention, training use, logging and sub-processors are the provider's. Revocation cannot recall what was sent.
2. **Consent validity.** The adult consents to a recipient chosen by someone else, often a relative; family pressure is the very risk the 72-hour hold and re-notice address (D-141). The consent must be specific (named provider and tuple), separate from every sharing choice, and as easy to withdraw.
3. **Provider changes.** Every change of the asker's provider, model, origin or key must end the adult's consent before the next request; a missed binding sends data to an unconsented recipient. The recipient tuple and its revision must bind the token, the turn and every recheck, as `copilot.cloud` does for oneself.
4. **Scope creep.** Today the variant and ancestry projections are absolute-deny to a cloud provider; the draft keeps them so. A later "small" extension would send genotypes.
5. **Hosted service exposure.** Today no hosted request can read another adult's data in Copilot at all (transport refuses first). The change moves the boundary from "never" to "consent-gated", in production, for the first time for this data class.
6. **Wording contradictions.** "Nothing leaves Inherit" appears on several pages and in the brief; leaving any of it would mislead.
7. **Mitigation.** The decision `other-adult-mitigation-state-v1` has no case for a `self` record (the grantee case); the 72-hour hold and 30-day re-notice do not reach Family reads of a Path A invitee's own record (see the defect note D-NEW). A cloud path should not open before that is decided.
8. **Jurisdiction.** `third_party_adult_analysis` is unreviewed everywhere; a cloud path additionally discloses to a processor, which several genetic privacy laws treat as a separate disclosure needing its own consent.
9. **Audit and deletion.** Chats built on the adult's reports are deleted on revocation (built), but the provider copy is not; the audit must show what was sent, when and to whom, without storing the payload.

## 6. What counsel should review

1. **Roles.** Inherit, the asker and the provider: who is controller and who processor for the adult's data once sent; whether Inherit, by transmitting, becomes the discloser under each applicable law.
2. **Lawful basis and explicit consent** for special-category (genetic) data of a person who is not the account holder: GDPR Art. 9(2)(a) and Art. 7 (specific, informed, freely given, withdrawable), and whether consent to a recipient chosen by a relative can be freely given.
3. **US state genetic privacy laws** that require separate express consent for each disclosure to a third party (for example the genetic information privacy acts of California, Illinois, Washington and others listed in `/legal/state-genetic-privacy`), and health-data laws (for example Washington's My Health My Data Act) — whether the draft consent satisfies "separate", "express" and "specific recipient".
4. **International transfers** when the provider processes outside the adult's jurisdiction (GDPR Chapter V; UK equivalents).
5. **Retention and deletion**: what Inherit can promise about provider copies; whether the consent text's "cannot take back" is sufficient notice.
6. **Provider terms of service** (Anthropic and OpenAI-compatible endpoints) on submitting third parties' personal and health data through a consumer's key.
7. **The brief's and the product's existing promises** ("Nothing leaves Inherit", "local-model only") and whether changing them needs notice to existing users and adults who already shared.
8. **Records**: the consent artifact, its versioning, the audit of each disclosure, and the account and subject exports.
9. **Exclusions**: minors and embryos stay excluded (the register keeps them absolute-deny); confirm no path reaches them.

## 7. What engineering would build after a "Yes" (for sizing only)

A new artifact and its migration; `copilot.cloud` grants from an adult to a recipient with a recipient-tuple binding (signer rule as `copilot.local`); the scope function's cloud case (reports only), with the tuple in the authority and every recheck; the cloud payload path through the existing provider transport, with `cloud-consent-revocation-v1`'s obligations; the hosted page branch; the permission rows; wording changes across the product; tests including "a provider change ends the adult's consent before the next request". Estimated as large as the self-hosted part.
