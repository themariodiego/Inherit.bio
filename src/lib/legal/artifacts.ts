import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ArtifactDocument } from "@/components/legal/artifact-document";

const fields = "artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on, summary_of_changes" as const;

export async function getCurrentArtifact(key: string): Promise<ArtifactDocument | null> {
  const { data } = await createAdminClient().from("consent_artifacts").select(fields).eq("artifact_key", key).is("superseded_at", null).maybeSingle();
  return data as ArtifactDocument | null;
}

export async function getArtifactVersion(key: string, version: number): Promise<ArtifactDocument | null> {
  const { data } = await createAdminClient().from("consent_artifacts").select(fields).eq("artifact_key", key).eq("version", version).maybeSingle();
  return data as ArtifactDocument | null;
}
