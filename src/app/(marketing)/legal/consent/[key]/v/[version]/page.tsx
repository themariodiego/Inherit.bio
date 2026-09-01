import { notFound } from "next/navigation";
import { LegalArtifactDocument } from "@/components/legal/artifact-document";
import { getArtifactVersion } from "@/lib/legal/artifacts";

export default async function ConsentArtifactVersionPage(props: PageProps<"/legal/consent/[key]/v/[version]">) {
  const { key, version: rawVersion } = await props.params;
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) notFound();
  const artifactKey = key.startsWith("consent.") ? key : `consent.${key}`;
  const artifact = await getArtifactVersion(artifactKey, version);
  if (!artifact) notFound();
  return <LegalArtifactDocument artifact={artifact} routeBase={`/legal/consent/${encodeURIComponent(key)}`} versionPath="v" />;
}
