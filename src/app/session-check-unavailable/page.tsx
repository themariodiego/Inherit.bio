import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  AUTH_UNAVAILABLE_HEADER,
  AuthServiceUnavailableError,
} from "@/lib/supabase/auth-check";

/**
 * Never linked. The proxy rewrites a page navigation here when the sign-in
 * check failed for a moment twice (owner decision 2026-11-19, D-142), so the
 * person stays on the URL they asked for. Throwing hands the request to the
 * root `error.tsx`, the existing "This page did not load" surface, whose "Try
 * again" asks the server for that URL again. Nothing here reads a session,
 * a cookie or a row.
 *
 * A proxy rewrite does not pass through the proxy again, so only the proxy's
 * own rewrite carries the marker: the proxy removes it from any request that
 * names this path, and such a visit is answered not-found like any other
 * unknown address.
 */
export default async function SessionCheckUnavailablePage(): Promise<never> {
  if ((await headers()).get(AUTH_UNAVAILABLE_HEADER) !== "1") notFound();
  throw new AuthServiceUnavailableError();
}
