import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Fraunces carries its optical size (the one axis a display face needs; the
// SOFT axis doubled the file for a warmth no reader could name) and is the
// display voice of the product, at headline sizes only (globals.css
// `.display`). Inter stays the one text face. No third family, no icon font.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

// The italic accent ("on your terms.") is its own face, self-hosted from the
// Google Fonts build of Fraunces Italic (SIL Open Font License) subset to
// lower-case letters and sentence punctuation — 26 KB instead of 82 — and
// never preloaded: only a page that sets an accent phrase fetches it. An
// accent phrase is lower case by design; a capital falls through to the
// upright face and would show, so widen the subset before setting one.
const frauncesItalic = localFont({
  src: "./fonts/fraunces-italic-accent.woff2",
  variable: "--font-fraunces-italic",
  style: "italic",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
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
