import { notFound } from "next/navigation";
import { LegalArtifactDocument } from "@/components/legal/artifact-document";
import { getCurrentArtifact } from "@/lib/legal/artifacts";

export default async function ConsentArtifactPage(props: PageProps<"/legal/consent/[key]">) {
  const { key } = await props.params;
  const artifactKey = key.startsWith("consent.") ? key : `consent.${key}`;
  const artifact = await getCurrentArtifact(artifactKey);
  if (!artifact) notFound();
  return <LegalArtifactDocument artifact={artifact} routeBase={`/legal/consent/${encodeURIComponent(key)}`} versionPath="v" />;
}
