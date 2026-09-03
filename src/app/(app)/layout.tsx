import { redirect } from "next/navigation";
import { AppNav } from "@/components/site/app-nav";
import { SkipLink } from "@/components/site/skip-link";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Attribution, Wordmark } from "@/components/site/wordmark";
import { Button } from "@/components/ui/button";
import { ACCOUNT_LANDMARK_LABEL } from "@/copy/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  return (
    <div className="flex min-h-screen flex-1">
      <SkipLink />
      <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-line bg-card px-4 py-6 md:flex">
        <AppNav
          variant="sidebar"
          leading={<Wordmark className="px-2 text-xl" />}
        />
        <div className="px-2">
          <Attribution />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-line px-4 py-2.5 md:px-8">
          {/* Persistent chrome lives inside a navigation landmark so density
              budgets (persistent navigation excluded) count page content only. */}
          <nav
            aria-label={ACCOUNT_LANDMARK_LABEL}
            className="ml-auto flex items-center gap-2"
          >
            <ThemeToggle />
            <span className="hidden text-sm text-ink-muted sm:inline">
              {user.email}
            </span>
            <form action="/auth/sign-out" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </nav>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pt-8 pb-20 focus:outline-none md:px-8 md:pb-8"
        >
          {children}
        </main>
        {/* Phone bottom bar: fixed, so main keeps pb-20 below md to stay clear of it. */}
        <AppNav variant="mobile" />
      </div>
    </div>
  );
}
