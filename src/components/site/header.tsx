import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";
import { createClient } from "@/lib/supabase/server";

const nav = [
  { href: "/providers", label: "Providers" },
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
      {/* Wraps rather than scrolls. At a 320 CSS px viewport - the brief's
          support floor - the wordmark, the theme toggle and the two auth
          controls need 344px, so every marketing page scrolled sideways by
          24px and failed WCAG 2.1 SC 1.4.10 (measured: 31 routes, all this one
          element). Hiding a control would have fixed the measurement by
          hiding a destination, which is what the mobile nav below already
          refuses to do; wrapping keeps every destination reachable. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <Wordmark />
          {/* Tagline only when there is genuinely room for one line: at
              200% zoom a typical window is ~640-768 effective px, where
              sm:inline wrapped it into a multi-line sliver. */}
          <span className="hidden text-[11px] whitespace-nowrap text-ink-muted lg:inline">
            created by Plus Bio for the public good
          </span>
        </div>
        {/* The md+ twin of the mobile row below, on the same control scale.
            Free here: the row is already 44px tall because of the buttons
            beside it, so `min-h-11` moves nothing. Not measured by the
            390px target-size sweep — this nav is `display:none` at that
            width — but brief line 1053 is not width-scoped, and one nav
            should not be two sizes. */}
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {nav.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex min-h-11 min-w-11 items-center justify-center text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Button asChild size="sm">
              <Link href="/overview">Overview</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/auth/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Mobile nav: the primary links move to a wrapping row below md —
          wrap rather than scroll so no destination hides off-screen.
          This is the phone's primary navigation, so every entry is a full
          44×44 target (`--size-control`, brief line 553; line 1053). Both
          dimensions: "About" is only ~37px of text at 14px, so `min-w-11`
          does the work `min-h-11` cannot. The strip grows from 36px to 60px
          tall below md — the cost of the touch minimum on a row that was
          never big enough to hit. */}
      <nav
        aria-label="Main (mobile)"
        className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-6 py-2 md:hidden"
      >
        {nav.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap text-sm text-ink-muted hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
