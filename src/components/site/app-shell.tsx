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
      <aside className="app-rail hidden w-48 shrink-0 flex-col justify-between border-r border-line bg-card px-4 py-8 md:flex lg:w-56">
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
        <header className="flex items-center justify-end gap-3 border-b border-line px-4 py-1 min-[360px]:px-6 md:px-8">
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
              <span className="hidden max-w-64 truncate text-sm text-ink-muted lg:inline">
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
        {/* 24px from 360px up, 16px below it, and the breakpoint is the whole
            point. The brief sets a 24px minimum on the left edge of primary
            content AT 390px (density
            `thresholds.mobile390.primaryContentLeftPaddingPxMin`), and the
            2026-09-14 measurement found all eight authenticated mobile
            surfaces rendering 16px against it (D-119). Raising it everywhere
            failed the OTHER rule, which is measured at 320px: the extra gutter
            narrowed `/genome/[subject]/data/browser` by 16px and pushed that
            page's overflow from 446 CSS px to 454. ADR-0029 settles the
            collision - when accessibility and density conflict the
            accessibility rule wins - and here nothing has to lose, because the
            two rules are measured at different viewports.

            CORRECTED 2026-09-21: this comment called the 446px "igv.js's own
            overflow", and it was not. The sweep named it - `widest: span "Your
            two letters at this spot"` - and it is the genotype figure's
            `sr-only` label, which Tailwind makes `position: absolute`, sitting
            un-clipped at its static position inside the 593px results table
            because the `overflow-x-auto` claim block around it was
            `position: static`. The note above had the evidence already:
            full-bleeding the widget was tried and did not move it, which is
            exactly what you would expect of an overflow the widget does not
            cause. The scrolling claim block is `relative` now and clips it, so
            the page no longer overflows at 320px at all and
            docs/accessibility-divergence.json records no reflow route.

            WHAT THAT DOES NOT SETTLE: whether the 320px carve-out below can go
            now that the overflow it was protecting is gone. That is a
            measurement at 320px with the gutter raised everywhere, not an
            inference from this fix, and it has not been taken.
            The header matches so the account controls stay in line. */}
        <main
          id="main"
          tabIndex={-1}
          className="app-content min-w-0 flex-1 px-4 pt-8 pb-20 focus:outline-none min-[360px]:px-6 md:px-8 md:pb-8 lg:px-12"
        >
          {children}
        </main>
        {/* Phone bottom bar: fixed, so main keeps pb-20 below md to stay clear of it. */}
        <AppNav variant="mobile" />
      </div>
    </div>
  );
}
