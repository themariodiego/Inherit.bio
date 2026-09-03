import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyEmailButton } from "@/components/embryo/copy-email-button";
import { EmbryoUnavailable } from "@/components/embryo/states";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { EMBRYOS_H1 } from "@/copy/embryos/index";
import {
  BACK_TO_EMBRYOS_LINK,
  EMAIL_HEADING,
  FORMATS_SENTENCE,
  LEDE,
  LETTER,
  NEXT_STEP_SENTENCE,
  REQUEST_DATA_H1,
} from "@/copy/embryos/request-data";
import { permits } from "@/lib/embryos/access";
import { route } from "@/lib/primary-routes";
import { loadViewer } from "../context";

export const metadata: Metadata = { title: `${REQUEST_DATA_H1} · ${EMBRYOS_H1}` };

/**
 * `/embryos/request-data` — the letter to the laboratory (design §2.2;
 * register embryos.request-data, flow, `restricted-flow`). The letter is
 * static copy, so it renders for an account with no cohort; the one primary
 * action copies it; the closed list of formats and the next step follow.
 * The route is guarded by `embryo_analysis` like every Embryo page.
 */
export default async function EmbryoRequestDataPage() {
  const viewer = await loadViewer();
  if (!viewer) redirect("/auth/sign-in");
  const { decision } = viewer;

  return (
    <div data-surface="flow" className="mx-auto max-w-3xl space-y-8">
      <Breadcrumbs
        items={[{ label: EMBRYOS_H1, href: route("embryos.index") }, { label: REQUEST_DATA_H1 }]}
      />
      <header className="space-y-3">
        <h1 className="display text-3xl">{REQUEST_DATA_H1}</h1>
      </header>
      {!permits(decision) ? (
        <EmbryoUnavailable
          decision={decision}
          action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}
        />
      ) : (
        <>
          <section aria-labelledby="request-letter-heading" className="space-y-4">
            <h2 id="request-letter-heading" className="text-lg font-semibold text-ink">
              {EMAIL_HEADING}
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-ink">{LEDE}</p>
            <blockquote
              data-slot="request-letter"
              className="max-w-prose rounded-2xl border border-line bg-card p-5 text-base leading-relaxed text-ink"
            >
              {LETTER}
            </blockquote>
            <CopyEmailButton text={LETTER} />
          </section>
          <p data-slot="formats" className="max-w-prose text-sm leading-relaxed text-ink">
            {FORMATS_SENTENCE}
          </p>
          <p data-slot="next-step" className="max-w-prose text-sm leading-relaxed text-ink-muted">
            {NEXT_STEP_SENTENCE}
          </p>
          <p className="text-sm">
            <Link
              href={route("embryos.index")}
              className="inline-flex min-h-11 items-center underline underline-offset-2"
            >
              {BACK_TO_EMBRYOS_LINK}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
