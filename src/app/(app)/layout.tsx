import { redirect } from "next/navigation";
import { AppShell } from "@/components/site/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  return <AppShell userEmail={user.email}>{children}</AppShell>;
}
