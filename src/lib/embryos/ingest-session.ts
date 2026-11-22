import "server-only";

import { createHash } from "node:crypto";
import { uploadSessionCsrfValue } from "@/lib/security/opened-session-csrf";
import { mintSessionCsrf } from "@/lib/security/session-csrf-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function isIngestSessionId(value: string): boolean {
  return UUID.test(value);
}

/** A separate cookie for each of the two permitted concurrent attempts. */
export function ingestCookieName(session: string, secure = process.env.NODE_ENV === "production"): string {
  if (!isIngestSessionId(session)) throw new Error("invalid ingest session");
  return `${secure ? "__Host-" : ""}inherit-ingest-${session}`;
}

/** Fixed absolute expiry from the mint transaction; reads never refresh it. */
export function ingestCookie(session: string, secret: string, expiresAt: Date, secure = process.env.NODE_ENV === "production"): string {
  if (!SECRET.test(secret) || !Number.isFinite(expiresAt.getTime())) throw new Error("invalid ingest cookie");
  const attributes = [
    `${ingestCookieName(session, secure)}=${secret}`, "Path=/", `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly", "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * The `X-Inherit-Upload-CSRF` value of the answer that opens the session
 * (api.embryo-cohorts' 201; G8.5, the migration stage): the first one-time
 * `X-Inherit-CSRF` token of each of the session's three token routes, bound
 * to this session id and this cookie's hash
 * (`src/lib/security/opened-session-csrf.ts`). The opening answer's own
 * `X-Inherit-CSRF` carries api.embryo-cohorts' successor.
 */
export function uploadSessionCsrf(session: string, secret: string): string {
  if (!isIngestSessionId(session) || !SECRET.test(secret)) throw new Error("invalid ingest session");
  const bound = { kind: "upload-session", sessionId: session,
    sessionHash: createHash("sha256").update(secret, "utf8").digest("hex") } as const;
  return uploadSessionCsrfValue({
    configure: mintSessionCsrf(bound, "api.embryo-ingest-configure"),
    mapping: mintSessionCsrf(bound, "api.embryo-ingest-mapping"),
    complete: mintSessionCsrf(bound, "api.embryo-ingest-complete"),
  });
}

/** Reject duplicate names rather than relying on browser/proxy ordering. */
export function readIngestCookieHash(request: Request, session: string, secure = process.env.NODE_ENV === "production"): string | null {
  if (!isIngestSessionId(session)) return null;
  const name = ingestCookieName(session, secure);
  const values = (request.headers.get("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name ? [part.slice(separator + 1).trim()] : [];
  });
  if (values.length !== 1 || !SECRET.test(values[0])) return null;
  return createHash("sha256").update(values[0], "utf8").digest("hex");
}
