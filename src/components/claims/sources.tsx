import { claimSourceAnchor, presentationSource } from "@/lib/claims/presentation";

export function ClaimSources({ sourceIds, scienceIndex = false, start = 1 }: {
  sourceIds: readonly string[];
  scienceIndex?: boolean;
  start?: number;
}) {
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Duplicate page source");
  if (!Number.isSafeInteger(start) || start < 1) throw new Error("Invalid source list start");
  return (
    <ol data-slot="claim-sources" start={start} className="list-decimal space-y-3 pl-5 text-sm">
      {sourceIds.map((id) => {
        const source = presentationSource(id);
        return (
          <li key={id} id={claimSourceAnchor(id)} data-source-id={id} className="scroll-mt-24">
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {source.type === "pmid" ? `PMID ${source.identifier}` : source.identifier}
            </a>
            <p className="text-ink-muted">Source read: <time data-ui-chrome-kind="date" dateTime={source.access_date}>{source.access_date}</time></p>
            {!scienceIndex ? <a href="/science#sources" className="underline underline-offset-2">About these sources</a> : null}
          </li>
        );
      })}
    </ol>
  );
}
