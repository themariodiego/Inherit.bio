import { notFound } from "next/navigation";
import { getArtifactVersion } from "@/lib/legal/artifacts";

export default async function ArtifactDiffPage(props: PageProps<"/legal/[artifact]/diff/[from]/[to]">) {
  const { artifact: key, from: fromRaw, to: toRaw } = await props.params;
  const fromVersion = Number(fromRaw);
  const toVersion = Number(toRaw);
  if (![fromVersion, toVersion].every((value) => Number.isInteger(value) && value > 0)) notFound();
  const [from, to] = await Promise.all([getArtifactVersion(key, fromVersion), getArtifactVersion(key, toVersion)]);
  if (!from || !to) notFound();
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Version comparison</p>
        <h1 className="display break-words">{key}: v{fromVersion} → v{toVersion}</h1>
        <p className="lede reading-intro">{to.summary_of_changes ?? "No change summary was recorded."}</p>
      </header>
      {/* Stacked below lg, the two versions are two top-level sections a
          section rhythm apart; side by side, the 24px column gap stays (X6.3). */}
      <div className="mt-section grid gap-x-6 gap-y-section lg:grid-cols-2">
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
