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
    <div className="mx-auto max-w-6xl px-6 py-16">
      <p className="eyebrow">Version comparison</p><h1 className="display mt-4 text-4xl">{key}: v{fromVersion} → v{toVersion}</h1>
      <p className="mt-4 text-sm text-ink-muted">{to.summary_of_changes ?? "No change summary was recorded."}</p>
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {[from, to].map((artifact) => <section key={artifact.version} className="rounded-2xl border border-line bg-card p-5"><h2 className="font-medium">Version {artifact.version}</h2><div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{artifact.body_markdown}</div></section>)}
      </div>
    </div>
  );
}
