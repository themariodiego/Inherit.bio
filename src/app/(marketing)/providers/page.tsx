import type { Metadata } from "next";
import { ProviderDirectory } from "@/components/providers/directory";
import type { Provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Find a sequencing provider",
  description:
    "Independently verified genome-testing providers: real prices with capture dates, the raw files you actually get back, shipping coverage, and each provider's data practices.",
};

export default async function ProvidersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("providers")
    .select("*")
    .order("name");

  const providers = (data ?? []).map((row) => ({
    ...row,
    products: row.products as never,
    shipping: row.shipping as never,
  })) as unknown as Provider[];

  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Provider directory</p>
        <h1 className="display display-lg">
          Buy sequencing from a <span className="accent">real provider.</span>
        </h1>
        <p className="lede reading-intro">
          Inherit doesn&apos;t sell sequencing — ever. This directory lists
          independently verified providers with their prices as captured on the
          listed date, the raw files they return, and a note on what each does
          with your data. When your results arrive, bring the raw file here.
        </p>
      </header>
      <div className="mt-section">
        {providers.length > 0 ? (
          <ProviderDirectory providers={providers} />
        ) : (
          <p className="surface-dashed surface-pad max-w-measure text-ink-muted">
            The directory has not been seeded on this deployment yet — run{" "}
            <code className="mono rounded-sm bg-tint px-1.5 py-0.5 text-ink">
              pnpm seed
            </code>{" "}
            (see the self-hosting guide).
          </p>
        )}
      </div>
    </div>
  );
}
