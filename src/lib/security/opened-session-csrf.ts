/**
 * The first one-time `X-Inherit-CSRF` values of a session that an answer
 * opens (G8.5, the migration stage, 19 November 2026). The answer that opens
 * an evidence or embryo upload session cannot carry them in its own
 * `X-Inherit-CSRF`: that header carries the successor of the opening route's
 * own token. Tokens are per route, so the opened session's first values
 * travel together in one answer header of their own, in a fixed order,
 * separated by one space; the browser sends each in `X-Inherit-CSRF` on its
 * route and follows its successors from there.
 *
 * - `X-Inherit-Evidence-CSRF` (the three evidence-session openers):
 *   `<api.evidence-chunk> <api.evidence-complete>`. The first is the chunk
 *   stream's one session-bound value (principle 3), sent unchanged on every
 *   chunk; the second is the completion's first one-time token.
 * - `X-Inherit-Upload-CSRF` (api.embryo-cohorts' 201, which opens the embryo
 *   upload session): `<api.embryo-ingest-configure> <api.embryo-ingest-mapping>
 *   <api.embryo-ingest-complete>`. api.embryo-ingest-chunk carries none.
 *
 * A repeated header, a missing value or anything that is not the token's
 * shape reads as no value at all, so the request it would have carried is
 * refused rather than sent with something else.
 */

export const EVIDENCE_SESSION_CSRF_HEADER = "x-inherit-evidence-csrf";
export const UPLOAD_SESSION_CSRF_HEADER = "x-inherit-upload-csrf";

const TOKEN = "\\d{13}\\.[A-Za-z0-9_-]{43}\\.[0-9a-f]{64}";
const PAIR = new RegExp(`^(${TOKEN}) (${TOKEN})$`, "u");
const TRIPLE = new RegExp(`^(${TOKEN}) (${TOKEN}) (${TOKEN})$`, "u");

export type EvidenceSessionCsrf = Readonly<{ chunk: string; complete: string }>;
export type UploadSessionCsrf = Readonly<{ configure: string; mapping: string; complete: string }>;

/** The header value an evidence-session opener sets. */
export function evidenceSessionCsrfValue(tokens: EvidenceSessionCsrf): string {
  return `${tokens.chunk} ${tokens.complete}`;
}

/** The header value the embryo upload session's opener sets. */
export function uploadSessionCsrfValue(tokens: UploadSessionCsrf): string {
  return `${tokens.configure} ${tokens.mapping} ${tokens.complete}`;
}

/** The evidence session's two first values from an opening answer, or null. */
export function readEvidenceSessionCsrf(headers: Pick<Headers, "get">): EvidenceSessionCsrf | null {
  const match = PAIR.exec(headers.get(EVIDENCE_SESSION_CSRF_HEADER) ?? "");
  return match ? { chunk: match[1]!, complete: match[2]! } : null;
}

/** The upload session's three first values from an opening answer, or null. */
export function readUploadSessionCsrf(headers: Pick<Headers, "get">): UploadSessionCsrf | null {
  const match = TRIPLE.exec(headers.get(UPLOAD_SESSION_CSRF_HEADER) ?? "");
  return match ? { configure: match[1]!, mapping: match[2]!, complete: match[3]! } : null;
}
