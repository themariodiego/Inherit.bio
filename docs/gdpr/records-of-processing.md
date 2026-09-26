# Record of processing activities (GDPR Article 30(1))

**Status: draft for owner review, 26 September 2026.** Keep this current. The
small-organisation exemption in Art. 30(5) does not apply, because Inherit
processes special-category (genetic and health) data. UK GDPR Art. 30 is the
same. References point to the repository as of this date; `docs/retention.md`
is the binding authority for every retention clock and wins over this summary.

## (a) Controller

| Role | Details |
| --- | --- |
| Controller | Mario Diego, an individual (Inherit is not incorporated). Contact: privacy@inherit.bio |
| EU representative (Art. 27) | Not appointed (`src/lib/legal/gdpr-launch.ts`) |
| UK representative | Not appointed |
| Data protection officer | Not appointed (`docs/gdpr/dpo-position.md`) |

## (b)–(d), (f) Processing activities

Bases are written as GDPR articles. "Explicit consent" means Art. 6(1)(a) with
Art. 9(2)(a), recorded per purpose against a versioned, hashed consent text
(`consent_artifacts`, `consent_signatures`, `purpose_grants`).

| # | Activity and purpose | People | Personal data | Legal basis | Recipients | Retention |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Account and sign-in | Account holders | Email and password hash (Supabase Auth), display name, date of birth (for the 18+ check), declared country with its attestation version and hash, digest preference | Contract, Art. 6(1)(b). Age check: legitimate interests, Art. 6(1)(f), in keeping minors off an adult-only genetics service | Supabase, Vercel | For the life of the account; deleted after the 7-day account-deletion notice (`account-deletion.notice-7d`, `account-deletion.purge-owned`) |
| 2 | Storing an uploaded genome file | Account holders (their own file only) | Raw genome file (array export, VCF/gVCF), file metadata, parsed genotypes (`user_variants`, `report_observed_calls`) | Explicit consent | Supabase, Vercel | Original file for one calendar month, then retired (`source.original-calendar-month`); prepared data until the file or account is deleted |
| 3 | Reports and ancestry | Account holders | Genotypes; derived single-gene results, polygenic scores, medicine-response and ancestry results | Explicit consent per purpose (`reports.monogenic`, `reports.polygenic`, `ancestry`) | Supabase, Vercel | Until the purpose is withdrawn (derived rows deleted within 60 seconds, `purpose.derived-60s`) or the account is deleted |
| 4 | Genome browser and raw access | Account holders | Genotypes, file contents | Explicit consent (`raw.browse`, `raw.export`) | Supabase, Vercel | As item 3 |
| 5 | Copilot | Account holders | Questions, answers (stored as plain JSON), the report and variant excerpts sent as context, the person's own model API key (AES-256-GCM encrypted; last four characters in clear) | Explicit consent naming one provider (`copilot.cloud`) | Supabase, Vercel, and the model provider the person names (Anthropic, OpenAI, xAI, or a custom HTTPS endpoint), called from Inherit's server | Chats until deleted, the Copilot consent is withdrawn or superseded, or the account is deleted |
| 6 | Export | Account holders | Everything above, packaged | Explicit consent (`raw.export`, `export.share-link`); the right to data portability (Art. 20) | Supabase (private `exports` bucket), Vercel | Export archives 24 hours (`export.generated-artifact-24h`) |
| 7 | Service email | Account holders; invited adults (invitations are off in production) | Email address (encrypted in the outbox), message content; report-ready mail says only that reports exist | Contract, Art. 6(1)(b) | Resend, Supabase, Vercel | Outbox row expiry at most 30 days; Resend's own payload retention 30 days or less (`mail.resend-provider-payload-30d`) |
| 8 | Research digest email | Account holders who opt in | Email address | Consent, Art. 6(1)(a) | Resend | Until opt-out or account deletion |
| 9 | Consent evidence and legal audit | Account holders | Consent signatures (typed signing names encrypted), grants and revocations; a hash-chained audit log that bars account IDs, emails, names, tokens and genotypes from its context | Legal obligation, Art. 6(1)(c): proving consent (Art. 7(1)); and legitimate interests, Art. 6(1)(f), in defending legal claims | Supabase | Audit log 7 years (`audit.legal-log-7y`), pseudonymized on account deletion (`audit.pseudonymize-on-deletion`); signatures until account deletion |
| 10 | Security and sanctions compliance | Anyone connecting | Hosting provider's server logs (IP address, request metadata); the country and region the host derives from the IP, read once per request and not stored | Legitimate interests, Art. 6(1)(f): securing the service, and refusing places under comprehensive US embargoes, which bind the controller | Vercel, Supabase | Server logs 30 days, as the privacy page states; not verified against provider settings. Location: not stored |
| 11 | Family and embryo features | Relatives, co-parents, embryo records | Relatives' genomes, embryo files, invitations | Explicit consent of each adult | Supabase, Vercel | **Off in production.** Needs its own DPIA before any EU or UK launch (`/legal/gdpr`) |

## (d) Recipient categories

- **Processors:**
  - Supabase: database and storage, AWS us-east-1 (`docs/deployment.md`).
  - Vercel: application hosting and functions. The region is not pinned in the repository, so Vercel's default US region applies.
  - Resend: email.
- **Not yet a processor:** Cloudflare. Its R2 prepared-artifact gateway is deployed but not activated in production (`docs/hosted-preparation-activation.md`). The privacy notice must name it before activation.
- **Recipients the person chooses:** the Copilot model provider they name.
- **Not a recipient:** Plus Bio, or any other commercial business.

## (e) Transfers to third countries

Every processor is in the United States. See `transfer-impact-assessment.md`.

| Recipient | Country | Mechanism |
| --- | --- | --- |
| Supabase | US | Standard contractual clauses in Supabase's DPA (no Data Privacy Framework record) |
| Vercel | US | EU–US Data Privacy Framework, UK extension, Swiss–US framework (active) |
| Resend | US | EU–US Data Privacy Framework and UK extension ("re-certification under review"); SCCs in its DPA |
| Anthropic, OpenAI, xAI | US | No framework record found by name search; mechanism to be settled (see the transfer assessment) |
| Custom Copilot endpoint | Anywhere | Unknown by design; see the transfer assessment |

## (g) Security measures (summary)

- **Access control:**
  - The v2 tables are service-role only.
  - Authorization is decided in `SECURITY DEFINER` database functions.
  - Row-level security applies to the original tables.
  - Uploads go straight from the browser to storage under a short-lived token for a role that can only insert (`inherit_upload_only`).
- **Encryption:**
  - TLS in transit.
  - Provider-managed encryption at rest.
  - Application-level AES-256-GCM for model API keys, recipient emails and typed signing names, under one key held in the hosting environment (`src/lib/crypto.ts`).
- **Storage:** private buckets. Signed URLs are used only for a 300-second legacy original-file download.
- **Audit:** an append-only, hash-chained legal audit log.
- **Deletion:** clocks are set by `docs/retention.md`. Derived data is removed within 60 seconds of withdrawal.
- **Not collected:** no third-party trackers; the application database stores no IP address or user agent.
