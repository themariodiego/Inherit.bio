import { redirect } from "next/navigation";
import { AppShell } from "@/components/site/app-shell";
import { accountCsrfTokens } from "@/lib/security/session-csrf";
import { userForPage } from "@/lib/supabase/auth-check";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // A sign-in check that failed for a moment twice throws, and the root
  // error.tsx renders the error surface rather than the sign-in page.
  const user = await userForPage(supabase.auth);
  if (!user) redirect("/auth/sign-in");

  return <AppShell userEmail={user.email} csrf={await accountCsrfTokens()}>{children}</AppShell>;
}
