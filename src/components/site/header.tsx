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
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <Wordmark />
          <span className="hidden text-[11px] text-ink-muted sm:inline">
            in collaboration with Plus Bio
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
      {/* Mobile nav: the primary links move to a scrollable row below md. */}
      <nav
        aria-label="Main (mobile)"
        className="flex gap-5 overflow-x-auto border-t border-line px-6 py-2 md:hidden"
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
