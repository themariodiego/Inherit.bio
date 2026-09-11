import { Attribution, Wordmark } from "@/components/site/wordmark";
import { NotFoundContent } from "@/components/site/not-found-content";

/**
 * The 404 for a URL that matches no route at all, which renders under the root
 * layout — and the root layout carries no chrome, so this boundary supplies the
 * landmarks itself, in the shape `src/app/auth/layout.tsx` was corrected to
 * after the axe matrix found four nodes outside any landmark there.
 *
 * The per-group boundaries (`(app)`, `(marketing)`) render `NotFoundContent`
 * alone, because their layouts already provide the one `<main>`. See that
 * component for why splitting them was necessary rather than tidy.
 *
 * Deliberately session-independent. `SiteHeader` reads `auth.getUser()`, and
 * brief line 477 makes a 404 the required response to a **revoked** request, so
 * a page that looked different to a signed-in reader would leak by its shape
 * the very thing the status code is there to withhold.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 py-12">
      <header>
        <Wordmark />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="w-full max-w-prose rounded-2xl border border-line bg-card shadow-sm focus:outline-none"
      >
        <NotFoundContent />
      </main>
      <footer className="space-y-2 text-center">
        <Attribution />
      </footer>
    </div>
  );
}
