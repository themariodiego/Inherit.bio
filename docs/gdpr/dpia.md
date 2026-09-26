# Data protection impact assessment: hosted My Genome, Copilot and export

**Status: draft for owner and counsel approval, 26 September 2026.** Not legal
advice. When approved, record the date in `impactAssessmentApprovedOn`
(`src/lib/legal/gdpr-launch.ts`). An assessment is mandatory here: this is
large-scale processing of genetic data with new technology (GDPR Art. 35(1),
(3)(b)), and genetic data appears on national regulators' Art. 35(4) lists.
UK GDPR Art. 35 is the same.

**Scope.** The hosted service's My Genome (upload, reports, ancestry, genome
browser), Copilot, export and account email, for people in the EU/EEA and the
UK. Family and embryo features are off in production and need their own
assessments before any EU or UK launch (`/legal/gdpr`).

Facts come from `records-of-processing.md` and `transfer-impact-assessment.md`,
which carry the file references.

## 1. Description (Art. 35(7)(a))

1. **Account.** A person creates an account (email and password), gives a date
   of birth (18+ is checked before any upload) and declares the country they
   live in.
2. **Upload.** They upload their own genome file. It goes straight from the
   browser to private storage in the US under a short-lived, insert-only
   token. Server checks verify the file, then it is prepared into genotypes.
3. **Consent per purpose.** For each purpose (single-gene reports, polygenic
   estimates, ancestry, genome browser, raw export, Copilot) they sign a
   separate, versioned, hashed consent. Nothing runs for a purpose without it.
4. **Results.** Reports are computed on Inherit's servers from public
   scientific catalogues and shown only to the account holder.
5. **Copilot.** If the person chooses a model provider and gives their own API
   key, Inherit's server sends the question and the named report excerpts to
   that provider.
6. **Control.** The person can export everything, withdraw any purpose
   (derived data is deleted within 60 seconds) or delete the account (a 7-day
   notice, then a purge).

Processors are Supabase, Vercel and Resend, all in the US. Nobody else
receives data, and nothing is sold, shared for research or used for
advertising.

## 2. Necessity and proportionality (Art. 35(7)(b))

| Question | Assessment |
| --- | --- |
| Purpose | Specified and explicit: the person's own informational reports. Each use is a separate consent. |
| Legal basis | Explicit consent (Art. 9(2)(a)) per purpose. Account data: contract. Consent evidence: legal obligation (Art. 7(1)). Security and sanctions checks: legitimate interests. |
| Is consent free? | The service is the analysis, so storing the file is necessary for it. Each further purpose, Copilot especially, can be refused alone (Art. 7(4)). |
| Minimisation | Only the person's own file. No street address. No trackers. Emails carry no genome data. The audit log bars identifiers and genotypes. The app database stores no IP address. |
| Accuracy | Evidence levels, "what this doesn't mean", clinical-confirmation notes, and for EU/EEA viewers a line saying it is not a diagnostic test or a certified medical device. |
| Storage limitation | Clocks in `docs/retention.md`: original file one month; derived data 60 seconds after withdrawal; exports 24 hours; audit log 7 years, pseudonymised on deletion. |
| Rights | Export (access, portability), deletion, withdrawal of any grant in Settings, and email for the rest, answered within one month. |
| Transfers | Covered in `transfer-impact-assessment.md`. |

## 3. Risks to people (Art. 35(7)(c))

Severity is about the harm to the person; likelihood is before the measures in
section 4.

| # | Risk | Severity | Likelihood |
| --- | --- | --- | --- |
| R1 | A breach exposes genomes. They cannot be changed, and they reveal health risks and family relationships, including of relatives who never used Inherit. | Very high | Medium |
| R2 | US authorities compel access at a US processor. | High | Low |
| R3 | Copilot sends results to a provider, or a custom endpoint, the person did not expect, or to a place with weaker protection. | High | Medium |
| R4 | A person misreads a health or medicine-response result and makes a medical decision, or suffers distress. | High | Medium |
| R5 | Leaked results are used to discriminate, for example in insurance or employment. | High | Low |
| R6 | Data is kept longer than needed, or deletion is not what the notice promised. | Medium | Medium |
| R7 | A minor uploads a genome. | High | Low |
| R8 | The privacy notice misdescribes the processing, so consent is not "informed". | Medium | Medium |

## 4. Measures (Art. 35(7)(d))

| Risk | In place | Needed before an EU/UK launch |
| --- | --- | --- |
| R1 | v2 tables service-role only; authorization in database functions; RLS on older tables; private buckets; insert-only upload role; TLS; AES-256-GCM for keys, emails and signing names; secret scanning in CI (`gate:secrets`); breach process on `/legal/incident-response` | Turn on the rate limiter (`consume_rate_limit_v1` exists but nothing calls it). Split the single application encryption key by purpose and document rotation. Review authorization in the 91 source files that use the service role. |
| R2 | TLS; data minimisation | Settle the Supabase transfer (clauses plus EO 14086); consider EU-region hosting (see the transfer assessment) |
| R3 | Consent names one provider and the data classes sent; revocable; the key is encrypted | For EU/UK users, allow only preset providers with a settled transfer mechanism; name each provider's country on the consent screen |
| R4 | Evidence labels, confirmation notes, "what this doesn't mean", the EU device line | Counsel review of the residual IVDR risk the owner accepted (26 September 2026) |
| R5 | Nothing sold or shared; GINA and state-law explainers; minimisation | None beyond R1 |
| R6 | Retention register with enforced clocks; export; withdrawal within 60 seconds | Make the privacy notice's deletion section match the 7-day account notice (a task is queued) |
| R7 | Date of birth checked in the app and the database before any upload | None, but record that the age is self-declared |
| R8 | Controller named; processors and transfer mechanisms listed | Fix the deletion wording (R6); publish representatives and, if appointed, the officer |

## 5. Residual risk and prior consultation (Art. 36)

With the "needed" column done, residual risk is **medium**: R1's severity
cannot be reduced, only its likelihood. Without them, R1 and R3 stay high.

If the owner launches while a high residual risk remains, Art. 36 requires
consulting the supervisory authority before processing. The recommendation is
to finish the "needed" column first.

## 6. Review

- **Advice:** a data protection officer's advice is required if one is
  appointed (Art. 35(2)).
- **Review:** re-assess when a feature, processor or region changes, and at
  least every 12 months.
- **Summary:** publish a summary on `/legal/gdpr` when approved.

Approval: ______ (owner) ______ (counsel or officer) Date: ______
