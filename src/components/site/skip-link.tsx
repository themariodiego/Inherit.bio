"use client";

// Skip link (WCAG 2.4.1 Bypass Blocks): visually hidden until focused, and
// rendered as the FIRST tabbable element in each layout so one Tab press
// reveals it. Targets <main id="main" tabIndex={-1}>.
//
// Client component on purpose: activating the link moves focus to #main
// directly instead of navigating to the #main hash. Hash navigation pushes a
// history entry, and with the app router that entry can rehydrate a stale
// page on Back (skip → open report → Back rendered the old page). Handling
// the click ourselves means no URL change, no history entry, and focus lands
// exactly where the href promises. The href stays "#main" so the element
// remains a real link (correct role, and a sensible fallback if JS has not
// hydrated yet).
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById("main");
        if (main) {
          main.focus();
          main.scrollIntoView();
        }
      }}
      // The target-size sweep measures a control that is 1×1 until focused in
      // the state a person can actually hit it, so the revealed pill is the
      // box that counts: at focus:py-2 it was 36px tall, under the 44px
      // control scale (brief line 553, line 1053). focus:min-h-11 with a flex
      // box centres the label inside 44px; the parked sr-only box is
      // untouched, so nothing about the hidden state changes.
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-forest focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-forest"
    >
      Skip to main content
    </a>
  );
}
