import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { getCurrentArtifact } from "@/lib/legal/artifacts";

/**
 * D-082: this page used to carry two short hand-written sections while the
 * SIGNED artifact `disclosure.insurance-and-discrimination` carried eight
 * paragraphs. A reader on the public page saw materially less than the person
 * who confirms the same disclosure in the product — the missing half included
 * that GINA does not reach life, disability or long-term-care cover, that a
 * result is information about relatives who never agreed, and that any of
 * them can ask Inherit to stop without holding an account.
 *
 * The page now renders the artifact row, so it cannot differ from the signed
 * text again: there is one copy and this reads it. The integrity section
 * carries the version, the effective date and the body hash, and links to the
 * permanent versioned copy, so a reader can check this page against the
 * record rather than trusting it.
 *
 * If the row is absent the page says so rather than falling back to prose
 * nobody signed, and rather than 404ing a legal URL a reader followed.
 */
const ARTIFACT_KEY = "disclosure.insurance-and-discrimination";

export const metadata: Metadata = { title: "Insurance and discrimination" };

export default async function InsurancePage() {
  const artifact = await getCurrentArtifact(ARTIFACT_KEY);
  if (!artifact) {
    return (
      <LegalPage
        eyebrow="Disclosure"
        title="Insurance and discrimination"
        sections={[{
          id: "unavailable",
          heading: "This disclosure could not be loaded",
          body: (
            <p>
              The signed text of this disclosure is not available right now. It is not
              reproduced here from memory: what this page shows is the artifact record or
              nothing. Its permanent copies stay at{" "}
              <Link href={`/legal/${encodeURIComponent(ARTIFACT_KEY)}`}>the versioned artifact</Link>.
            </p>
          ),
        }]}
      />
    );
  }

  const versionHref = `/legal/${encodeURIComponent(ARTIFACT_KEY)}/versions/${artifact.version}`;
  return (
    <LegalPage
      eyebrow="Disclosure"
      title="Insurance and discrimination"
      effectiveDate={artifact.effective_on}
      version={artifact.version}
      intro={<section data-legal-summary><p className="whitespace-pre-wrap">{artifact.summary_markdown}</p></section>}
      sections={[
        {
          id: "disclosure",
          heading: "The disclosure, in the words that are signed",
          body: <p className="whitespace-pre-wrap">{artifact.body_markdown}</p>,
        },
        {
          id: "integrity",
          heading: "Which version this is",
          body: (
            <>
              <p>
                Version {artifact.version}, effective{" "}
                <time dateTime={artifact.effective_on}>{artifact.effective_on}</time>. This page
                renders the stored artifact rather than a copy of it, so it cannot drift from the
                text a person confirms in the product.
              </p>
              <p className="break-all font-mono text-xs">sha256 {artifact.body_sha256}</p>
              <p><Link href={versionHref}>Permanent link to this version</Link></p>
            </>
          ),
        },
      ]}
    />
  );
}
