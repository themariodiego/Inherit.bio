import { notFound } from "next/navigation";
import { LegalArtifactDocument } from "@/components/legal/artifact-document";
import { getCurrentArtifact } from "@/lib/legal/artifacts";

export default async function ArtifactPage(props: PageProps<"/legal/[artifact]">) {
  const { artifact: key } = await props.params;
  const artifact = await getCurrentArtifact(key);
  if (!artifact) notFound();
  return <LegalArtifactDocument artifact={artifact} routeBase={`/legal/${encodeURIComponent(key)}`} />;
}
