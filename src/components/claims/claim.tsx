import { claimSourceAnchor, claimSourceIds, presentationClaim } from "@/lib/claims/presentation";

/** Text comes from the canonical claim, never arbitrary caller children. */
export function Claim({ id, citationId, sourceIds }: {
  id: string;
  citationId: string;
  sourceIds: readonly string[];
}) {
  const claim = presentationClaim(id);
  if (!claim) throw new Error(`Unknown canonical claim: ${id}`);
  const required = claimSourceIds([id]);
  sourceIds.forEach(claimSourceAnchor);
  if (!required.includes(citationId)) throw new Error("Primary citation does not support this claim");
  if (new Set(sourceIds).size !== sourceIds.length || required.some((source) => !sourceIds.includes(source))) {
    throw new Error("Claim references are absent or duplicated in the page source list");
  }
  return (
    <span data-claim-id={id} data-citation-id={citationId}
      data-citation-ids={required.join(" ")} data-provenance={`citation:${citationId}`}>
      {claim.text_verbatim}
      {required.map((source) => (
        <sup key={source} data-citation-id={source} className="ml-1">
          <a href={`#${claimSourceAnchor(source)}`} className="underline underline-offset-2"
            aria-label={`Source ${sourceIds.indexOf(source) + 1}`}>
            {sourceIds.indexOf(source) + 1}
          </a>
        </sup>
      ))}
    </span>
  );
}
