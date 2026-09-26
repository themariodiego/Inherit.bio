# EU and UK launch: GDPR preparation

**Status: drafts for owner and counsel review, 26 September 2026.** Not legal
advice, and not a finding that Inherit complies with the GDPR.

The hosted service is not offered to new people in the EU/EEA or the UK
(`/legal/gdpr`, enforced since 26 September 2026 by
`src/lib/legal/service-restrictions.ts`). The gate is data:
`src/lib/legal/gdpr-launch.ts` holds the appointments and sign-offs, and a
territory opens only when its fields are all filled with real details. France,
Portugal, Hungary, Norway (with Svalbard and Bouvet) and Switzerland stay paused
whatever happens here, because their own genetic-testing laws put the live
product at high risk.

## Documents in this folder

| File | What it is | Needs |
| --- | --- | --- |
| [`dpia.md`](dpia.md) | Data protection impact assessment for the hosted service (GDPR Art. 35) | Owner and counsel approval, then `impactAssessmentApprovedOn` |
| [`records-of-processing.md`](records-of-processing.md) | Record of processing activities (Art. 30(1)) | Owner review; keep current |
| [`transfer-impact-assessment.md`](transfer-impact-assessment.md) | Transfers to the United States, mainly Supabase (Art. 46, *Schrems II*) | Owner and counsel approval, then `transferReviewApprovedOn` |
| [`dpo-position.md`](dpo-position.md) | Whether a data protection officer is required (Art. 37) | Owner decision |

## Launch checklist

Only the owner can do the items marked **Owner**. They involve contracts,
appointments or accepting legal risk.

| # | Item | Who | Status |
| --- | --- | --- | --- |
| 1 | EU Article 27 representative, established in an EU member state where Inherit's users are, under a written mandate. Publish name, postal address and email. | Owner | Not appointed |
| 2 | UK representative (UK GDPR Art. 27), established in the UK. | Owner | Not appointed |
| 3 | Data protection officer, or a recorded decision that none is required (`dpo-position.md`). | Owner | Open |
| 4 | Data processing agreements (Art. 28) with Supabase, Vercel and Resend. Vercel says its DPA covers paid plans only, so confirm the plan. | Owner | Not confirmed |
| 5 | Approve the DPIA with counsel, then set `impactAssessmentApprovedOn`. | Owner | Draft ready |
| 6 | Approve the transfer impact assessment with counsel, then set `transferReviewApprovedOn`. | Owner | Draft ready |
| 7 | Decide whether to publish a postal contact for the controller. Art. 13(1)(a) needs "contact details"; email meets the letter, and many regulators expect a postal address. A service address avoids publishing a home address. | Owner | Open |
| 8 | Digital Services Act: counsel to confirm whether storing users' uploads makes Inherit a "hosting service". If so, it needs an EU legal representative (DSA Art. 13), which representative firms often bundle, and a notice-and-action channel (Art. 16). | Owner, counsel | Open |
| 9 | UK: counsel to confirm whether a controller not established in the UK owes the ICO data protection fee, and whether the MHRA treats the health reports as an in-vitro diagnostic (UK Responsible Person and registration). | Owner, counsel | Open |
| 10 | EU medical-device risk: the owner chose a disclaimer on EU/EEA health reports (26 September 2026) instead of hiding them. Counsel should confirm that residual IVDR risk is acceptable. | Owner, counsel | Accepted by owner, unreviewed |
| 11 | Launch-gate data and page rendering. | Engineering | Done in this pull request |
| 12 | Privacy notice gaps: legal bases for processing that is not consent-based, a destination map with every processor, and withdrawal of any grant. | Engineering | Done in this pull request |
| 13 | Copilot for EU/UK users: allow only preset providers with a settled transfer mechanism, name each provider's country on the consent screen, and settle the mechanism per provider (transfer assessment, step 5). | Engineering, then owner | Not started |
| 14 | Security items from the DPIA: turn on the unused rate limiter (`consume_rate_limit_v1`), split the single application encryption key by purpose and document rotation, and review authorization in the service-role call sites. | Engineering | Not started |
| 15 | Make the privacy notice's deletion section match the 7-day account notice (a separate task is queued). | Engineering | Queued |

## Opening a territory

When items 1–6 and 13–15 are done for a territory:

1. Fill the matching fields in `src/lib/legal/gdpr-launch.ts` with the real
   legal names, postal addresses, emails and dates.
2. Update the `/legal/gdpr` content pins in `e2e/legal.spec.ts`. They pin
   today's "not appointed" sentences, so they will fail until they pin the
   published names.
3. Record the opening in `docs/protocol/decisions.md`.

`pausedCountryCodesFor` then stops pausing that territory, and `/legal/gdpr`
names the appointees and states that the service is offered there.
