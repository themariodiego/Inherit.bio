import "server-only";

import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { localAuthDestination } from "./local-destination";
import { PKCE_COOKIE, readSingleCookie, setCookie } from "./auth-cookies";

/**
 * The callback's PKCE state (register auth.callback `queryContract.closed.state`
 * and `policy.PKCE`), for the two flows this server starts itself: sign-up
 * confirmation and password recovery.
 *
 * When `/api/auth/sign-up` or `/api/auth/forgot-password` asks the auth
 * service to send a link, it generates the PKCE verifier and a 256-bit state
 * itself. The state goes into the link's return address; the browser gets a
 * host-only, HttpOnly, SameSite=Lax cookie holding, encrypted, only the
 * state's SHA-256, the verifier, the flow and the return destination. The
 * callback exchanges the code only when the state in the URL hashes to the
 * one in this browser's cookie, with the exact verifier, and deletes the
 * cookie on every answer. A code alone is worth nothing: its verifier never
 * leaves this cookie, and no token is ever put in an Inherit URL.
 *
 * Lax, not Strict: the browser reaches the callback by a top-level GET from
 * the mail link through the auth service, which Lax allows and Strict does
 * not. One hour, the auth service's link lifetime.
 */

export type PkceFlow = "signup" | "recovery";

/** The fixed return destination of each flow; never taken from a request. */
export const PKCE_DESTINATIONS: Readonly<Record<PkceFlow, string>> = {
  signup: "/overview",
  recovery: "/auth/reset-password",
};

const PKCE_SECONDS = 60 * 60;
const PURPOSE = "auth-pkce-state-v1";
const STATE_SHAPE = /^[A-Za-z0-9_-]{43}$/u;
const COOKIE_SHAPE = /^[A-Za-z0-9_-]{40,2048}$/u;

interface SealedFlow {
  p: typeof PURPOSE;
  s: string;
  v: string;
  f: PkceFlow;
  n: string;
  e: number;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export interface NewPkceFlow {
  state: string;
  codeChallenge: string;
  setCookie: string;
}

/** A new flow: the state for the return address, the S256 challenge, and the cookie. */
export function newPkceFlow(flow: PkceFlow, now = Date.now()): NewPkceFlow {
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const sealed: SealedFlow = {
    p: PURPOSE, s: sha256Hex(state), v: verifier, f: flow, n: PKCE_DESTINATIONS[flow], e: now + PKCE_SECONDS * 1000,
  };
  return {
    state,
    codeChallenge: crypto.createHash("sha256").update(verifier, "ascii").digest("base64url"),
    setCookie: setCookie(PKCE_COOKIE, encryptSecret(JSON.stringify(sealed)).toString("base64url"), PKCE_SECONDS, "Lax"),
  };
}

/** The deletion of the cookie, sent with every callback answer that read it. */
export function clearPkceCookie(): string {
  return setCookie(PKCE_COOKIE, "", 0, "Lax");
}

/**
 * The verifier, flow and destination of this browser's flow, when the URL's
 * state hashes to the one the cookie holds and the cookie is still fresh.
 * Null on a missing, repeated, tampered, expired or mismatched cookie.
 */
export function readPkceFlow(request: Request, state: string | null, now = Date.now()):
  { verifier: string; flow: PkceFlow; next: string } | null {
  if (state === null || !STATE_SHAPE.test(state)) return null;
  const raw = readSingleCookie(request, PKCE_COOKIE, COOKIE_SHAPE);
  if (!raw) return null;
  let sealed: SealedFlow;
  try {
    sealed = JSON.parse(decryptSecret(Buffer.from(raw, "base64url"))) as SealedFlow;
  } catch {
    return null;
  }
  if (!sealed || sealed.p !== PURPOSE || typeof sealed.s !== "string" || !/^[0-9a-f]{64}$/u.test(sealed.s)
    || typeof sealed.v !== "string" || !/^[A-Za-z0-9_-]{43,128}$/u.test(sealed.v)
    || (sealed.f !== "signup" && sealed.f !== "recovery")
    || typeof sealed.e !== "number" || !Number.isFinite(sealed.e) || sealed.e <= now) {
    return null;
  }
  const presented = Buffer.from(sha256Hex(state));
  if (!crypto.timingSafeEqual(presented, Buffer.from(sealed.s))) return null;
  // The destination is the flow's own; a sealed value that differs is refused.
  if (sealed.n !== PKCE_DESTINATIONS[sealed.f] || localAuthDestination(sealed.n) !== sealed.n) return null;
  return { verifier: sealed.v, flow: sealed.f, next: sealed.n };
}
