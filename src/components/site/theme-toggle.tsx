"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// Icon swap is CSS-driven (dark: variant), so both icons render on the
// server and the client hides one — no mounted flag, no hydration mismatch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The icon's turn (globals `.theme-toggle[data-turned] svg`) runs only after
  // a toggle, never on load: `turns` keys the icons so each click remounts
  // them and the keyframe plays once.
  const [turns, setTurns] = useState(0);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="theme-toggle"
      aria-label="Toggle light and dark theme"
      data-turned={turns > 0 ? "" : undefined}
      onClick={() => {
        setTurns((n) => n + 1);
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }}
    >
      <Sun key={`sun-${turns}`} aria-hidden className="hidden dark:block" />
      <Moon key={`moon-${turns}`} aria-hidden className="block dark:hidden" />
    </Button>
  );
}
