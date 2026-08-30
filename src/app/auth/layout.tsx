import Link from "next/link";
import { Attribution, Wordmark } from "@/components/site/wordmark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 py-12">
      <Wordmark />
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 shadow-sm">
        {children}
      </div>
      <div className="space-y-2 text-center">
        <Attribution />
        <p className="text-xs text-ink-muted">
          <Link href="/" className="underline underline-offset-2">
            Back to Inherit
          </Link>
        </p>
      </div>
    </div>
  );
}
