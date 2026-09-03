import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "About Inherit & the Plus Bio relationship",
  description:
    "What Inherit is, what it will never do, its AGPL-3.0 license, and exactly how it relates to Plus Bio — created by Plus Bio, legally separate, zero shared data.",
};

export default function AboutPage() {
  return (
    <LegalPage
      eyebrow="Company"
      title={
        <>
          About <span className="accent">Inherit.</span>
        </>
      }
      intro={
        <p>
          Inherit is open-source software for people who want to explore their
          DNA. It helps you buy whole-genome or exome sequencing from an
          independent lab. You can turn the raw file into reports, ancestry
          estimates, and polygenic scores. You can inspect the system or run it
          yourself.
        </p>
      }
      sections={[
        {
          id: "what-sequence-is",
          heading: "What Inherit is",
          body: (
            <>
              <p>
                Many DNA companies sell a test and keep your data on their
                servers. Inherit works another way. We do not sell tests. Our
                provider list sends you to independent labs, which you pay
                directly. Some links may earn Inherit a commission, which we
                show beside the link. You can upload a file from 23andMe,
                AncestryDNA, MyHeritage, or FamilyTreeDNA. You can also add a
                VCF, BAM, or CRAM file. Inherit reads the file for you.
              </p>
              <p>
                Each report shows its evidence, sources, and any variant your
                file could not read. Inherit gives information, not medical
                care. It does not diagnose, treat, or prevent disease. It cannot
                replace a doctor or genetic counselor.
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
                  listed with their prices, depth, and turnaround. You buy from
                  them directly. Some provider links are affiliate links. We
                  label each one and may earn a commission if you use it. Your
                  price does not change.
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
                  <strong>We never use outside trackers.</strong> There are no
                  ad pixels or outside analytics. An automated network check
                  fails the build if it finds a tracker.
                </li>
                <li>
                  <strong>You can always export for free.</strong> The export
                  includes all uploads and results. When a deletion is due,
                  Inherit removes its database rows and stored files.
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
                All Inherit code is available under the GNU Affero General
                Public License, version 3.0 (AGPL-3.0), at{" "}
                <a
                  href="https://github.com/themariodiego/Inherit.bio"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/themariodiego/Inherit.bio
                </a>
                . The license requires anyone who runs a changed copy as a
                service to publish those changes. You can inspect how Inherit
                reads files, builds reports, and sends data. It sends nothing
                outside the service unless you ask.
              </p>
              <p>
                Open code makes our privacy promises part of the design, not
                just a policy. If the Inherit company let you down, you could
                export your data, copy the code, and run it yourself. Read the{" "}
                <Link href="/legal/self-hosting">self-hosting guide</Link>.
              </p>
            </>
          ),
        },
        {
          id: "plus-bio",
          heading: "Created by Plus Bio, legally separate",
          body: (
            <>
              <p>
                <strong>Plus Bio created Inherit.</strong> Its team built the
                software, shared its design, and released the code for the
                public good. Inherit is a <strong>separate legal entity</strong>,
                not a Plus Bio product line. It has its own domain, accounts,
                and duties to you.
              </p>
              <ul>
                <li>
                  <strong>Why separate?</strong> Genetic data should never sit
                  on a commercial balance sheet. The legal separation means
                  your genome is not an asset of Plus Bio&rsquo;s business — in
                  an acquisition, an audit, or a lawsuit involving Plus Bio,
                  Inherit&rsquo;s data is simply not part of it.
                </li>
                <li>
                  Inherit uses its own domain, <strong>inherit.bio</strong>, and
                  its own accounts. It does not share sign-in systems with any
                  Plus Bio service.
                </li>
                <li>
                  <strong>
                    No personal, health, or genetic data flows between Inherit
                    and any Plus Bio service, in either direction.
                  </strong>{" "}
                  Not uploads, not derived variants, not reports, not account
                  details, not usage events. The systems are not connected.
                </li>
              </ul>
              <p>
                The <Link href="/privacy">privacy policy</Link> states the same
                promises as binding rules.
              </p>
            </>
          ),
        },
        {
          id: "accessibility",
          heading: "Accessibility",
          body: (
            <>
              <p>
                Everyone must be able to use a service built on trust.
                Accessibility is a core rule for Inherit. We aim for{" "}
                <strong>WCAG 2.1 AA</strong>. Each release runs automated axe
                checks in light and dark themes. You can use the interface with
                a keyboard. It has a skip link, clear focus styles, and page
                landmarks and headings.
              </p>
              <p>
                We also name known gaps. A screen reader cannot use the genome
                browser canvas yet. Its search results are accessible, and
                every finding also appears as text.
              </p>
              <p>
                Found an access problem? Tell us. Email{" "}
                <strong>accessibility@inherit.bio</strong> or open a public
                issue. We treat access bugs like other broken features.
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
                General questions: <strong>hello@inherit.bio</strong>.
              </p>
              <p>
                Privacy and data rights: <strong>privacy@inherit.bio</strong>.
              </p>
              <p>
                Security reports: <strong>security@inherit.bio</strong>.
              </p>
              <p>
                Please file bugs and feature requests in the public repository.
              </p>
              <p>
                Inherit is informational only — not medical advice and not a
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
