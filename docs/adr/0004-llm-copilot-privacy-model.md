# ADR-0004 — Copilot privacy model

- Status: **Accepted** · 2026-08-28

## Decision

1. **BYOK only.** LLM keys are per-user, entered in Settings, encrypted with
   AES-256-GCM under a server env key, stored in a table with no client
   grants, never logged, never returned by any endpoint, deletable.
2. **Local-first ordering.** The settings and empty-state UIs present an
   OpenAI-compatible local endpoint (Ollama/LM Studio/vLLM) as the
   privacy-preferred path, before Anthropic. Local = base URL on
   localhost/RFC-1918/.local; detection in `isLocalBaseUrl`.
3. **Consent gate.** Before any request containing genome-derived data goes
   to a **cloud** provider, the server requires a stored, unrevoked
   `consent_grants` row naming that provider; without it the chat API
   returns 403 `consent_required` and the client shows a dialog naming the
   provider and the exact data classes (`LLM_DATA_CLASSES`). Grants are
   listed and revocable in Settings; revocation takes effect on the next
   request. Local endpoints skip the dialog but the chat always shows a
   data-flow indicator naming where data goes.
4. **Grounding.** The model only sees genome data through five tools
   (`get_genotype`, `search_variants`, `list_reports`, `get_report`,
   `get_prs`) that run under the user's own RLS session. The system prompt
   mandates citation of the underlying report/variant, no-diagnosis
   language, and honest coverage statements.

## The localhost caveat, stated honestly

Chat inference runs in a server route (key decryption must stay
server-side), so a localhost base URL is reachable only when the Sequence
server itself can reach it — i.e. running locally or self-hosted beside the
model. The hosted demo cannot reach a visitor's localhost; the UI says so
explicitly instead of failing mysteriously. A browser-side inference path
(keeping local traffic entirely in-browser against the hosted app) was
considered and deferred: it would duplicate the entire tool-execution loop
client-side; self-hosting already provides the fully-local configuration
this project exists to enable.
