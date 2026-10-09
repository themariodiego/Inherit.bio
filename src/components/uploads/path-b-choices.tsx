"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { route } from "@/lib/primary-routes";
import { Button } from "@/components/ui/button";
import { PATH_B_CHOICES_COPY as COPY } from "@/copy/upload/other-adult";
import { PATH_B_STATEMENTS, type PathBChoice, type PathBChoicesView } from "@/lib/uploads/path-b-purpose";

/**
 * Path B's reading layer for the person a file was added for (TEST-LOCAL
 * only). One row per kind of result and direction: for them, or for the
 * person who added the file. Turning a row on signs its own approved text;
 * turning it off uses the ordinary revocation. A ready link names only the
 * person's explicitly granted and actually completed saved report layer.
 */
function ChoiceRow({ subjectId, choice, open, onSaved }: {
  subjectId: string; choice: PathBChoice; open: boolean; onSaved: () => void;
}) {
  const [affirmed, setAffirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const granted = choice.grantId !== null;
  const layer = COPY.layers[choice.purpose];
  const who = choice.direction === "self" ? COPY.forYou : COPY.forThem;

  async function save() {
    if (inFlight.current || (!granted && (!affirmed || !choice.offer))) return;
    inFlight.current = true; setPending(true); setFailed(false);
    try {
      const response = granted
        ? await fetch(`/api/consents/${choice.grantId}/revoke`, { method: "POST", credentials: "same-origin", cache: "no-store" })
        : await fetch("/api/consents", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", "x-inherit-csrf": choice.offer!.token },
          body: JSON.stringify({ action: "grant-purpose", subjectId, purposeKey: choice.purpose,
            artifactVersion: choice.offer!.artifactVersion, artifactPresentationToken: choice.offer!.token,
            affirmed: true, statementKeys: PATH_B_STATEMENTS[choice.direction] }),
        });
      if (!response.ok) throw new Error("not recorded");
      onSaved();
    } catch { setFailed(true); setAffirmed(false); inFlight.current = false; setPending(false); }
  }

  return (
    <div className="surface-inset rec-stack-sm p-4 text-ink" data-slot="path-b-choice"
      data-purpose={choice.purpose} data-direction={choice.direction}>
      <p className="text-sm font-medium">{who} <span className="font-normal">· {granted ? COPY.on : COPY.off}</span></p>
      {!granted && !open ? <p role="note" className="text-sm">{COPY.shareClosed}</p> : null}
      {!granted && choice.offer ? (
        <>
          <details className="text-sm">
            <summary className="quiet-link py-3">{COPY.details(choice.offer.artifactVersion)}</summary>
            <div className="whitespace-pre-wrap leading-relaxed">{choice.offer.artifactBody}</div>
          </details>
          <label className="rec-choice text-sm">
            <input type="checkbox" className="size-5 accent-forest" checked={affirmed} disabled={pending}
              aria-label={`${layer}: ${who}`} onChange={event => setAffirmed(event.target.checked)} />
            <span>{choice.direction === "self" ? COPY.affirmSelf : COPY.affirmShare}</span>
          </label>
        </>
      ) : null}
      {granted || choice.offer ? (
        <div><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal text-left"
          disabled={pending || (!granted && !affirmed)} onClick={() => void save()}>
          {pending ? COPY.saving : `${granted ? COPY.turnOff : COPY.turnOn}: ${layer}, ${who.toLowerCase()}`}
        </Button></div>
      ) : null}
      {failed ? <p role="alert" className="text-sm text-danger">{COPY.failed}</p> : null}
    </div>
  );
}

export function PathBChoices({ people }: { people: PathBChoicesView[] }) {
  const router = useRouter();
  if (people.length === 0) return null;
  return (
    <section aria-labelledby="path-b-choices-heading" className="rec-stack" data-slot="path-b-choices">
      <h2 id="path-b-choices-heading" className="title">{COPY.heading}</h2>
      <p className="max-w-measure text-sm text-ink-muted">{COPY.detail}</p>
      {people.map(person => (
        <div key={person.subjectId} className="surface surface-pad-sm rec-stack">
          <p className="caption">{person.label}</p>
          {(Object.keys(COPY.layers) as PathBChoice["purpose"][]).map(purpose => (
            <div key={purpose} className="rec-stack-sm">
              <h3 className="text-base font-medium">{COPY.layers[purpose]}</h3>
              {purpose !== "ancestry" && person.readGate?.[purpose] === "ready" ?
                <Link className="link-target quiet-link text-sm" href={route("genome.reports", { subject: `s-${person.subjectId}` },
                  { query: { layer: purpose === "reports.monogenic" ? "variant_call" : "estimate" } })}>{COPY.readResults(COPY.layers[purpose])}</Link> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {person.choices.filter(choice => choice.purpose === purpose).map(choice => (
                  <ChoiceRow key={`${choice.direction}:${choice.grantId ?? choice.offer?.token ?? ""}`}
                    subjectId={person.subjectId} choice={choice} open={choice.direction === "self" || person.shareOpen}
                    onSaved={() => router.refresh()} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
