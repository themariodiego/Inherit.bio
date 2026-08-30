// Skip link (WCAG 2.4.1 Bypass Blocks): visually hidden until focused, and
// rendered as the FIRST tabbable element in each layout so one Tab press
// reveals it. Targets <main id="main" tabIndex={-1}> so focus actually moves.
// Server component — no client JS.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-forest focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-forest"
    >
      Skip to main content
    </a>
  );
}
