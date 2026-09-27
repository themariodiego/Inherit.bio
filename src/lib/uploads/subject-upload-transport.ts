/** Conservative stored-byte cap for the single XHR POST in
 * `subject-upload-browser.ts`. Shared with issuance so a configured ceiling
 * cannot authorize bytes this upload path cannot carry.
 *
 * Measurement: docs/evidence/hosted-proof-20260919/upload-transport-limit.json,
 * 20 September 2026. A 5,242,880,000-byte request began transferring;
 * 5,368,708,096 bytes and above received an immediate 413. Accepted probes
 * were deliberately aborted: this is not an exact boundary, a completed
 * upload measurement, or evidence of preparation capacity at this size.
 * Raising the stored-file configuration does not change this request cap. */
export const SINGLE_REQUEST_MAXIMUM_BYTES = 5_242_880_000;
