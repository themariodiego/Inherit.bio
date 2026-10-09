import Link from "next/link";

export type ArtifactDocument = {
  artifact_key: string;
  version: number;
  body_sha256: string;
  body_markdown: string;
  summary_markdown: string;
  effective_on: string;
  summary_of_changes: string | null;
};

/**
 * One committed legal artifact at one version: the reading head, the
 * plain-language summary as a labelled plate, the signed body on the measure,
 * and the integrity footer with the hash and the permanent link.
 */
export function LegalArtifactDocument({
  artifact,
  routeBase,
  versionPath = "versions",
}: {
  artifact: ArtifactDocument;
  routeBase: string;
  versionPath?: "versions" | "v";
}) {
  return (
    <article className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Versioned legal artifact</p>
        <h1 className="display display-lg break-words">{artifact.artifact_key}</h1>
        <p className="caption">
          Version {artifact.version} · effective <time dateTime={artifact.effective_on}>{artifact.effective_on}</time>
        </p>
      </header>
      <div className="mt-section max-w-3xl stack-blocks">
        <section data-legal-summary className="plate">
          <div className="plate-head">
            <h2 className="label">Plain-language summary</h2>
          </div>
          <div className="plate-body">
            <p className="body-lg max-w-measure whitespace-pre-wrap text-ink">{artifact.summary_markdown}</p>
            {artifact.summary_of_changes ? (
              <p className="mt-4 max-w-measure border-t border-line pt-4 text-sm text-ink">
                <strong className="font-semibold">Changes:</strong> {artifact.summary_of_changes}
              </p>
            ) : null}
          </div>
        </section>
        <div className="legal-prose whitespace-pre-wrap">{artifact.body_markdown}</div>
        <footer className="border-t border-line pt-6">
          <p className="caption mono break-all">sha256 {artifact.body_sha256}</p>
          <p className="mt-2">
            <Link href={`${routeBase}/${versionPath}/${artifact.version}`} className="link-target quiet-link text-sm">
              Permanent link to this version
            </Link>
          </p>
        </footer>
      </div>
    </article>
  );
}
