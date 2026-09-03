/**
 * <AppShell> — the signed-in chrome: the five-item side rail, the account
 * header, the one <main> landmark and the phone bottom bar. Extracted from
 * src/app/(app)/layout.tsx so a route outside the (app) group can render the
 * same shell: `/family` serves a public page and a signed-in hub at one
 * path, and Next.js allows one path in one route group only (design §1.2).
 *
 * Server component. It renders chrome only; the account landmark keeps the
 * persistent controls out of the density budget.
 */
import { AppNav } from "@/components/site/app-nav";
import { GlobalSearch } from "@/components/site/global-search";
import { SkipLink } from "@/components/site/skip-link";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Attribution, Wordmark } from "@/components/site/wordmark";
import { Button } from "@/components/ui/button";
import { ACCOUNT_LANDMARK_LABEL } from "@/copy/navigation";

export function AppShell({
  userEmail,
  children,
}: {
  /** Shown in the account landmark; absent when the session carries no address. */
  userEmail?: string | null;
  children: React.ReactNode;
}) {
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
        {/* py-1 around the 44px search button keeps the header at the height
            the 32px account controls gave it (52px), so nothing below moves. */}
        <header className="flex items-center justify-end gap-3 border-b border-line px-4 py-1 md:px-8">
          {/* The global search is page chrome, outside the account landmark:
              its one button counts toward the first-viewport density budget. */}
          <GlobalSearch />
          {/* Persistent chrome lives inside a navigation landmark so density
              budgets (persistent navigation excluded) count page content only. */}
          <nav
            aria-label={ACCOUNT_LANDMARK_LABEL}
            className="ml-auto flex items-center gap-2"
          >
            <ThemeToggle />
            {userEmail ? (
              <span className="hidden text-sm text-ink-muted sm:inline">
                {userEmail}
              </span>
            ) : null}
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
