import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "About Sequence & the Plus Bio collaboration",
  description:
    "What Sequence is, what it will never do, its AGPL-3.0 license, and exactly how the Plus Bio collaboration works — shared design language, zero shared data.",
};

export default function AboutPage() {
  return (
    <LegalPage
      eyebrow="Company"
      title={
        <>
          About <span className="accent">Sequence.</span>
        </>
      }
      intro={
        <p>
          Sequence is an open-source consumer genomics platform. It helps you
          buy whole-genome or exome sequencing from an independent provider,
          then turns the raw file you get back into reports, ancestry
          estimates, and polygenic scores — on infrastructure you can read,
          audit, and run yourself.
        </p>
      }
      sections={[
        {
          id: "what-sequence-is",
          heading: "What Sequence is",
          body: (
            <>
              <p>
                Most consumer genomics companies sell you a test, keep your
                data on their servers, and make their real money elsewhere.
                Sequence inverts that model. We do not sell sequencing at all:
                our provider directory routes you to real laboratories, you pay
                them directly, and no money passes through us. You then upload
                the raw file — a 23andMe, AncestryDNA, MyHeritage, or
                FamilyTreeDNA export, a VCF, or a BAM/CRAM — and Sequence
                interprets it for you.
              </p>
              <p>
                Every report states its evidence level, cites its sources, and
                says plainly when your file does not cover a variant. Sequence
                is informational, not a medical device: it does not diagnose,
                treat, or prevent any disease, and it is not a substitute for a
                physician or a genetic counselor.
              </p>
            </>
          ),
        },
        {
          id: "what-we-will-never-do",
          heading: "What we will never do",
          body: (
            <>
              <ul>
                <li>
                  <strong>We never sell sequencing.</strong> Providers are
                  listed with their real prices, depth, and turnaround. You buy
                  from them directly; Sequence takes no commission, referral
                  fee, or cut of any kind.
                </li>
                <li>
                  <strong>We never sell or share your data.</strong> Your
                  genome is not an asset on our balance sheet. There is no
                  research-partner pipeline, no pharma licensing program, and
                  no advertising business. See the{" "}
                  <Link href="/privacy">privacy policy</Link> for the full
                  commitments, including what happens in a change of control.
                </li>
                <li>
                  <strong>We never run third-party trackers.</strong> Zero ad
                  pixels, zero third-party analytics. An automated network
                  audit in our continuous-integration pipeline fails the build
                  if any tracker appears.
                </li>
                <li>
                  <strong>Export is free, forever.</strong> Everything you
                  upload and everything we derive from it can be downloaded at
                  any time at no charge, and deletion actually deletes — rows
                  and storage objects, immediately.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "open-source",
          heading: "Open source, AGPL-3.0",
          body: (
            <>
              <p>
                The entire Sequence codebase is published under the GNU Affero
                General Public License, version 3.0 (AGPL-3.0) at{" "}
                <a
                  href="https://github.com/themariodiego/sequence"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/themariodiego/sequence
                </a>
                . That license choice is deliberate: anyone who runs Sequence
                as a service — including us — must publish their modifications.
                You can read exactly how your file is parsed, how reports are
                generated, and what leaves the server (nothing, unless you ask
                it to).
              </p>
              <p>
                Because the code is open, our privacy promises are not just
                policy — they are structural. If Sequence the company ever
                disappointed you, you could take the code, your exported data,
                and self-host the whole platform. That exit path is documented
                at <Link href="/docs/self-hosting">/docs/self-hosting</Link>.
              </p>
            </>
          ),
        },
        {
          id: "plus-bio",
          heading: "The Plus Bio collaboration",
          body: (
            <>
              <p>
                Sequence is an <strong>independent, separate service</strong>{" "}
                built in collaboration with Plus Bio. The collaboration covers
                design only: Sequence uses a shared visual design language —
                typography, color, and layout conventions — developed with the
                Plus Bio team. That is the full extent of it.
              </p>
              <ul>
                <li>
                  Sequence is <strong>not a Plus Bio product</strong>, not a
                  subsidiary, and not operated by Plus Bio.
                </li>
                <li>
                  Sequence runs on a <strong>separate domain</strong> with{" "}
                  <strong>separate accounts</strong>. There is no single
                  sign-on between Sequence and any Plus Bio service, and no
                  shared login infrastructure.
                </li>
                <li>
                  <strong>
                    No personal, health, or genetic data flows between Sequence
                    and any Plus Bio service, in either direction.
                  </strong>{" "}
                  Not uploads, not derived variants, not reports, not account
                  details, not usage events. The systems are not connected.
                </li>
              </ul>
              <p>
                This separation is restated, with the same guarantees, in the{" "}
                <Link href="/privacy">privacy policy</Link>, where it is a
                binding commitment rather than a description.
              </p>
            </>
          ),
        },
        {
          id: "contact",
          heading: "Contact",
          body: (
            <>
              <p>
                General questions: <strong>hello@sequence-dna.org</strong>.
                Privacy and data-rights requests:{" "}
                <strong>privacy@sequence-dna.org</strong>. Security reports:{" "}
                <strong>security@sequence-dna.org</strong>. Bugs and feature
                requests are best filed as issues on the public repository.
              </p>
              <p>
                Sequence is informational only — not medical advice and not a
                diagnostic service. If you have questions about your health,
                talk to a physician or a licensed genetic counselor.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
