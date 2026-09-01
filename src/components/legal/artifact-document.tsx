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
    <article className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Versioned legal artifact</p>
      <h1 className="display mt-4 break-words text-4xl">{artifact.artifact_key}</h1>
      <p className="mt-4 text-sm text-ink-muted">
        Version {artifact.version} · effective <time dateTime={artifact.effective_on}>{artifact.effective_on}</time>
      </p>
      <section data-legal-summary className="mt-8 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">Plain-language summary</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{artifact.summary_markdown}</p>
      </section>
      {artifact.summary_of_changes ? <p className="mt-5 text-sm text-ink-muted"><strong>Changes:</strong> {artifact.summary_of_changes}</p> : null}
      <div className="mt-8 whitespace-pre-wrap border-t border-line pt-8 text-sm leading-relaxed">{artifact.body_markdown}</div>
      <footer className="mt-10 space-y-2 border-t border-line pt-5 text-xs text-ink-muted">
        <p className="break-all font-mono">sha256 {artifact.body_sha256}</p>
        <Link href={`${routeBase}/${versionPath}/${artifact.version}`} className="underline underline-offset-2">Permanent link to this version</Link>
      </footer>
    </article>
  );
}
