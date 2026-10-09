import { notFound } from "next/navigation";
import { getArtifactVersion } from "@/lib/legal/artifacts";

export default async function ConsentArtifactDiffPage(props: PageProps<"/legal/consent/[key]/diff/[from]/[to]">) {
  const { key, from: fromRaw, to: toRaw } = await props.params;
  const versions = [Number(fromRaw), Number(toRaw)];
  if (!versions.every((value) => Number.isInteger(value) && value > 0)) notFound();
  const artifactKey = key.startsWith("consent.") ? key : `consent.${key}`;
  const [from, to] = await Promise.all([
    getArtifactVersion(artifactKey, versions[0]),
    getArtifactVersion(artifactKey, versions[1]),
  ]);
  if (!from || !to) notFound();
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Consent comparison</p>
        <h1 className="display display-lg break-words">{artifactKey}: v{versions[0]} → v{versions[1]}</h1>
        <p className="lede reading-intro">{to.summary_of_changes ?? "No change summary was recorded."}</p>
      </header>
      <div className="mt-section grid gap-6 lg:grid-cols-2">
        {[from, to].map((artifact) => (
          <section key={artifact.version} className="plate min-w-0">
            <div className="plate-head"><h2 className="label">Version {artifact.version}</h2></div>
            <div className="plate-body"><div className="legal-prose whitespace-pre-wrap">{artifact.body_markdown}</div></div>
          </section>
        ))}
      </div>
    </div>
  );
}
