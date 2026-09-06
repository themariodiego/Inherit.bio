# Copilot output-contract repair

## Defect and implementation

D-095 is separate from the input-intent gate: an allowed question could receive
a prohibited model-authored diagnosis, treatment directive or embryo choice.
The old output checks accepted such statements when they contained no
unsupported number or citation.

The buffered chat route now checks these assertions and directives before
replaying any chunks. Failure returns the existing intent-specific refusal
as the whole assistant turn, with no original tool parts. Legitimate file
facts, uncertainty, source navigation and clinical-conversation suggestions
have explicit regression cases. The input classifier, provider configuration,
consent decisions, tool permissions and report access are unchanged.

The stream fold also formerly inserted a newline between every provider
fragment. That could split a word, citation or percentage into different
tokens from those shown by the client. Deltas now concatenate within each
part, preserving the start order and separate text/reasoning identities.
An actual AI SDK message-assembly test checks that ordering. The production
route suppresses reasoning before buffering; it does not forward reasoning.

This is a deterministic regression defense, not a proof that a word-pattern
checker recognizes every possible paraphrase or validates all scientific
claims. No model was trained or evaluated on a real user's genome.

## Evidence, 2026-09-06

- 214 focused unit tests pass, including 60 completion cases and every
  two-fragment character partition of the prohibited answers.
- The targeted production-build browser run beginning
  **2026-09-06T03:26:45.960Z** passed **62/62** in 55.5 seconds:
  60 new output cases and both existing refusal tests, zero skips or retries.
  A further assertion waits for the Send button to re-enable after each case;
  the full CI run must verify that final test revision.
- Each new case sends an allowed question through the actual settings,
  consent and chat flow. The local model mock requests the real genotype
  tool, then streams its configured completion one character at a time.
  Exactly two provider requests are asserted per case.
- Tests compare the complete delivered assistant text to the expected answer
  or refusal, require the correct header, and require absence of all tool
  chunks on refusal. Positive cases keep their tool result and exact answer.
- A fresh UUID synthetic account uses the tiny committed VCF and the local
  Supabase stack. No hosted data, real emails, database reset or catalog edits.
- Typecheck and lint pass locally. Full-suite/PR/deployment verification
  remains to be recorded; this document does not claim deployment.

The first test attempt exposed a harness encoding mismatch: Chromium's
response-body inspection read charset-less SSE as Windows-1252 while the
actual page correctly used UTF-8. The final test captures real server bytes
through Playwright's request transport and forwards those bytes unchanged.
It does not stub the chat route or weaken exact-text equality. Interrupted
test servers were stopped by their verified process IDs before the fresh run.
The passing run also logged one destination-stream-closed message during the
existing refusal suite; it is not evidence of an error-free runtime log.

## Full-plan boundary

Full-plan acceptance remains **18/65** and G4.8 remains **NO**.
These self-scope output regressions do not replace A.9's exact 80-case suite,
its family/cohort/Portrait tools and inherited scopes, or its release-time
live evaluation. They repair a reproduced defect in the shipped chat path.
No unfinished capability is enabled to manufacture acceptance evidence.
