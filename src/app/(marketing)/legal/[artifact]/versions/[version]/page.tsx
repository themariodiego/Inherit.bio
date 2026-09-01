import { notFound } from "next/navigation";
import { LegalArtifactDocument } from "@/components/legal/artifact-document";
import { getArtifactVersion } from "@/lib/legal/artifacts";

export default async function ArtifactVersionPage(props: PageProps<"/legal/[artifact]/versions/[version]">) {
  const { artifact: key, version: rawVersion } = await props.params;
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) notFound();
  const artifact = await getArtifactVersion(key, version);
  if (!artifact) notFound();
  return <LegalArtifactDocument artifact={artifact} routeBase={`/legal/${encodeURIComponent(key)}`} />;
}
