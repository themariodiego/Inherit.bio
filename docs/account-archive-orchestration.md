# Complete account member orchestration

The segmentation core accepts a separate `prepareSource` hook after the real
durable attempt INSERT succeeds. The INSERT still has its original 30-second
limit. Source planning may sequence separately bounded reads and validations;
it is fenced by the original job deadline and cancellation signal. Each source
adapter retains its own operation limit, source expiry and before/after current
authority checks. The hook cannot admit ZIP bytes or provider writes until all
required member proofs succeed and the whole authority is checked again.

An ignored cancellation or late planner completion cannot start the source,
reserve an object or write bytes. An uncertain attempt INSERT retains the
existing cleanup hold. Existing callers without the hook keep their original
behavior and all read/write/metadata operation limits remain unchanged.

Focused tests preserve the existing segmentation assertions and prove that two
separate 20-second preparation steps complete after a real attempt, a stalled
INSERT still fails at 30 seconds, cancellation and the original deadline close
an uncooperative planner, and authority revoked during planning prevents source
acquisition. Synthetic operation seams establish orchestration behavior only.

The complete account executor must still connect every actual registered class
and authorized partition, independently prove complete member identities,
counts and bytes, and exercise real POST/status worker flow. Nonempty classes
without a proved producer remain a whole-request refusal. No public or READY
gate, provider choice, source lease, human authority or analytical grant changes.
This prerequisite supplies no database, hosted-browser or provider credit.
