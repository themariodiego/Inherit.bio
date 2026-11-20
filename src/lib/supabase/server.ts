import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { userAnswerFetch, type UserAnswers } from "./auth-check";

/**
 * The questions to the auth service this render has asked (React's `cache`
 * is scoped to one request's render; outside a render each call is a fresh
 * map). See `userAnswerFetch` for why Next's own memo is not used for them.
 */
const answersOfThisRender = cache((): UserAnswers => new Map());
const authFetch = userAnswerFetch(answersOfThisRender);

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: session refresh is handled by proxy.ts.
          }
        },
      },
      global: { fetch: authFetch },
    },
  );
}
