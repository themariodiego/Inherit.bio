import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { EMBARGOED_COUNTRY_CODES, PAUSED_COUNTRY_CODES } from "@/lib/legal/service-restrictions";

export const metadata: Metadata = { title: "Where Inherit works" };

/** Country names in one fixed language, sorted for reading, from the lists the product enforces. */
function countryNames(codes: readonly string[]): string {
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
  return codes
    .map((code) => names.of(code) ?? code)
    .sort((a, b) => a.localeCompare(b, "en"))
    .join(", ");
}

export default function AvailabilityPage() {
  return <LegalPage eyebrow="Policy" title="Where Inherit works" effectiveDate="2026-09-26" intro={<p>My Genome is available for an adult&apos;s own data, except in the places listed below. Family and Embryo Analysis are off until a real jurisdiction has a current human legal review.</p>} sections={[
    { id: "current", heading: "Current production state", body: <p>No real jurisdiction is marked permitted for Family or Embryo Analysis. Unknown or conflicting jurisdiction signals always deny those capabilities.</p> },
    { id: "not-served", heading: "Places Inherit does not serve", body: <>
      <p>Inherit does not serve people who live in {countryNames(EMBARGOED_COUNTRY_CODES)}. It also does not serve Crimea, Sevastopol, or the Donetsk and Luhansk regions of Ukraine. United States sanctions law forbids it.</p>
      <p>Nobody can choose these countries as where they live. Connections that our hosting provider locates in any of them are refused. The place comes from the connection&apos;s internet address. Inherit uses it only for this check and does not store it.</p>
    </> },
    { id: "paused", heading: "Countries not open to new people", body: <>
      <p>The hosted service is not taking new people from these countries: {countryNames(PAUSED_COUNTRY_CODES)}.</p>
      <p>Some are paused while the law there is reviewed. The EU, the rest of the EEA, the UK and Switzerland wait for the representatives the <Link href="/legal/gdpr">GDPR status page</Link> names. If you already chose one of these countries, nothing changes for you. Nobody can newly choose one, including when changing an earlier answer.</p>
    </> },
    { id: "change", heading: "How availability changes", body: <p>A capability can be enabled only by a versioned jurisdiction rule backed by a current citation and a human legal sign-off. Automated systems cannot create that sign-off.</p> },
  ]} />;
}
