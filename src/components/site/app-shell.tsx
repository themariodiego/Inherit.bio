/**
 * <AppShell> — the signed-in chrome: the five-item side rail, the account
 * header, the one <main> landmark and the phone bottom bar. Extracted from
 * src/app/(app)/layout.tsx so a route outside the (app) group can render the
 * same shell: `/family` serves a public page and a signed-in hub at one
 * path, and Next.js allows one path in one route group only (design §1.2).
 *
 * Server component. It renders chrome only; the account landmark keeps the
 * persistent controls out of the density budget.
 *
 * Composition (2026-10 renewal): a card-ground rail with a hairline (13rem at
 * md, 15rem at lg), a 64px toolbar on paper, and the page on paper. The skip
 * link stays the first tabbable element; `main#main` keeps tabIndex -1 and
 * the `app-content` class the partials read.
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
      <aside className="app-rail hidden shrink-0 flex-col justify-between border-r border-line bg-card px-4 py-6 md:flex md:w-52 lg:w-60">
        <AppNav
          variant="sidebar"
          leading={
            <div data-slot="wordmark" className="px-3">
              <Wordmark className="text-xl" />
            </div>
          }
        />
        <div className="px-3">
          <Attribution className="caption" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The toolbar: 64px on paper with a hairline. Its gutters match
            main's so the controls sit on the content's left edge. */}
        <header className="flex h-navbar shrink-0 items-center gap-3 border-b border-line bg-paper px-4 min-[360px]:px-6 md:px-8 lg:px-12">
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
              // 12px of its own before "Sign out": the address is text, and 8px
              // put it at the controls' separation floor at 1024 (round-3 R8).
              <span className="mr-3 hidden max-w-64 truncate text-sm text-ink-muted lg:inline">
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
        {/* 24px from 360px up, 16px below it: the brief sets a 24px minimum
            on the left edge of primary content at 390px (density
            `thresholds.mobile390.primaryContentLeftPaddingPxMin`), and the
            320px reflow rule is measured at 320px, where 16px keeps the
            narrowest surfaces from overflowing (ADR-0029; D-119). Below md
            the bottom padding comes from globals.css (`.app-content`) so the
            fixed bottom bar never covers the last block. */}
        <main
          id="main"
          tabIndex={-1}
          className="app-content min-w-0 flex-1 px-4 pt-8 pb-12 focus:outline-none min-[360px]:px-6 md:px-8 md:pt-12 md:pb-16 lg:px-12"
        >
          {children}
        </main>
        {/* Phone bottom bar: fixed; main stays clear of it below md. */}
        <AppNav variant="mobile" />
      </div>
    </div>
  );
}
