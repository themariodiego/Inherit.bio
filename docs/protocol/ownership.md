# Path ownership

One workstream per path prefix. Other streams request changes through
`docs/protocol/decisions.md` rather than editing.

| Path prefix | Owner | Notes |
| --- | --- | --- |
| `supabase/migrations/`, `supabase/tests/` | Platform | single migration author; timestamp-ordered series |
| `src/app/globals.css` | Platform | frozen identity tokens; changes need an ADR |
| `src/components/site/app-nav.tsx` | Platform | five-item navigation |
| `src/lib/figures/`, `src/components/figures/`, `src/copy/figures/` | Statistical presentation | X4 contract |
| `src/lib/genome/taxonomy.ts`, `src/lib/genome/categories.ts`, `data/templates/` | My Genome | X5 taxonomy |
| `src/components/reports/`, `src/copy/reports/`, `src/app/(app)/genome/` | My Genome | X13.1 skeleton and report surfaces |
| `src/app/(app)/overview/`, `src/copy/overview.ts`, `src/copy/navigation.ts` | Information architecture | X9 Overview |
| `src/app/(app)/family/`, `src/components/family/` | Family | |
| `src/app/(app)/embryos/`, `src/components/embryo/`, `src/lib/embryos/` | Embryo Analysis | |
| `src/app/api/chat/`, `src/components/chat/`, `src/copy/copilot/` | Copilot | |
| `data/jurisdictions.json`, `content/legal/`, `src/app/(marketing)/legal/` | Consent, identity and jurisdiction | |
| `scripts/`, `.github/workflows/` | Platform | gates and CI |
| `docs/` | Orchestrator | ledgers are append-only |
| `src/lib/family/`, `src/copy/family/`, `src/app/(family-hub)/`, `src/app/api/family/`, `data/family-trait-allowlist.json` | Family | W9 graph, access, gate, grants, carrier pairs, Portrait libraries |
| `src/copy/upload/`, `src/lib/genome/parsers/sniff.ts`, `src/lib/genome/parsers/sniff-browser.ts`, `src/lib/genome/parsers/pgt-table.ts`, `src/lib/genome/ingest-errors.ts`, `src/lib/genome/ingest-limits.ts`, `data/ref/lab-tables/` | Platform | genetic ingest shared by every flow: the A.6 refusals, `sniffV2`, the laboratory-table header rule, the payload-limit mirror (design w10 §10, E0) |
| `src/copy/embryos/` | Embryo Analysis | the Embryo copy registry, including the upload flow |
