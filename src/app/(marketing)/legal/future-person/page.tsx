import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Future Person Charter" };

export default function FuturePersonPage() {
  return <LegalPage eyebrow="Charter" title="The Future Person Charter" effectiveDate="2026-09-01" intro={<section data-legal-summary><p>If an embryo record later becomes a record about you, it is yours. You can obtain it, correct it, stop analysis, or delete it. Inherit will not sell it or use it to rank lives.</p></section>} sections={[
    { id: "rights", heading: "Your six rights", body: <ol>
      <li>The record is yours. When you turn 18, you can ask us for everything we hold about the embryo you came from — every result, and the full record of who agreed to what — free, in a format you can read and a format a scientist can read. We will not include your parents&apos; own DNA results unless they agree separately, because those are also about them.</li>
      <li>You can have it corrected.</li>
      <li>You can have it deleted, completely, and we will do it within 30 days. You do not have to give a reason. Nobody, including your parents, can stop you. We keep one line saying a deletion happened, with no name and no identifier that points back to you.</li>
      <li>You can tell us never to analyse it again, and keep the copy you have.</li>
      <li>We will never sell it, never share it with an insurer, an employer or a school, and never send it to an outside AI company, and never hand it to anyone without a court order we have first tried to resist.</li>
      <li>We keep the record until you are 20. After that, if nobody has claimed it, we delete it — because keeping a genetic record about someone who has never asked for it is worse than losing it. Claim it any time before then, free, at <Link href="/future-person/claim">/future-person/claim</Link>.</li>
    </ol> },
    { id: "scope", heading: "What a claim can include", body: <p>A release can include only the claimed embryo subject&apos;s calls, results, consent and attestation records, audit slice, and provenance. It cannot include another subject&apos;s variant rows.</p> },
    { id: "availability", heading: "Current availability", body: <p>Embryo storage and analysis remain unavailable on the hosted service until jurisdiction-specific human legal review is recorded.</p> },
  ]} />;
}
