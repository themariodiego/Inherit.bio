import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PermissionColumn, type ColumnRow } from "@/components/family/permission-column";
import type { RowAction } from "@/components/family/permission-grant-row";
import { SharingActions } from "@/components/family/sharing-actions";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { NAV_LABELS } from "@/copy/navigation";
import {
  PERMISSIONS_H1,
  PERMISSION_ROWS,
  TOMBSTONE_ITEMS_HEADING,
  asymmetryLine,
  onlyTheyCanTurnThisOn,
  theirColumnHeading,
  tombstoneStatus,
  yourColumnHeading,
  type PermissionState,
} from "@/copy/family/permissions";
import { STOP_DELETES } from "@/copy/family/permissions";
import { permits, personCapability } from "@/lib/family/access";
import { resolveFamilyPerson, type Purpose } from "@/lib/family/graph";
import {
  SHARE_WITH_ADULT_ARTIFACT,
  SHARE_WITH_ADULT_STATEMENT_KEYS,
  mintGrantPresentation,
  mintSharingOperation,
  type GrantPurposeRequest,
} from "@/lib/family/grant-token";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `/family/[person]/permissions` — the two independent columns and the
 * pause/stop actions (design §2.4; register family.permissions, mode
 * "mixed": grant and resume are guarded by the jurisdiction, while pause,
 * stop and revoke are rights and bypass it).
 *
 * Every settable row carries the single-use presentation token this server
 * component minted for exactly one signer, data subject, recipient
 * principal, purpose, artifact and revision pair
 * (policyContracts.directional-purpose-grant-v1). The opposite column is
 * rendered from this session but never settable from it: only that person's
 * own session may turn those rows on.
 */

export async function generateMetadata(
  props: PageProps<"/family/[person]/permissions">,
): Promise<Metadata> {
  const { person: segment } = await props.params;
  const context = await loadPerson(segment);
  return {
    title: context ? `${context.person.displayLabel} · ${PERMISSIONS_H1}` : PERMISSIONS_H1,
  };
}

const loadPerson = cache(async (segment: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const person = await resolveFamilyPerson(user.id, segment);
  return person ? { user, person } : null;
});

interface OutboundGrant {
  grantId: string;
  state: PermissionState;
}

