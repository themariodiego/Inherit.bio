import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { currentOwnUploadAccount } from "./own-upload-context";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, OWN_REPORT_STATEMENTS, type OwnReportChoicesView } from "./own-report-purpose";
import { mintOwnReportPresentation, ownReportSnapshot } from "./own-report-token";

/** A server-rendered own-account permissions panel, never a client-selected recipient. */
export async function prepareOwnReportChoices(subject = "me"): Promise<OwnReportChoicesView> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return { kind: "unavailable" };
  const target = await resolveSubjectForAccount(actor.accountId, subject);
  if (!target || target.subjectAccountId !== actor.accountId || target.subjectClass !== "self") return { kind: "unavailable" };
  const admin = createAdminClient();
  const result = await admin.rpc("own_report_context_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: target.id,
  });
  const context = ownReportSnapshot.safeParse(result.data);
  if (result.error || !context.success) return { kind: "unavailable" };
  const snapshot = context.data;
  const now = new Date().toISOString();
  const [artifacts, grants, directions, changes] = await Promise.all([
    admin.from("consent_artifacts").select("artifact_key, version, body_sha256, body_markdown")
      .in("artifact_key", OWN_REPORT_PURPOSES.map(p => OWN_REPORT_CHOICES[p].artifactKey))
      .is("superseded_at", null).lte("published_at", now).lte("effective_on", now.slice(0, 10)),
    admin.from("purpose_grants").select("grant_id, grant_revision, purpose, artifact_key, artifact_version, artifact_body_sha256")
      .eq("target_kind", "subject").eq("target_id", target.id).eq("signer_principal_id", snapshot.principalId)
      .eq("data_subject_principal_id", snapshot.principalId).eq("subject_binding_revision", snapshot.subjectBindingRevision)
      .eq("jurisdiction_revision", snapshot.jurisdictionRevision).is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`).in("purpose", [...OWN_REPORT_PURPOSES]),
    admin.from("directional_grants").select("grant_id, grant_revision")
      .eq("recipient_principal_id", snapshot.principalId).eq("recipient_account_id", actor.accountId)
      .eq("direction", "self").eq("status", "current").is("relationship_id", null).is("pair_id", null)
      .eq("relationship_or_pair_revision", snapshot.accountBindingRevision).eq("self_principal_revision", snapshot.principalRevision),
    // Superseding versions only. Version 1 introduces a document rather than
    // changing one, and a database check constraint already requires a change
    // summary on every version after the first, so this is the whole set of
    // changes that can ever need explaining. Deliberately not filtered by
    // `superseded_at`: the versions between the one someone signed and the
    // current one are superseded by definition, and they are exactly the ones
    // whose summaries are needed.
    admin.from("consent_artifacts").select("artifact_key, version, summary_of_changes")
      .in("artifact_key", OWN_REPORT_PURPOSES.map(p => OWN_REPORT_CHOICES[p].artifactKey)).gt("version", 1),
  ]);
  if (artifacts.error || grants.error || directions.error || changes.error || artifacts.data?.length !== 3) return { kind: "unavailable" };
  const choices: Extract<OwnReportChoicesView, { kind: "ready" }>["choices"] = [];
  for (const purpose of OWN_REPORT_PURPOSES) {
    const definition = OWN_REPORT_CHOICES[purpose];
    const artifact = artifacts.data.find(a => a.artifact_key === definition.artifactKey);
    if (!artifact || crypto.createHash("sha256").update(artifact.body_markdown).digest("hex") !== artifact.body_sha256) return { kind: "unavailable" };
    const grant = grants.data?.find(g => g.purpose === purpose && g.artifact_key === artifact.artifact_key
      && g.artifact_version === artifact.version && g.artifact_body_sha256 === artifact.body_sha256
      && directions.data?.some(d => d.grant_id === g.grant_id && d.grant_revision === g.grant_revision));
    // A live grant at a lower version is a signature that no longer resolves:
    // the person did agree, and then the document moved under them. The
    // `grant` lookup above cannot see it, because it matches on the current
    // version — so without this the surface would offer a plain "Enable" and
    // never mention that anything changed.
    const signedEarlier = grants.data?.filter(g => g.purpose === purpose
      && g.artifact_key === artifact.artifact_key && g.artifact_version < artifact.version) ?? [];
    const signedVersion = signedEarlier.length
      ? Math.max(...signedEarlier.map(g => g.artifact_version)) : null;
    const reconsent = signedVersion === null ? null : {
      signedVersion,
      changes: (changes.data ?? [])
        .filter(row => row.artifact_key === artifact.artifact_key
          && row.version > signedVersion && row.version <= artifact.version
          && typeof row.summary_of_changes === "string" && row.summary_of_changes.trim() !== "")
        .sort((a, b) => a.version - b.version)
        .map(row => ({ version: row.version, summary: row.summary_of_changes!.trim() })),
    };
    const presentation = mintOwnReportPresentation({ ...actor, subjectId: target.id, snapshot, purpose,
      artifactKey: artifact.artifact_key, artifactVersion: artifact.version, artifactBodySha256: artifact.body_sha256 });
    choices.push({ purposeKey: purpose, label: definition.label, description: definition.description, granted: Boolean(grant), grantId: grant?.grant_id ?? null,
      artifact: { key: artifact.artifact_key, version: artifact.version, body: artifact.body_markdown },
      token: presentation.token, statementKeys: [...OWN_REPORT_STATEMENTS], reconsent });
  }
  return { kind: "ready", subjectId: target.id, choices };
}
