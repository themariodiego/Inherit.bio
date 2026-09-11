/**
 * When the page retries an interrupted finalization on its own.
 *
 * The delays are measured against the thing that actually refuses an early
 * retry rather than chosen for feel. `subject-finalization.ts` holds a
 * finalization lease of 60 seconds, and a finalization whose holder died still
 * owns that lease until it lapses - `own_upload_finalization_v1` refuses a
 * second request inside it on purpose, so that two requests can never drive
 * one finalization. An attempt made inside the first minute is therefore
 * expected to be refused.
 *
 * It is still worth making. A failure that never reached the server holds no
 * lease at all, and resuming costs only what the interrupted attempt left
 * undone (ADR-0026), so an early attempt is cheap and often enough. The last
 * delay is past the lease, which is the first moment a genuinely stalled
 * finalization can be taken over.
 *
 * Three, then the person decides. An upload that has refused four times is not
 * one more retry away from working, and a page that kept trying would be
 * hiding a real refusal behind motion.
 *
 * This is a client module on purpose: `subject-finalization.ts` is
 * `server-only`, so the lease it declares cannot be imported here. The
 * relationship between the two is asserted in `finish-retry-policy.test.ts`
 * against that file's own source, so the two cannot drift apart silently.
 */
export const AUTO_FINISH_DELAYS_MS: readonly number[] = [2_000, 20_000, 70_000];
