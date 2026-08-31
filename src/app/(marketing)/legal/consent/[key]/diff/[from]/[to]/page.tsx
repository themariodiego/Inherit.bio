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
  return <div className="mx-auto max-w-6xl px-6 py-16"><p className="eyebrow">Consent comparison</p><h1 className="display mt-4 text-4xl">{artifactKey}: v{versions[0]} → v{versions[1]}</h1><p className="mt-4 text-sm text-ink-muted">{to.summary_of_changes ?? "No change summary was recorded."}</p><div className="mt-10 grid gap-6 lg:grid-cols-2">{[from, to].map((artifact) => <section key={artifact.version} className="rounded-2xl border border-line bg-card p-5"><h2 className="font-medium">Version {artifact.version}</h2><div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{artifact.body_markdown}</div></section>)}</div></div>;
}
