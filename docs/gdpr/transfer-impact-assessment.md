# Transfer impact assessment: personal data sent to the United States

**Status: draft for owner and counsel approval, 26 September 2026.** Not legal
advice. When approved, record the date in `transferReviewApprovedOn`
(`src/lib/legal/gdpr-launch.ts`). Every hosted-service processor is in the
United States, so every EU/EEA and UK user's data is transferred there (GDPR
Chapter V; UK GDPR Chapter V). This follows the EDPB's six steps
(Recommendations 01/2020, v2.0).

## Step 1. The transfers

| Recipient | Role | What it receives | Where |
| --- | --- | --- | --- |
| Supabase | Processor: database and storage | Everything: account data, genome files, genotypes, reports, chats, consent records | AWS us-east-1 (`docs/deployment.md`) |
| Vercel | Processor: application and functions | Everything in transit through the app, request logs | US; the region is not pinned in the repository |
| Resend | Processor: email | Email addresses and message bodies; no genome data or results | US |
| Anthropic, OpenAI, xAI, or a custom HTTPS endpoint | The person's chosen model provider, called from Inherit's server with the person's own API key | The question, and the report and variant excerpts named in the Copilot consent (`src/lib/llm.ts`) | US for the three presets; anywhere for a custom endpoint |

The data is genetic and health data, the most sensitive kind the GDPR names
(Art. 9). Genomes also identify relatives who never used the service.

## Step 2. The transfer mechanism

| Recipient | Mechanism | Evidence |
| --- | --- | --- |
| Vercel | EU–US Data Privacy Framework, UK Extension and Swiss–US framework: all active | DPF List, checked 26 Sep 2026 (country research memo, Western Europe tab) |
| Resend | EU–US framework and UK Extension, "Active – Re-certification under Review"; SCCs also in its DPA | Same check |
| Supabase | **Standard contractual clauses (Art. 46(2)(c))** in Supabase's DPA, with the UK Addendum. No framework record. | Supabase DPA; same check |
| Model providers | **Not settled.** A name search found no framework record for Anthropic, OpenAI or xAI; counsel should re-check their legal names. | Same check |

Where the adequacy decision covers a recipient (Vercel, Resend), no further
assessment is legally needed while that decision stands. The assessment below
is for Supabase, and for the model providers until a mechanism is settled.

## Step 3. Does US law undermine the clauses?

- **Executive Order 14086 (2022)** added necessity and proportionality limits
  to US signals intelligence and created the Data Protection Review Court. The
  Commission relied on it in adequacy decision (EU) 2023/1795. The EDPB has
  said those safeguards apply to all transfers to the US, whatever the transfer
  tool, so they support SCC transfers to Supabase too.
- **The adequacy decision is under challenge:**
  - The General Court upheld it on 3 September 2025 (*Latombe*, T-553/23).
  - An appeal, C-703/25 P, is pending, with no judgment found as of 26 September 2026.
  - The US Supreme Court's June 2026 ruling on FTC removal protections (*Trump v. Slaughter*) is widely read as a threat to the framework's enforcement design.
- **FISA Section 702** allows compelled access at US "electronic communication
  service providers", a category that can include cloud hosts.
  - Reports say its statutory authority lapsed on 12 June 2026 after Congress did not extend it again.
  - Collection under existing court certifications reportedly continues until about March 2027.
  - Counsel must confirm the current position.
  - Sources (secondary, checked 26 September 2026): EFF, "Victory! 702 has Expired!" (June 2026); CNBC, report on the short-term extension (30 April 2026); the Brennan Center's Section 702 2026 resource page.
- **Executive Order 12333** governs collection outside FISA, including in
  transit. TLS on every hop limits it.

**Practical likelihood.** No request for Inherit data is known. Supabase's
transparency reporting should be checked and recorded here. Inherit holds no
data of obvious foreign-intelligence interest, but genetic data is sensitive
enough that the assessment should not rest on likelihood alone.

## Step 4. Supplementary measures

In place:
- TLS in transit on every hop.
- Provider-managed encryption at rest. The provider holds the keys, so this does not stop compelled access at the provider.
- Application-level AES-256-GCM for model API keys, recipient emails and typed signing names (`src/lib/crypto.ts`). Its key sits in the hosting environment, which is also in the US.
- Data minimisation:
  - Emails carry no genome data.
  - The audit log bars identifiers and genotypes.
  - Derived data is deleted within 60 seconds of withdrawal.

Not in place, and worth weighing:
- **EU-region hosting** for EU/EEA users' data (Supabase offers EU regions).
  This removes the storage transfer. It needs a second project and routing by
  declared country, which is a large change.
- **Application-level encryption of genotypes and chats** with keys held
  outside the US. It protects stored data from compelled access, but the app
  must decrypt to compute reports, so it does not cover processing.
- **Pseudonymisation.** Genomes cannot be meaningfully pseudonymised: the
  genotype itself identifies the person.

## Step 5. The model providers

Every Copilot request runs on Inherit's server, which decrypts the person's key
and calls the provider (`src/lib/copilot/own-provider-authority.ts`). Inherit
therefore decides where the data goes, and is responsible for the transfer.
Options before an EU/UK launch:

1. **Presets only for EU/UK users (recommended).** Disable custom endpoints for
   people who declared an EU/EEA or UK country, and confirm a mechanism for each
   preset. That means framework certification under the provider's legal name,
   or clauses in the provider's API terms.
2. Rely on the explicit-consent derogation (Art. 49(1)(a)). It is meant for
   occasional transfers, so it is weak for a feature used routinely.

A custom endpoint can be anywhere, including a "country of concern" under the
US DOJ bulk-data rule (28 CFR part 202). Option 1 also addresses that for these
users.

## Step 6. Conclusion (draft)

- **Vercel and Resend:** the adequacy decision covers them while it stands.
  Re-check Resend's re-certification.
- **Supabase:** clauses plus EO 14086 are a defensible basis today. Residual
  risk is the pending appeal and the Section 702 position. Re-assess when
  either changes, and at least every 12 months.
- **Model providers:** not settled. Do not open the EU/UK until option 1 (or
  another mechanism counsel accepts) is in place.

Approval: ______ (owner) ______ (counsel) Date: ______
