import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { SkipLink } from "@/components/site/skip-link";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
