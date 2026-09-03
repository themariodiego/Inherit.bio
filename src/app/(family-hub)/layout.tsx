/**
 * The `/family` route group (design §1.2). The domain landing is one path
 * with two audiences: the register declares it `public-or-authenticated`
 * with two panels that must render before any sign-in wall, and Next.js
 * forbids the same path in two route groups. So the path lives here and the
 * layout chooses the chrome:
 *   - signed in → the app shell, identical to the (app) group's;
 *   - signed out → the marketing header, footer and skip link, identical to
 *     the (marketing) group's.
 * No redirect, no second route: the sign-in state changes the chrome around
 * one page, never the page's own required panels.
 */
import { AppShell } from "@/components/site/app-shell";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { SkipLink } from "@/components/site/skip-link";
import { createClient } from "@/lib/supabase/server";

export default async function FamilyHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return <AppShell userEmail={user.email}>{children}</AppShell>;

  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
