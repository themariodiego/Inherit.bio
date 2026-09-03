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
            The short version: we collect only what is needed to run the
            service. We do not use third-party trackers. Your genome stays on
            our systems unless you choose to send it elsewhere. Deletion is
            immediate and real. Export is always free.
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
                  Meta (Facebook) pixel, Google tags or analytics, Microsoft
                  ad pixel, session replay, or ad-tech beacons. An automated
                  network audit enforces this rule in CI. A build fails if it
                  requests a tracking domain.
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
                The hosted service uses two infrastructure providers as data
                processors. <strong>Supabase</strong> handles the database and
                file storage, including your genome files and derived variants.
                <strong>Vercel</strong> hosts the app. Each provider works only
                on our instructions under a data processing agreement. Neither
                may use your data for its own purposes.
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
                only logs we keep are first-party server logs for security and
                debugging. We also count aggregate activity without tracking
                individual users. No analytics vendor, ad network, or data
                broker gets data from Inherit. We do not share even
                “anonymized” or “aggregated” genetic statistics.
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
                , with one exception that you control: the{" "}
                <strong>AI chat feature</strong>. If you choose an external AI
                provider, Inherit sends only the report or variant excerpts
                needed to answer your question. This happens only after you
                give separate consent for that named provider. For example,
                consent for Anthropic covers only Anthropic. Until you consent,
                chat cannot send anything. You can also use a local model, so
                nothing leaves your machine.
              </p>
              <ul>
                <li>
                  Consent is granular: one grant per named provider, never a
                  blanket “AI partners” checkbox.
                </li>
                <li>
                  You can review and revoke each grant at any time in{" "}
                  <Link href="/settings">Settings</Link>. Revocation stops all
                  future transmission at once.
                </li>
                <li>
                  Our related legal commitments are set out at{" "}
                  <Link href="/legal/research-consent">
                    /legal/research-consent
                  </Link>
                  . They include our promise not to run a research-sharing
                  program.
                </li>
              </ul>
              <p>
                Apart from that choice, we disclose data only if valid legal
                process compels us. Our strict policy at{" "}
                <Link href="/legal/law-enforcement">
                  /legal/law-enforcement
                </Link>{" "}
                governs each response. It requires notice to you unless the
                law bars notice, the narrowest possible response, and a public
                transparency report.
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
                  Database rows are deleted as soon as you confirm. This covers
                  your account, variants, reports, chat history, and consents.
                  We do not mark them hidden or queue them for later.
                </li>
                <li>
                  We delete the raw genome files from storage in the same
                  operation. We do not merely unlink them.
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
                You can export everything at any time and in open formats. This
                includes your original files, derived variants, reports, and
                chat history. Export is <strong>free forever</strong>. We will
                never charge a data-transfer, egress, or “download your own
                genome” fee. Our <Link href="/terms">terms of service</Link>{" "}
                make this a contractual promise, not a courtesy we can
                withdraw.
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
                COPPA is the United States Children’s Online Privacy Protection
                Act. Its definition of “personal information” at 16 CFR §
                312.2 expressly includes genetic data. We do not knowingly
                process any minor’s genetic or other personal information. If
                we learn that we hold data about a person under 18, we will
                delete it promptly after notice. This applies whether the minor
                opened the account or another person uploaded the file. We use
                the immediate, unrecoverable deletion described above. Report
                suspected minors’ data to privacy@inherit.bio.
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
                Genomics companies can be acquired, and their databases may
                change hands. The following rules apply if Inherit is acquired,
                merged, or transferred. They also apply in bankruptcy or
                receivership:
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
                Plus Bio created Inherit as an open-source project for the
                public good. Inherit operates as a legally separate entity.
                Creation does not mean access. The separation keeps your
                genetic data from becoming an asset of Plus Bio or any other
                commercial business. The following rules are binding:
              </p>
              <ul>
                <li>
                  Inherit and Plus Bio&rsquo;s commercial services use separate
                  domains and accounts. They do not share a single sign-on
                  system.
                </li>
                <li>
                  <strong>
                    No personal, health, or genetic data moves between Inherit
                    and any Plus Bio service.
                  </strong>{" "}
                  This rule applies in both directions. It covers uploads,
                  derived data, account details, and usage events.
                </li>
                <li>
                  Plus Bio&rsquo;s commercial operations have no access to
                  Inherit data under this policy. Inherit is legally separate.
                  A change of control at Plus Bio cannot transfer your data.
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
                  <strong>Erasure</strong> — immediately delete any file or
                  your entire account. This covers GDPR Article 17 and the CCPA
                  right to delete.
                </li>
                <li>
                  <strong>Restriction and objection</strong> — restrict or
                  object to processing under GDPR Articles 18 and 21. We do not
                  use marketing profiles or automated decisions with legal
                  effect. There is little to object to, but the right still
                  applies.
                </li>
                <li>
                  <strong>Withdraw consent</strong> — revoke any LLM-provider
                  consent at any time in{" "}
                  <Link href="/settings">Settings</Link> (GDPR Article 7(3)).
                </li>
                <li>
                  <strong>No sale, no sharing</strong> — we do not sell or
                  share personal information under the CCPA/CPRA definitions.
                  There is nothing to opt out of because we meet the right by
                  default.
                </li>
                <li>
                  <strong>No discrimination</strong> — exercising any right
                  never degrades your service.
                </li>
                <li>
                  <strong>Complaint</strong> — you may complain to your local
                  supervisory authority. GDPR Article 77 protects this right.
                  You may also complain to your state attorney general.
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
                We will post any new version here with a new effective date.
                We will email account holders before a material change takes
                effect. A change cannot weaken protections for data already
                collected unless you affirmatively consent.
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
