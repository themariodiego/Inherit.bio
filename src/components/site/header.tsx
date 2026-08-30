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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <Wordmark />
          {/* Tagline only when there is genuinely room for one line: at
              200% zoom a typical window is ~640-768 effective px, where
              sm:inline wrapped it into a multi-line sliver. */}
          <span className="hidden text-[11px] whitespace-nowrap text-ink-muted lg:inline">
            created by Plus Bio for the public good
          </span>
        </div>
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {nav.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
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
          wrap rather than scroll so no destination hides off-screen. */}
      <nav
        aria-label="Main (mobile)"
        className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-6 py-2 md:hidden"
      >
        {nav.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="whitespace-nowrap text-sm text-ink-muted hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
