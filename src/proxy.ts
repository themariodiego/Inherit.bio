import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Response headers every page or endpoint that can read or write user,
 * subject, consent, chat, file or derived data must carry (route register
 * `sensitiveResponseHeaders.authenticatedUserData`): nothing user-derived may
 * be cached by the browser, a CDN or a shared cache, and no such response may
 * be framed. Redirects on those paths carry the same set.
 */
export const SENSITIVE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

function withSensitiveHeaders<T extends NextResponse>(response: T): T {
  for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

// Next.js 16 proxy (successor to middleware): keeps the Supabase auth session
// fresh and gates the authenticated app shell.
export async function proxy(request: NextRequest) {
  // This generic document must not look up an account or an invitation.
  // Its handler sets its own nonce CSP and non-authorizing candidate cookie.
  if (request.nextUrl.pathname === "/withdraw/request") {
    return NextResponse.next({ request });
  }
  // Activation is authorized solely by its candidate + one-time credential,
  // not by whichever account happens to be signed in on this browser.
  if (request.nextUrl.pathname === "/api/rights/activate") {
    return withSensitiveHeaders(NextResponse.next({ request }));
  }
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser: a stale session
  // could be committed to cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith("/overview") ||
    path.startsWith("/genome") ||
    path.startsWith("/family/") ||
    path.startsWith("/embryos") ||
    path.startsWith("/copilot") ||
    path.startsWith("/files") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/uploads") ||
    path.startsWith("/reports") ||
    path.startsWith("/browse") ||
    path.startsWith("/ancestry") ||
    path.startsWith("/chat") ||
    path.startsWith("/settings");

  const sensitive = isProtected || path.startsWith("/api/") || path.startsWith("/withdraw/");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", path);
    return withSensitiveHeaders(NextResponse.redirect(url));
  }

  if (user && (isProtected || path.startsWith("/api/"))) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("deletion_requested_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.deletion_requested_at) {
      const allowedApi =
        path === "/api/export" ||
        path === "/api/account/delete" ||
        path === "/api/account/delete/cancel" ||
        (path.startsWith("/api/consents/") && path.endsWith("/revoke")) ||
        path.startsWith("/api/subjects/transfer");

      if (path.startsWith("/api/") && !allowedApi) {
        return withSensitiveHeaders(
          NextResponse.json(
            { error: "account_deletion_notice_period" },
            { status: 423 },
          ),
        );
      }
      if (isProtected && path !== "/settings/data") {
        const url = request.nextUrl.clone();
        url.pathname = "/settings/data";
        url.search = "";
        return withSensitiveHeaders(NextResponse.redirect(url));
      }
    }
  }

  return sensitive ? withSensitiveHeaders(response) : response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
