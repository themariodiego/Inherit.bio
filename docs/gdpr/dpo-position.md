# Data protection officer: position for owner decision

**Status: draft for owner decision, 26 September 2026.** Not legal advice. The
EU/UK launch gate (`src/lib/legal/gdpr-launch.ts`) currently requires a named
officer because `/legal/gdpr` has said so since 1 September 2026. If the owner
decides an officer is not required, that page and the gate change together, and
this file records why.

## The rule

GDPR Article 37(1)(c), mirrored in UK GDPR, requires a controller to designate
a data protection officer where its "core activities … consist of processing on
a large scale of special categories of data pursuant to Article 9". Genetic data
is a special category (Art. 9(1)), and processing it is Inherit's core activity.
The open question is only whether the processing is "large scale".

The GDPR does not define "large scale". The Article 29 Working Party's DPO
guidelines (WP243 rev.01, endorsed by the EDPB) list four factors:

1. the number of data subjects, as a number or as a share of the population;
2. the volume of data and the range of data items;
3. the duration or permanence of the processing;
4. its geographical extent.

## How the factors apply today

| Factor | Inherit today | Leans |
| --- | --- | --- |
| Number of people | 24 profiles in production on 26 September 2026 (read-only count), 3 of them with an EU country declared | not large |
| Volume and range | A whole genome file per person: hundreds of thousands to millions of genotypes, plus derived health, medicine-response and ancestry reports | large |
| Duration | Kept for the life of the account | large |
| Geography | Offered worldwide; the EU/EEA would be one market among many | large |

Three factors lean towards large scale even at today's size. The guidelines'
own examples put one physician's patient records below the line and a hospital's
above it. A service that holds complete genomes for anyone in the EU who signs
up is closer to the second.

## Options

1. **Appoint an officer before the EU/UK launch (recommended).** An external
   officer is allowed (Art. 37(6)) and is often sold together with EU and UK
   representation. It removes the question, and the officer then signs off the
   DPIA, which the launch gate also needs. The officer must be independent, so it
   cannot be the owner (Art. 38(3), (6)).
2. **Record that no officer is required yet.** This means the owner accepts
   that a regulator may read "large scale" differently. The record should name
   the threshold that triggers an appointment, for example the number of EU/UK
   accounts or the start of any family or embryo feature. The gate and
   `/legal/gdpr` then drop the officer requirement.

## What changes in the repository

- **Option 1:** fill `dataProtectionOfficer` in `src/lib/legal/gdpr-launch.ts`
  with the officer's legal name, postal address, email and appointment date.
  `/legal/gdpr` then publishes them (Art. 37(7)), and the officer's contact also
  goes into the privacy page (Art. 13(1)(b)).
- **Option 2:** remove the officer from `sharedPreconditionsMet` in
  `gdpr-launch.ts`, change the `/legal/gdpr` sentence, and add the reasoning and
  threshold to `docs/protocol/decisions.md`.
