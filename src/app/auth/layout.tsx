import Link from "next/link";
import { Attribution, Wordmark } from "@/components/site/wordmark";

/**
 * The four auth pages had no landmarks at all: a wordmark, a card and a
 * footer, each a plain `<div>`. Every other layout in the app gives its page
 * a `<main>` (`src/app/(marketing)/layout.tsx`, `src/components/site/app-shell.tsx`),
 * so sign-in, sign-up, forgot-password and reset-password were the four
 * surfaces where a screen-reader user had no way to reach the form except by
 * reading from the top — and they are the four pages every account passes
 * through. Found by widening the axe tag matrix to the set the brief pins
 * (`landmark-one-main` and `region`, four nodes outside any landmark).
 *
 * No skip link here on purpose: the only thing before the form is the
 * wordmark, so a skip control would add a focus stop rather than remove one.
 *
 * The form now reads directly on the page ground. Its column, reserved
 * height and padding stay fixed; removing decorative terrain and the card
 * does not move safety copy into a disclosure or change hydration.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell flex min-h-screen flex-col items-center justify-start gap-8 bg-paper px-6 py-12 md:py-20">
      <header>
        <Wordmark />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="auth-surface surface-pad focus:outline-none"
      >
        {children}
      </main>
      <footer className="flex flex-col items-center gap-2 text-center">
        <Attribution className="caption" />
        <p className="text-sm">
          <Link href="/" className="link-target quiet-link">
            Back to Inherit
          </Link>
        </p>
      </footer>
    </div>
  );
}
