import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteNavLink } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";
import { createClient } from "@/lib/supabase/server";
import { route } from "@/lib/primary-routes";

const nav = [
  { href: route("marketing.providers"), label: "Providers" },
  { href: "/about", label: "About" },
  { href: "/changelog", label: "Changelog" },
];

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    // Solid bg-paper (not /90 + blur): content scrolling under the sticky
    // header must never bleed through, especially at high zoom levels.
    <header className="sticky top-0 z-40 border-b border-line bg-paper">
      {/* One 64px row (--size-navbar). From md it is a three-track grid so
          the nav sits on the true centre; below md the row holds the
          wordmark, the theme toggle and the one primary pill (the quiet
          sign-in moves to the nav row), and it still wraps rather than
          scrolls at high zoom so no destination hides (WCAG 2.1 SC 1.4.10).
          The side tracks are minmax(max-content, 1fr), not a bare 1fr: a bare
          1fr pair is sized from the leftover space alone, and at 768 that
          left the control cluster (toggle, sign-in, pill: 259px) a 230px
          track, so the pill ran 6px past the viewport. With the content
          floor the two tracks stay equal, and the nav centred, from about
          830px, and below that the wordmark side gives way first. */}
      <div className="site-header-row mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2 md:grid md:grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)]">
        <div className="flex items-baseline gap-3">
          <Wordmark />
          {/* Tagline only when there is genuinely room for one line: at
              200% zoom a typical window is ~640-768 effective px, where
              sm:inline wrapped it into a multi-line sliver. */}
          <span className="hidden text-xs whitespace-nowrap text-ink-muted xl:inline">
            created by Plus Bio for the public good
          </span>
        </div>
        {/* The md+ twin of the mobile row below, on the same control scale:
            every entry is a 44×44 target with 8px or more between them. Each
            entry marks the current route (aria-current, underlined). */}
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {nav.map((l) => (
            <SiteNavLink
              key={l.href}
              href={l.href}
              className="site-nav-link flex min-h-11 min-w-11 items-center justify-center text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {l.label}
            </SiteNavLink>
          ))}
        </nav>
        {/* 12px between the toggle and the pill: clear of the 8px floor at 320. */}
        <div className="flex items-center gap-3 md:justify-self-end">
          <ThemeToggle />
          {user ? (
            <Button asChild size="sm">
              <Link href={route("app.overview")}>Overview</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                <Link href={route("auth.sign-in")}>Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/auth/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Mobile row: the primary links move to a wrapping row below md —
          wrap rather than scroll so no destination hides off-screen. This is
          the phone's primary navigation, so every entry is a full 44×44
          target: "About" is only ~37px of text at 14px, so `min-w-11` does
          the work `min-h-11` cannot. The quiet sign-in sits at the row's
          end, outside the nav, so the first row keeps to one line at 320. */}
      <div className="site-header-nav-row flex items-center justify-between gap-3 border-t border-line px-6 md:hidden">
        <nav
          aria-label="Main (mobile)"
          className="flex flex-wrap gap-x-3 gap-y-1 min-[360px]:gap-x-5"
        >
          {nav.map((l) => (
            <SiteNavLink
              key={l.href}
              href={l.href}
              className="site-nav-link flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap text-sm text-ink-muted hover:text-ink"
            >
              {l.label}
            </SiteNavLink>
          ))}
        </nav>
        {user ? null : (
          <Link
            href={route("auth.sign-in")}
            className="site-nav-link flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium text-ink"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
