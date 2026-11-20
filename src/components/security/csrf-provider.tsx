"use client";

import { createContext, useContext, useMemo } from "react";
import { csrfHandle, type CsrfHandle } from "@/lib/security/session-csrf-client";
import type { CsrfRoute } from "@/lib/security/session-csrf-core";

/**
 * The tokens a page or layout rendered, one per route
 * (`src/lib/security/session-csrf.ts`). A nested provider adds to the one
 * around it, so the signed-in shell's tokens stay reachable inside a page
 * that renders its own.
 */

type Tokens = Readonly<Partial<Record<CsrfRoute, string>>>;
const CsrfTokens = createContext<Tokens>({});

export function CsrfProvider({ tokens, children }: { tokens: Tokens; children: React.ReactNode }) {
  const outer = useContext(CsrfTokens);
  const merged = useMemo(() => ({ ...outer, ...tokens }), [outer, tokens]);
  return <CsrfTokens.Provider value={merged}>{children}</CsrfTokens.Provider>;
}

/** The token handle for one route; it sends nothing valid when no provider rendered that route. */
export function useCsrf(route: CsrfRoute): CsrfHandle {
  const rendered = useContext(CsrfTokens)[route];
  return useMemo(() => csrfHandle(rendered), [rendered]);
}
