"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

// Icon swap is CSS-driven (dark: variant), so both icons render on the
// server and the client hides one — no mounted flag, no hydration mismatch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun aria-hidden className="hidden dark:block" />
      <Moon aria-hidden className="block dark:hidden" />
    </Button>
  );
}
