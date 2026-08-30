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
          Inherit is an open-source consumer genomics platform. It helps you
          buy whole-genome or exome sequencing from an independent provider,
          then turns the raw file you get back into reports, ancestry
          estimates, and polygenic scores — on infrastructure you can read,
          audit, and run yourself.
        </p>
      }
      sections={[
        {
          id: "what-sequence-is",
          heading: "What Inherit is",
          body: (
            <>
              <p>
                Most consumer genomics companies sell you a test, keep your
                data on their servers, and make their real money elsewhere.
                Inherit inverts that model. We do not sell sequencing at all:
                our provider directory routes you to real laboratories, you pay
                them directly, and no money passes through us. You then upload
                the raw file — a 23andMe, AncestryDNA, MyHeritage, or
                FamilyTreeDNA export, a VCF, or a BAM/CRAM — and Inherit
                interprets it for you.
              </p>
              <p>
                Every report states its evidence level, cites its sources, and
                says plainly when your file does not cover a variant. Inherit
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
                  from them directly; Inherit takes no commission, referral
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
                The entire Inherit codebase is published under the GNU Affero
                General Public License, version 3.0 (AGPL-3.0) at{" "}
                <a
                  href="https://github.com/themariodiego/sequence"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/themariodiego/sequence
                </a>
                . That license choice is deliberate: anyone who runs Inherit
                as a service — including us — must publish their modifications.
                You can read exactly how your file is parsed, how reports are
                generated, and what leaves the server (nothing, unless you ask
                it to).
              </p>
              <p>
                Because the code is open, our privacy promises are not just
                policy — they are structural. If Inherit the company ever
                disappointed you, you could take the code, your exported data,
                and self-host the whole platform. That exit path is documented
                at <Link href="/docs/self-hosting">/docs/self-hosting</Link>.
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
                Inherit was <strong>created by Plus Bio</strong> — the team
                built it, gave it their design language, and released it as
                open source <strong>for the public good</strong>. And it was
                deliberately set up as a{" "}
                <strong>legally separate entity</strong>: Inherit is not a
                product line inside a company, it is its own thing, with its
                own domain, its own accounts, and its own obligations to you.
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
                  Inherit runs on a <strong>separate domain</strong>{" "}
                  (inherit.bio) with <strong>separate accounts</strong>. There
                  is no single sign-on with any Plus Bio service and no shared
                  login infrastructure.
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
                This separation is restated, with the same guarantees, in the{" "}
                <Link href="/privacy">privacy policy</Link>, where it is a
                binding commitment rather than a description.
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
                A platform built on trust has to be usable by everyone, so
                accessibility is treated as a core requirement, not a
                nice-to-have. Inherit targets{" "}
                <strong>WCAG 2.1 AA</strong>: every release runs automated
                axe accessibility checks in our continuous-integration
                pipeline, in both light and dark themes, and the interface
                is built to be fully operable with a keyboard alone — a
                skip-to-content link, visible focus styles, and proper
                landmarks and headings throughout.
              </p>
              <p>
                We are equally honest about known gaps: the genome browser
                canvas is not yet screen-reader accessible; variant search
                results are, and every insight in the browser is also
                available as text.
              </p>
              <p>
                If you hit a barrier, please tell us — email{" "}
                <strong>accessibility@inherit.bio</strong> or open an issue
                on the public repository. Accessibility reports are triaged
                with the same priority as functional bugs.
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
                Privacy and data-rights requests:{" "}
                <strong>privacy@inherit.bio</strong>. Security reports:{" "}
                <strong>security@inherit.bio</strong>. Bugs and feature
                requests are best filed as issues on the public repository.
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
