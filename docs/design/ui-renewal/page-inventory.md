# Page review inventory

All 71 `page.tsx` entrypoints were opened in Chrome at 1440×1000, 768×1024 and 390×844. Redirects were followed to their destinations. Shared layouts were reviewed with both colour themes, keyboard navigation and reduced motion. Public and signed-in reviewers also tested 320px reflow.

This inventories page templates, not every possible report, consent version, account permission combination or genetic result. Dynamic routes use synthetic local fixtures. Initial invalid-identifier coverage is supplemented by the valid-state review recorded in README.md.

| Page file | Sample path | Reviewed state(s) | Desktop / tablet / phone |
| --- | --- | --- | --- |
| `src/app/(app)/ancestry/page.tsx` | `/ancestry` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/browse/page.tsx` | `/browse` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/chat/page.tsx` | `/chat` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/copilot/[scope]/page.tsx` | `/copilot/me` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/copilot/page.tsx` | `/copilot` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/dashboard/page.tsx` | `/dashboard` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/embryos/[embryoId]/page.tsx` | `/embryos/<synthetic-embryo>` | Unavailable, valid consent-required and processing | Reviewed / reviewed / reviewed |
| `src/app/(app)/embryos/compare/page.tsx` | `/embryos/compare` | Empty, consent-required, processing, awaiting file | Reviewed / reviewed / reviewed |
| `src/app/(app)/embryos/page.tsx` | `/embryos` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/embryos/request-data/page.tsx` | `/embryos/request-data` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/embryos/upload/page.tsx` | `/embryos/upload` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/family/[person]/page.tsx` | `/family/<synthetic-handle>` | Invalid handle, then valid unshared person | Reviewed / reviewed / reviewed |
| `src/app/(app)/family/[person]/permissions/page.tsx` | `/family/<synthetic-handle>/permissions` | Invalid handle, then valid permission rows | Reviewed / reviewed / reviewed |
| `src/app/(app)/family/health-picture/page.tsx` | `/family/health-picture` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/family/invite/page.tsx` | `/family/invite` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/family/portrait/[pairId]/page.tsx` | `/family/portrait/<synthetic-pair>` | Invalid pair, then valid waiting-for-other-person | Reviewed / reviewed / reviewed |
| `src/app/(app)/files/page.tsx` | `/files` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/files/upload/page.tsx` | `/files/upload` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/ancestry/page.tsx` | `/genome/me/ancestry` | Empty and populated synthetic map/table | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/data/browser/page.tsx` | `/genome/me/data/browser?q=rs762551` | Empty and populated synthetic results | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/data/page.tsx` | `/genome/me/data` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/page.tsx` | `/genome/me` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/reports/[slug]/page.tsx` | `/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551` | Preview and populated synthetic result | Reviewed / reviewed / reviewed |
| `src/app/(app)/genome/[subject]/reports/page.tsx` | `/genome/me/reports` | Empty library and source/consent choices | Reviewed / reviewed / reviewed |
| `src/app/(app)/overview/page.tsx` | `/overview` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/reports/[slug]/page.tsx` | `/reports/skin-uv-sensitivity-slc45a2` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/reports/page.tsx` | `/reports` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(app)/settings/consents/page.tsx` | `/settings/consents` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/settings/copilot/page.tsx` | `/settings/copilot` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/settings/data/page.tsx` | `/settings/data` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/settings/page.tsx` | `/settings` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/settings/people/page.tsx` | `/settings/people` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(app)/uploads/page.tsx` | `/uploads` | Redirect destination | Reviewed / reviewed / reviewed |
| `src/app/(family-hub)/family/page.tsx` | `/family` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/about/page.tsx` | `/about` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/changelog/page.tsx` | `/changelog` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/embryo-analysis/page.tsx` | `/embryo-analysis` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/future-person/claim/page.tsx` | `/future-person/claim` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/[artifact]/diff/[from]/[to]/page.tsx` | `/legal/consent.own-monogenic/diff/1/2` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/[artifact]/page.tsx` | `/legal/consent.own-monogenic` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/[artifact]/versions/[version]/page.tsx` | `/legal/consent.own-monogenic/versions/1` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/appeals/page.tsx` | `/legal/appeals` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/consent/[key]/diff/[from]/[to]/page.tsx` | `/legal/consent/consent.own-monogenic/diff/1/2` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/consent/[key]/page.tsx` | `/legal/consent/consent.own-monogenic` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/consent/[key]/v/[version]/page.tsx` | `/legal/consent/consent.own-monogenic/v/1` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/consents/page.tsx` | `/legal/consents` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/deceased/page.tsx` | `/legal/deceased` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/future-person/page.tsx` | `/legal/future-person` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/gdpr/page.tsx` | `/legal/gdpr` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/gina/page.tsx` | `/legal/gina` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/incident-response/page.tsx` | `/legal/incident-response` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/insurance-and-discrimination/page.tsx` | `/legal/insurance-and-discrimination` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/law-enforcement/page.tsx` | `/legal/law-enforcement` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/page.tsx` | `/legal` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/research-consent/page.tsx` | `/legal/research-consent` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/self-hosting/page.tsx` | `/legal/self-hosting` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/state-genetic-privacy/page.tsx` | `/legal/state-genetic-privacy` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/legal/where-inherit-works/page.tsx` | `/legal/where-inherit-works` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/page.tsx` | `/` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/privacy/page.tsx` | `/privacy` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/providers/page.tsx` | `/providers` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/science/limits/page.tsx` | `/science/limits` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/science/page.tsx` | `/science` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/science/positions/page.tsx` | `/science/positions` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/terms/page.tsx` | `/terms` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/withdraw/[token]/page.tsx` | `/withdraw/request` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/(marketing)/withdraw/session/page.tsx` | `/withdraw/session` | Unavailable, then valid invitation form | Reviewed / reviewed / reviewed |
| `src/app/auth/forgot-password/page.tsx` | `/auth/forgot-password` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/auth/reset-password/page.tsx` | `/auth/reset-password` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/auth/sign-in/page.tsx` | `/auth/sign-in` | empty-or-public | Reviewed / reviewed / reviewed |
| `src/app/auth/sign-up/page.tsx` | `/auth/sign-up` | empty-or-public | Reviewed / reviewed / reviewed |
