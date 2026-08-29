import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "Plain-language privacy policy: what Inherit collects, what it refuses to collect, where data is processed, deletion that actually deletes, free export forever, and change-of-control protections.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Privacy <span className="accent">policy.</span>
        </>
      }
      effectiveDate="2026-08-28"
      intro={
        <>
          <p>
            This policy is written to be read. Genetic data is the most
            personal data there is, so every section below states, in plain
            language, what we collect, why, where it lives, and how to make it
            leave. Where we make a promise, we mean it as a commitment you can
            hold us to — several of these promises are also restated as
            contractual obligations in our{" "}
            <Link href="/terms">terms of service</Link>.
          </p>
          <p>
            The short version: we collect the minimum needed to run the
            service, we run no third-party trackers of any kind, your genome
            never leaves our infrastructure unless you explicitly send it
            somewhere, deletion is immediate and real, and export is free
            forever.
          </p>
        </>
      }
      sections={[
        {
          id: "data-we-collect",
          heading: "Data we collect",
          body: (
            <>
              <p>We collect three categories of data, and only these:</p>
              <ul>
                <li>
                  <strong>Account data.</strong> Your email address and a
                  password hash (or the identifier from your chosen sign-in
                  method), plus the settings you choose in the app. If you
                  optionally tell us your country and, for the United States,
                  your state — used only to tailor legal information such as
                  our <Link href="/legal/gina">GINA explainer</Link> — you pick
                  them from dropdowns. We deliberately provide no field for a
                  street address and do not collect one.
                </li>
                <li>
                  <strong>Uploaded genome files.</strong> The raw files you
                  upload: microarray exports (23andMe, AncestryDNA, MyHeritage,
                  FamilyTreeDNA), VCF/gVCF files, and BAM/CRAM files. Uploads
                  go directly from your browser to your private storage bucket
                  and never pass through our page servers.
                </li>
                <li>
                  <strong>Derived data.</strong> Variants parsed from your
                  files, the reports, ancestry estimates, and polygenic scores
                  computed from them, and — if you use the chat feature — your
                  chat history. Derived data is treated with the same
                  protections as the files it came from.
                </li>
              </ul>
              <h3>What we deliberately do not collect</h3>
              <ul>
                <li>
                  <strong>No street addresses.</strong> Location, where
                  relevant at all, is a country/state dropdown — nothing finer.
                </li>
                <li>
                  <strong>No third-party trackers of any kind.</strong> No
                  Meta (Facebook) pixel, no Google tags or analytics, no
                  Microsoft advertising pixel, no session-replay scripts, no
                  ad-tech beacons. These are not just absent — they are banned
                  by an automated network audit in our continuous-integration
                  pipeline, which fails any build that introduces a request to
                  a tracking domain.
                </li>
                <li>
                  <strong>No behavioral advertising profiles.</strong> We have
                  no advertising business and build no such profiles.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "processing-locations",
          heading: "Where your data is processed",
          body: (
            <>
              <p>
                The hosted service runs on two infrastructure providers acting
                as our data processors: <strong>Supabase</strong> (database and
                file storage, including your genome files and derived
                variants) and <strong>Vercel</strong> (application hosting).
                Both process data solely on our instructions under data
                processing agreements; neither has any right to use your data
                for its own purposes.
              </p>
              <p>
                If you prefer that no company — including us — hold your
                genome, Inherit is designed to be{" "}
                <strong>self-hosted</strong>. The complete platform is
                open-source under AGPL-3.0, and the self-hosting guide at{" "}
                <Link href="/docs/self-hosting">/docs/self-hosting</Link> lets
                you run it on infrastructure you control, in which case this
                policy’s hosted-service sections simply do not apply to you.
              </p>
            </>
          ),
        },
        {
          id: "no-analytics",
          heading: "Zero third-party analytics",
          body: (
            <>
              <p>
                We use <strong>no third-party analytics services</strong>. The
                only operational measurements we make are first-party server
                logs (for security and debugging) and aggregate counts with no
                per-user tracking. No analytics vendor, ad network, or data
                broker receives anything from Inherit — not even “anonymized”
                or “aggregated” genetic statistics, which we do not share
                either.
              </p>
            </>
          ),
        },
        {
          id: "third-parties",
          heading: "When data can leave our infrastructure",
          body: (
            <>
              <p>
                <strong>
                  Your genome data is never sent to a third party
                </strong>
                , with exactly one exception, and it is one you initiate: the{" "}
                <strong>AI chat feature</strong>. If you choose to chat with an
                AI model hosted by an external provider, the excerpts of your
                reports or variants needed to answer your question are sent to
                that provider — but only after you grant an explicit,
                per-provider consent naming the specific company (for example,
                a consent that names Anthropic covers Anthropic only). Until
                you grant that consent, the chat feature cannot transmit
                anything, and you can also point chat at a local model so
                nothing leaves your machine at all.
              </p>
              <ul>
                <li>
                  Consent is granular: one grant per named provider, never a
                  blanket “AI partners” checkbox.
                </li>
                <li>
                  You can review and revoke every grant at any time in{" "}
                  <Link href="/settings">Settings</Link>; revocation stops all
                  future transmission immediately.
                </li>
                <li>
                  Our related legal commitments — including that we run no
                  research-sharing program — are documented at{" "}
                  <Link href="/legal/research-consent">
                    /legal/research-consent
                  </Link>
                  .
                </li>
              </ul>
              <p>
                Beyond that single user-initiated exception, we disclose data
                only when compelled by valid legal process, under the strict
                policy published at{" "}
                <Link href="/legal/law-enforcement">
                  /legal/law-enforcement
                </Link>{" "}
                — which includes notice to you unless we are legally barred,
                minimal-scope responses, and a public transparency report.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          heading: "Retention",
          body: (
            <>
              <p>
                We keep your data for as long as your account exists, and no
                longer. There is no shadow retention:
              </p>
              <ul>
                <li>
                  Account data, genome files, and derived data are retained
                  while your account is active, because they are the service.
                </li>
                <li>
                  Server logs are retained for 30 days for security and
                  debugging, then deleted. Logs never contain genome file
                  contents or variant data.
                </li>
                <li>
                  Encrypted database backups are retained for at most 30 days
                  on a rolling basis and exist solely for disaster recovery.
                  Backups are never used to restore data you have deleted.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "deletion",
          heading: "Deletion that actually deletes",
          body: (
            <>
              <p>
                When you delete a file or your account, deletion is{" "}
                <strong>immediate and unrecoverable</strong>:
              </p>
              <ul>
                <li>
                  Database rows (account, variants, reports, chat history,
                  consents) are deleted at the moment you confirm — not flagged
                  as hidden, not queued for later.
                </li>
                <li>
                  Storage objects — the raw genome files themselves — are
                  deleted from the storage buckets in the same operation, not
                  merely unlinked.
                </li>
                <li>
                  There is <strong>no grace period and no resurrection</strong>
                  . We will not restore deleted data from backups, and rolling
                  backups age out within 30 days, after which no copy exists
                  anywhere on our infrastructure.
                </li>
              </ul>
              <p>
                Deletion is available self-serve in{" "}
                <Link href="/settings">Settings</Link> — no support ticket, no
                retention phone call, no dark patterns.
              </p>
            </>
          ),
        },
        {
          id: "export",
          heading: "Free export, forever",
          body: (
            <>
              <p>
                You can export everything — your original uploaded files, all
                derived variants, all reports, and your chat history — at any
                time, in open formats, <strong>at no charge, forever</strong>.
                We will never introduce a data-transfer, egress, or
                “download your own genome” fee. This is a contractual promise,
                restated in our <Link href="/terms">terms of service</Link>,
                not a courtesy we can quietly withdraw.
              </p>
            </>
          ),
        },
        {
          id: "children",
          heading: "Children's data",
          body: (
            <>
              <p>
                Inherit is for adults: you must be{" "}
                <strong>18 or older</strong> to create an account, and you may
                only upload genome files that are your own. Inherit is not
                directed to children and we do not knowingly collect or
                process data from anyone under 18.
              </p>
              <p>
                Under the United States Children’s Online Privacy Protection
                Act (COPPA), the definition of “personal information” at 16
                CFR § 312.2 expressly includes genetic data. We do not
                knowingly process any minor’s personal information, genetic or
                otherwise. If we learn that data of a person under 18 has been
                uploaded — whether their own account or their file uploaded by
                someone else — we will delete it promptly upon notice, using
                the same immediate, unrecoverable deletion described above.
                Reports of suspected minors’ data should go to
                privacy@inherit.bio.
              </p>
            </>
          ),
        },
        {
          id: "change-of-control",
          heading: "Change of control",
          body: (
            <>
              <p>
                Genomics companies get acquired, and databases have a way of
                becoming the asset that changes hands. Here is exactly what
                happens if Inherit is ever acquired, merged, or transferred,
                or enters bankruptcy or receivership:
              </p>
              <ul>
                <li>
                  <strong>60 days’ advance notice.</strong> We will notify you
                  by email at least 60 days before any transfer of your data
                  to a successor entity takes effect.
                </li>
                <li>
                  <strong>A guaranteed export-and-delete window.</strong>{" "}
                  Throughout that notice period, free export and immediate
                  deletion remain fully available. If you delete before the
                  transfer, the successor receives nothing about you.
                </li>
                <li>
                  <strong>Policy continuity or fresh consent.</strong> Any
                  successor is bound by this policy for data collected under
                  it. Weakening these commitments requires your new,
                  affirmative consent — silence is not consent.
                </li>
                <li>
                  <strong>A structural escape hatch.</strong> Because Inherit
                  is AGPL-3.0 open source, the platform itself cannot be taken
                  away from you: you can export your data and self-host the
                  same software, permanently, regardless of what happens to
                  the company.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "plus-bio",
          heading: "Inherit and Plus Bio: created by, legally separate",
          body: (
            <>
              <p>
                Inherit was created by Plus Bio as an open-source project for
                the public good, and it operates as a legally separate entity.
                Creation is not access: the legal separation exists precisely
                so that your genetic data can never become an asset of any
                commercial business, Plus Bio&rsquo;s included. As a matter of
                binding policy:
              </p>
              <ul>
                <li>
                  Inherit and Plus Bio&rsquo;s commercial services run on
                  separate domains with separate accounts, and there is no
                  single sign-on between them.
                </li>
                <li>
                  <strong>
                    No personal, health, or genetic data flows between Inherit
                    and any Plus Bio service, in either direction
                  </strong>{" "}
                  — no uploads, no derived data, no account details, no usage
                  events.
                </li>
                <li>
                  Nothing in this policy grants Plus Bio&rsquo;s commercial
                  operations any access to Inherit data, and Inherit&rsquo;s
                  legal separation means a change of control at Plus Bio does
                  not transfer your data anywhere.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "your-rights",
          heading: "Your rights (GDPR, CCPA, and everywhere else)",
          body: (
            <>
              <p>
                We extend the same rights to every user, everywhere, without
                requiring you to prove which law applies to you:
              </p>
              <ul>
                <li>
                  <strong>Access and portability</strong> — see and export
                  everything we hold about you (GDPR Articles 15 and 20; CCPA
                  right to know). Self-serve, free, forever.
                </li>
                <li>
                  <strong>Rectification</strong> — correct inaccurate account
                  data (GDPR Article 16).
                </li>
                <li>
                  <strong>Erasure</strong> — delete any file or your entire
                  account, immediately (GDPR Article 17; CCPA right to
                  delete).
                </li>
                <li>
                  <strong>Restriction and objection</strong> — restrict or
                  object to processing (GDPR Articles 18 and 21); since we do
                  no marketing profiling or automated decision-making with
                  legal effect, there is little to object to, but the right
                  stands.
                </li>
                <li>
                  <strong>Withdraw consent</strong> — revoke any LLM-provider
                  consent at any time in{" "}
                  <Link href="/settings">Settings</Link> (GDPR Article 7(3)).
                </li>
                <li>
                  <strong>No sale, no sharing</strong> — we do not sell or
                  share personal information as the CCPA/CPRA defines those
                  terms, so there is nothing to opt out of; the right to
                  opt out is satisfied by default.
                </li>
                <li>
                  <strong>No discrimination</strong> — exercising any right
                  never degrades your service.
                </li>
                <li>
                  <strong>Complaint</strong> — you may lodge a complaint with
                  your local supervisory authority (GDPR Article 77) or your
                  state attorney general.
                </li>
              </ul>
              <p>
                Most rights are self-serve in the app. For anything that is
                not, email privacy@inherit.bio and we will respond within
                30 days.
              </p>
            </>
          ),
        },
        {
          id: "contact",
          heading: "Changes and contact",
          body: (
            <>
              <p>
                If we change this policy, we will post the new version here
                with a new effective date and email account holders about any
                material change before it takes effect. Changes never apply
                retroactively to weaken protections on data already collected
                without your affirmative consent.
              </p>
              <p>
                Privacy questions and data-rights requests:{" "}
                <strong>privacy@inherit.bio</strong>. Security reports:{" "}
                <strong>security@inherit.bio</strong>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
