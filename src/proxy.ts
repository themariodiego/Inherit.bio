import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCATION_UNAVAILABLE_BODY, LOCATION_UNAVAILABLE_TITLE } from "@/copy/availability";
import { isEmbargoedCountry, isEmbargoedLocation } from "@/lib/legal/service-restrictions";

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

/**
 * The rights an account keeps whatever else blocks it: export, deletion and
 * its cancellation, consent withdrawal, and handing a record on.
 */
function isRightsEndpoint(path: string): boolean {
  return path === "/api/export" ||
    path === "/api/account/delete" ||
    path === "/api/account/delete/cancel" ||
    (path.startsWith("/api/consents/") && path.endsWith("/revoke")) ||
    path.startsWith("/api/subjects/transfer");
}

/**
 * The answer to a connection the hosting provider locates in a place under a
 * comprehensive US embargo (`service-restrictions.ts`): 451, with nothing
 * that needs a further request, and never cached.
 */
function locationUnavailable(path: string): NextResponse {
  const response = path.startsWith("/api/")
    ? NextResponse.json({ error: "not_available_in_location" }, { status: 451 })
    : new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<title>${LOCATION_UNAVAILABLE_TITLE}</title></head><body><main>` +
          `<h1>${LOCATION_UNAVAILABLE_TITLE}</h1><p>${LOCATION_UNAVAILABLE_BODY}</p>` +
          `</main></body></html>`,
        { status: 451, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
  return withSensitiveHeaders(response);
}

// Next.js 16 proxy (successor to middleware): keeps the Supabase auth session
// fresh and gates the authenticated app shell.
export async function proxy(request: NextRequest) {
  // Sanctions come before everything else, sign-in included. Vercel sets
  // these headers from the connection's address and overwrites any a client
  // sends; nothing here stores them. Without them (a local run) nothing is
  // refused.
  if (isEmbargoedLocation(
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("x-vercel-ip-country-region"),
  )) {
    return locationUnavailable(request.nextUrl.pathname);
  }

  // This generic document must not look up an account or an invitation.
  // Its handler sets its own nonce CSP and non-authorizing candidate cookie.
  if (request.nextUrl.pathname === "/withdraw/request") {
    return NextResponse.next({ request });
  }
  // These rights operations use their own browser-bound credentials, not the
  // signed-in account. An unrelated account's deletion notice must not block
  // the recipient from declining an invitation.
  if (request.nextUrl.pathname === "/api/rights/activate"
    || request.nextUrl.pathname === "/api/withdraw/session") {
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
      .select("deletion_requested_at, jurisdiction_code")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.deletion_requested_at) {
      if (path.startsWith("/api/") && !isRightsEndpoint(path)) {
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

    // An account that declared a country under a comprehensive US embargo
    // keeps its rights and may correct its answer; nothing else is served.
    // Settings says why and holds both.
    if (profile && isEmbargoedCountry(profile.jurisdiction_code)) {
      if (path.startsWith("/api/") && !isRightsEndpoint(path) && path !== "/api/settings/jurisdiction") {
        return withSensitiveHeaders(
          NextResponse.json({ error: "not_available_in_jurisdiction" }, { status: 451 }),
        );
      }
      if (isProtected && !path.startsWith("/settings")) {
        return withSensitiveHeaders(NextResponse.redirect(new URL("/settings", request.url)));
      }
    }

    // G5.1a: where a person lives is declared once, at first sign-in, before
    // any product page. Settings stay open: the declaration is made there, and
    // export, deletion and consent withdrawal are rights nothing may block.
    // Endpoints are not redirected; each one already resolves an undeclared
    // account's restricted capabilities as unreviewed on the server.
    if (isProtected && profile && profile.jurisdiction_code === null && !path.startsWith("/settings")) {
      // A fresh URL, not a clone: a clone of `/family/` keeps its trailing slash.
      const url = new URL("/settings", request.url);
      url.searchParams.set("next", `${path}${request.nextUrl.search}`);
      return withSensitiveHeaders(NextResponse.redirect(url));
    }
  }

  return sensitive ? withSensitiveHeaders(response) : response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
