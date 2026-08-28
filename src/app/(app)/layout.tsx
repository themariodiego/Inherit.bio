import Link from "next/link";
import { redirect } from "next/navigation";
import { Attribution, Wordmark } from "@/components/site/wordmark";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/uploads", label: "My files" },
  { href: "/reports", label: "Reports" },
  { href: "/browse", label: "Browse genome" },
  { href: "/ancestry", label: "Ancestry" },
  { href: "/chat", label: "Copilot" },
  { href: "/settings", label: "Settings" },
];

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
      <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-line bg-card px-4 py-6 md:flex">
        <div className="space-y-8">
          <Wordmark className="px-2 text-xl" />
          <nav aria-label="App" className="flex flex-col gap-1">
            {nav.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="space-y-4 px-2">
          <p className="text-xs text-ink-muted">
            Informational, not medical advice.
          </p>
          <Attribution />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 md:px-8">
          <nav aria-label="App (mobile)" className="flex gap-3 overflow-x-auto md:hidden">
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
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden text-sm text-ink-muted sm:inline">
              {user.email}
            </span>
            <form action="/auth/sign-out" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
