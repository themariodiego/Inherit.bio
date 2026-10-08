import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Fraunces carries its optical size and its SOFT warmth, and ships its true
// italic: the display voice of the product, at headline sizes only
// (globals.css `.display`). Inter stays the one text face. No third family,
// no icon font.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

// The italic is its own face so it is not preloaded on every page: only a
// page that sets an accent phrase in italic fetches it, after first paint.
const frauncesItalic = Fraunces({
  variable: "--font-fraunces-italic",
  subsets: ["latin"],
  style: ["italic"],
  axes: ["opsz", "SOFT"],
  display: "swap",
  preload: false,
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Inherit — your genome, on your terms",
    template: "%s · Inherit",
  },
  description:
    "Open-source consumer genomics: find a sequencing provider, upload your raw DNA data, and explore reports, ancestry, and polygenic scores — privately, on infrastructure you can self-host.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${frauncesItalic.variable} ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