export default async function FamilyPermissionsPage(
  props: PageProps<"/family/[person]/permissions">,
) {
  const { person: segment } = await props.params;
  const context = await loadPerson(segment);
  if (!context) notFound();
  const { user, person } = context;

  const decision = await personCapability(user.id, person, "third_party_adult_analysis");
  const mayGrant = permits(decision);

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const [{ data: mySelf }, { data: profile }, { data: artifact }, { data: stop }] =
    await Promise.all([
      admin
        .from("subjects")
        .select("id, subject_binding_revision")
        .eq("subject_account_id", user.id)
        .eq("subject_class", "self")
        .eq("lifecycle", "active")
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      admin.from("profiles").select("jurisdiction_revision").eq("id", user.id).maybeSingle(),
      admin
        .from("consent_artifacts")
        .select("artifact_key, version, body_sha256")
        .eq("artifact_key", SHARE_WITH_ADULT_ARTIFACT)
        .is("superseded_at", null)
        .lte("published_at", now)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("family_sharing_stops")
        .select("ended_at, deleted_counts")
        .eq("account_low_id", user.id < person.counterpartAccountId ? user.id : person.counterpartAccountId)
        .eq("account_high_id", user.id < person.counterpartAccountId ? person.counterpartAccountId : user.id)
        .order("ended_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  // The principals the grant transaction binds: this account's own signer,
  // and the counterpart's account principal as recipient.
  const [{ data: myPrincipal }, { data: theirPrincipal }] = await Promise.all([
    mySelf
      ? admin
          .from("subject_principals")
          .select("id")
          .eq("subject_id", mySelf.id)
          .eq("account_id", user.id)
          .eq("principal_kind", "account_subject")
          .eq("status", "active")
          .order("created_at")
          .limit(1)
          .maybeSingle()
      : { data: null },
    admin
      .from("subject_principals")
      .select("id")
      .eq("subject_id", person.dataSubjectId)
      .eq("account_id", person.counterpartAccountId)
      .eq("principal_kind", "account_subject")
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);

  // This account's own grants toward that person, live or expired, so a row
  // can offer the exact revocation instead of a second grant.
  const outbound = new Map<Purpose, OutboundGrant>();
  if (myPrincipal) {
    const { data: baseRows } = await admin
      .from("purpose_grants")
      .select("grant_id, grant_revision, purpose, expires_at")
      .eq("data_subject_principal_id", myPrincipal.id)
      .is("revoked_at", null);
    const grantIds = (baseRows ?? []).map((row) => row.grant_id);
    const { data: directions } = grantIds.length
      ? await admin
          .from("directional_grants")
          .select("grant_id, grant_revision, recipient_account_id, status")
          .in("grant_id", grantIds)
          .eq("status", "current")
          .eq("recipient_account_id", person.counterpartAccountId)
      : { data: [] as { grant_id: string; grant_revision: number }[] };
    const byGrant = new Map((directions ?? []).map((row) => [row.grant_id, row.grant_revision]));
    for (const base of baseRows ?? []) {
      if (byGrant.get(base.grant_id) !== base.grant_revision) continue;
      const expired = base.expires_at !== null && base.expires_at <= now;
      outbound.set(base.purpose as Purpose, {
        grantId: base.grant_id,
        state: expired ? "expired" : "on",
      });
    }
  }

  const canMint = Boolean(mySelf && myPrincipal && theirPrincipal && artifact && profile);
  function actionFor(purpose: Purpose): RowAction | undefined {
    const held = outbound.get(purpose);
    if (held && held.state === "on") return { kind: "revoke", grantId: held.grantId };
    if (!mayGrant || !canMint) return undefined;
    const request: GrantPurposeRequest = {
      action: "grant-purpose",
      subjectId: mySelf!.id,
      purposeKey: purpose,
      artifactVersion: artifact!.version,
      artifactPresentationToken: mintGrantPresentation({
        accountId: user.id,
        dataSubjectId: mySelf!.id,
        subjectBindingRevision: mySelf!.subject_binding_revision,
        recipientPrincipalId: theirPrincipal!.id,
        recipientAccountId: person.counterpartAccountId,
        purpose,
        artifactKey: artifact!.artifact_key,
        artifactVersion: artifact!.version,
        artifactBodySha256: artifact!.body_sha256,
        jurisdictionRevision: profile!.jurisdiction_revision,
      }),
      affirmed: true,
      statementKeys: [...SHARE_WITH_ADULT_STATEMENT_KEYS],
    };
    return { kind: "grant", request };
  }

  const theirColumn: ColumnRow[] = PERMISSION_ROWS.map((row) => ({
    id: row.id,
    state: person.grantsToViewer.has(row.id as Purpose) ? "on" : "off",
  }));
  const yourColumn: ColumnRow[] = PERMISSION_ROWS.map((row) => ({
    id: row.id,
    state: outbound.get(row.id as Purpose)?.state ?? "off",
    action: actionFor(row.id as Purpose),
  }));

  const theySeeSomething = yourColumn.some((row) => row.state === "on");
  const youSeeNothing = theirColumn.every((row) => row.state !== "on");
  const subject = { ...person.handle, displayLabel: person.displayLabel };

  const deleted = (stop?.deleted_counts ?? {}) as Record<string, unknown>;
  const deletedCount = Object.values(deleted).reduce<number>(
    (total, value) => total + (typeof value === "number" ? value : 0),
    0,
  );

  return (
    <div data-surface="flow" className="mx-auto max-w-4xl space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS.family, href: route("family.index") },
          {
            label: person.displayLabel,
            href: route("family.person", { person: person.handle.routeSegment }),
          },
          { label: PERMISSIONS_H1 },
        ]}
      />
      <SubjectBar subject={subject} fileCount={null} viewerAccountId={user.id} />

      <header className="space-y-3">
        <h1 className="display text-3xl">{PERMISSIONS_H1}</h1>
        {!mayGrant ? (
          <p role="status" className="max-w-prose text-sm leading-relaxed text-ink">
            {decision.userFacingCopy}
          </p>
        ) : null}
        {theySeeSomething && youSeeNothing ? (
          <p data-slot="asymmetry" className="max-w-prose text-sm leading-relaxed text-ink">
            {asymmetryLine(person.displayLabel)}
          </p>
        ) : null}
      </header>

      {stop ? (
        <section
          role="status"
          data-slot="sharing-tombstone"
          className="max-w-prose space-y-2 rounded-2xl border border-line bg-card p-6"
        >
          <p className="text-base leading-relaxed text-ink">
            {tombstoneStatus(
              new Date(stop.ended_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
              deletedCount,
            )}
          </p>
          <p className="text-sm font-medium text-ink">{TOMBSTONE_ITEMS_HEADING}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
            {STOP_DELETES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <PermissionColumn
          heading={theirColumnHeading(person.displayLabel)}
          headingId="their-column-heading"
          personName={person.displayLabel}
          rows={theirColumn}
          disabledReason={onlyTheyCanTurnThisOn(person.displayLabel)}
        />
        <PermissionColumn
          heading={yourColumnHeading(person.displayLabel)}
          headingId="your-column-heading"
          personName={person.displayLabel}
          rows={yourColumn}
        />
      </div>

      <SharingActions
        personName={person.displayLabel}
        personSegment={person.handle.routeSegment}
        paused={person.sharing === "paused"}
        stopNonce={mintSharingOperation({
          accountId: user.id,
          counterpartAccountId: person.counterpartAccountId,
          operation: "stop",
        })}
      />
    </div>
  );
}
