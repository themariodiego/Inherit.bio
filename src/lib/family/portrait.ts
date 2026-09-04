import "server-only";

import type { PortraitStep } from "@/copy/family/portrait";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  copiesShown,
  isPathogenicClassification,
  type CarrierCondition,
  type CarrierMatch,
  type CarrierRefVariant,
  type CarrierVariantReading,
} from "./carrier-pair";

/**
 * The Portrait pair: who it is about, whether this viewer may open it, and
 * which of the register's preconditions each person has left undone
 * (design §2.5; brief X3.6 line 2418, §2 §5.6 line 352; register
 * `portrait-trait-v1.pairPrerequisites`, `other-adult-mitigation-state-v1`
 * `independent-login-restricted`).
 *
 * The rule is decided in one pure function over plain rows, so the whole
 * blocking screen is proved without a database. The reads below are the
 * equivalent of `private.resource_authorized_v1(…, 'family_pair', …)` plus
 * the columns the blocking screen names, taken with the service role: the
 * pair row, its two subjects, the live own-session `family.portrait` grants
 * between the two accounts, and the pause predicate. Nothing derived is read
 * here: no file, no genotype, no result.
 *
 * The one-sided sentences of brief line 2238 ("we found no second copy in
 * {parent}", "{label}'s file does not cover {rsid}") are decided here too,
 * over the same rows and genotype maps the carrier rule read, with the rule's
 * own exported readers (`copiesShown`, `isPathogenicClassification`) so the
 * two never disagree about what a file shows. Nothing here computes a
 * probability: a one-sided reading renders words, never a number, and never
 * a zero.
 */

export const PORTRAIT_PURPOSE = "family.portrait";

/** The order the blocking screen lists a person's steps in: the order a person completes them. */
export const PORTRAIT_STEP_ORDER: readonly PortraitStep[] = [
  "account",
  "independentLogin",
  "grant",
  "acknowledged",
];

export interface PortraitPairRow {
  id: string;
  subjectAId: string;
  subjectBId: string;
  status: string;
  pairRevision: number;
}

export interface PortraitSubjectRow {
  id: string;
  displayLabel: string;
  subjectClass: string;
  lifecycle: string;
  subjectAccountId: string | null;
  portraitAcknowledgedAt: string | null;
  independentLoginAt: string | null;
}

/** One live, unexpired, current `family.portrait` grant, with both ends resolved to accounts. */
export interface PortraitGrantRow {
  /** The account holding the data-subject principal that signed it. */
  granterAccountId: string | null;
  recipientAccountId: string | null;
  grantId: string;
}

export interface PortraitPairRows {
  viewerAccountId: string;
  pair: PortraitPairRow;
  a: PortraitSubjectRow;
  b: PortraitSubjectRow;
  grants: readonly PortraitGrantRow[];
  /** A current pause between the two accounts (family-sharing-state-v1). */
  paused: boolean;
}

export interface MissingStep {
  subjectId: string;
  step: PortraitStep;
}

export type PortraitPreconditions =
  /** Every precondition holds for both people; the page may pass the gate and read results. */
  | { kind: "ok" }
  /** At least one step is undone; the blocking screen names each one (never a partial render). */
  | { kind: "missing"; missing: readonly MissingStep[] }
  /** Sharing between the two accounts is paused; nothing renders until one of them resumes it. */
  | { kind: "paused" }
  /** The viewer is not one of the pair's two accounts, or the pair has ended: answered as 404. */
  | { kind: "not-authorised" };

const ADULT_CLASSES = new Set(["self", "other_adult"]);
const ACTIVE_LIFECYCLES = new Set(["active", "claimed_bound"]);
const OPEN_PAIR_STATUSES = new Set(["pending", "current"]);

function usableAdult(subject: PortraitSubjectRow): boolean {
  return ADULT_CLASSES.has(subject.subjectClass) && ACTIVE_LIFECYCLES.has(subject.lifecycle);
}

/** True when this person's own account signed a live Portrait grant toward the other. */
function hasOwnSessionGrant(
  subject: PortraitSubjectRow,
  other: PortraitSubjectRow,
  grants: readonly PortraitGrantRow[],
): boolean {
  if (!subject.subjectAccountId || !other.subjectAccountId) return false;
  return grants.some(
    (grant) =>
      grant.granterAccountId === subject.subjectAccountId &&
      grant.recipientAccountId === other.subjectAccountId,
  );
}

function stepsFor(
  subject: PortraitSubjectRow,
  other: PortraitSubjectRow,
  grants: readonly PortraitGrantRow[],
): PortraitStep[] {
  // Without an account of their own nothing else can be true of a person, so
  // the account is the one step named (X3.6: "name the missing account").
  if (!subject.subjectAccountId) return ["account"];
  const missing: PortraitStep[] = [];
  for (const step of PORTRAIT_STEP_ORDER) {
    if (step === "account") continue;
    if (step === "independentLogin" && subject.independentLoginAt === null) missing.push(step);
    if (step === "grant" && !hasOwnSessionGrant(subject, other, grants)) missing.push(step);
    if (step === "acknowledged" && subject.portraitAcknowledgedAt === null) missing.push(step);
  }
  return missing;
}

/**
 * The pure half. The viewer must hold one of the two subjects' accounts; the
 * pair must be open; both records must be live adult records. Then, in
 * order: a pause, the missing steps of both people (the pair's own order,
 * a before b, so both viewers see the same list), and finally ok.
 */
export function evaluatePortraitPreconditions(rows: PortraitPairRows): PortraitPreconditions {
  const { viewerAccountId, pair, a, b, grants } = rows;
  const viewerIsMember =
    (a.subjectAccountId !== null && a.subjectAccountId === viewerAccountId) ||
    (b.subjectAccountId !== null && b.subjectAccountId === viewerAccountId);
  if (!viewerIsMember) return { kind: "not-authorised" };
  if (!OPEN_PAIR_STATUSES.has(pair.status)) return { kind: "not-authorised" };
  if (!usableAdult(a) || !usableAdult(b)) return { kind: "not-authorised" };
  if (a.id === b.id) return { kind: "not-authorised" };
  if (rows.paused) return { kind: "paused" };

  const missing: MissingStep[] = [
    ...stepsFor(a, b, grants).map((step) => ({ subjectId: a.id, step })),
    ...stepsFor(b, a, grants).map((step) => ({ subjectId: b.id, step })),
  ];
  return missing.length === 0 ? { kind: "ok" } : { kind: "missing", missing };
}

/** The viewer's own subject in the pair and the other one, by account. */
export function pairSides(rows: PortraitPairRows): { mine: PortraitSubjectRow; other: PortraitSubjectRow } {
  return rows.a.subjectAccountId === rows.viewerAccountId
    ? { mine: rows.a, other: rows.b }
    : { mine: rows.b, other: rows.a };
}

/** The viewer's own live Portrait grant toward the other person, if any: the one thing they can delete. */
export function ownPortraitGrantId(rows: PortraitPairRows): string | null {
  const { mine, other } = pairSides(rows);
  if (!mine.subjectAccountId || !other.subjectAccountId) return null;
  return (
    rows.grants.find(
      (grant) =>
        grant.granterAccountId === mine.subjectAccountId &&
        grant.recipientAccountId === other.subjectAccountId,
    )?.grantId ?? null
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function subjectRow(row: {
  id: string;
  display_label: string;
  subject_class: string;
  lifecycle: string;
  subject_account_id: string | null;
  portrait_acknowledged_at: string | null;
  independent_login_at: string | null;
}): PortraitSubjectRow {
  return {
    id: row.id,
    displayLabel: row.display_label,
    subjectClass: row.subject_class,
    lifecycle: row.lifecycle,
    subjectAccountId: row.subject_account_id,
    portraitAcknowledgedAt: row.portrait_acknowledged_at,
    independentLoginAt: row.independent_login_at,
  };
}

/**
 * Reads the rows the rule decides on, for one pair and one viewer. An
 * unknown id, a purged pair or a pair whose subjects are gone resolves to
 * null, which the page answers with 404 — the same answer a foreign pair
 * gets from the rule, so nothing signals that a pair exists.
 */
export async function readPortraitPairRows(
  viewerAccountId: string,
  pairId: string,
): Promise<PortraitPairRows | null> {
  if (!UUID.test(pairId)) return null;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: pair } = await admin
    .from("family_pairs")
    .select("id, subject_a_id, subject_b_id, status, pair_revision")
    .eq("id", pairId)
    .maybeSingle();
  if (!pair) return null;

  const { data: subjects } = await admin
    .from("subjects")
    .select(
      "id, display_label, subject_class, lifecycle, subject_account_id, portrait_acknowledged_at, independent_login_at",
    )
    .in("id", [pair.subject_a_id, pair.subject_b_id]);
  const a = (subjects ?? []).find((row) => row.id === pair.subject_a_id);
  const b = (subjects ?? []).find((row) => row.id === pair.subject_b_id);
  if (!a || !b) return null;

  // The live Portrait grants about either subject, joined to their direction
  // rows at the identical revision and to the signer's account
  // (directional-purpose-grant-v1: neither row authorises anything alone).
  const { data: bases } = await admin
    .from("purpose_grants")
    .select("grant_id, grant_revision, data_subject_principal_id")
    .eq("purpose", PORTRAIT_PURPOSE)
    .eq("target_kind", "subject")
    .in("target_id", [a.id, b.id])
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  const baseRows = bases ?? [];
  const grantIds = baseRows.map((row) => row.grant_id);
  const principalIds = [...new Set(baseRows.map((row) => row.data_subject_principal_id))];
  const [{ data: directions }, { data: principals }] = await Promise.all([
    grantIds.length
      ? admin
          .from("directional_grants")
          .select("grant_id, grant_revision, recipient_account_id")
          .in("grant_id", grantIds)
          .eq("status", "current")
          .eq("direction", "subject_to_recipient")
      : { data: [] as { grant_id: string; grant_revision: number; recipient_account_id: string | null }[] },
    principalIds.length
      ? admin.from("subject_principals").select("id, account_id").in("id", principalIds)
      : { data: [] as { id: string; account_id: string | null }[] },
  ]);
  const directionByGrant = new Map(
    (directions ?? []).map((row) => [row.grant_id, row] as const),
  );
  const accountByPrincipal = new Map(
    (principals ?? []).map((row) => [row.id, row.account_id] as const),
  );
  const grants: PortraitGrantRow[] = [];
  for (const base of baseRows) {
    const direction = directionByGrant.get(base.grant_id);
    if (!direction || direction.grant_revision !== base.grant_revision) continue;
    grants.push({
      grantId: base.grant_id,
      granterAccountId: accountByPrincipal.get(base.data_subject_principal_id) ?? null,
      recipientAccountId: direction.recipient_account_id,
    });
  }

  const accounts = [a.subject_account_id, b.subject_account_id].filter(
    (id): id is string => id !== null,
  );
  let paused = false;
  if (accounts.length === 2 && accounts[0] !== accounts[1]) {
    const [low, high] = [...accounts].sort();
    const { data: pause } = await admin
      .from("family_sharing_pauses")
      .select("id")
      .eq("account_low_id", low)
      .eq("account_high_id", high)
      .is("ended_at", null)
      .limit(1)
      .maybeSingle();
    paused = Boolean(pause);
  }

  return {
    viewerAccountId,
    pair: {
      id: pair.id,
      subjectAId: pair.subject_a_id,
      subjectBId: pair.subject_b_id,
      status: pair.status,
      pairRevision: pair.pair_revision,
    },
    a: subjectRow(a),
    b: subjectRow(b),
    grants,
    paused,
  };
}

// ---------------------------------------------------------------------------
// The one-sided readings (brief line 2238). Decided over the same classified
// rows and genotype maps the carrier rule read, only for a gene the rule did
// not already answer.
// ---------------------------------------------------------------------------

export interface OneSidedPerson {
  dataSubjectId: string;
  displayLabel: string;
  genotypes: ReadonlyMap<number, string>;
}

export interface OneSidedInput {
  a: OneSidedPerson;
  b: OneSidedPerson;
  refVariants: readonly CarrierRefVariant[];
  conditions: readonly CarrierCondition[];
  /** The genes the carrier rule already answered: never answered twice. */
  matches: readonly CarrierMatch[];
}

export interface GeneCoverage {
  /** Pathogenic or likely pathogenic classified positions in the gene: the changes Inherit knows. */
  known: number;
  /** Of those, the positions both files report. */
  covered: number;
}

export type OneSidedKind = "no-second-copy" | "not-covered";

export interface OneSidedReading {
  kind: OneSidedKind;
  gene: string;
  conditionId: string | null;
  conditionName: string | null;
  /** The person whose file shows one changed copy. */
  carrier: { dataSubjectId: string; displayLabel: string; variant: CarrierVariantReading };
  /** The person whose file shows no changed copy: at covered positions, or at none of them. */
  other: { dataSubjectId: string; displayLabel: string };
  /** For `not-covered`: the carrier's own position the other file does not report. */
  uncoveredRsid: number | null;
  coverage: GeneCoverage;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/** The pathogenic or likely pathogenic classified positions, grouped by gene and ordered by rsid. */
function pathogenicByGene(
  refVariants: readonly CarrierRefVariant[],
): Map<string, { gene: string; variants: CarrierRefVariant[] }> {
  const byGene = new Map<string, { gene: string; variants: CarrierRefVariant[] }>();
  for (const variant of [...refVariants].sort((left, right) => left.rsid - right.rsid)) {
    if (!variant.clinvarSignificance || !variant.geneSymbol?.trim()) continue;
    if (!isPathogenicClassification(variant.clinvarSignificance)) continue;
    const gene = variant.geneSymbol.trim();
    const key = normalise(gene);
    const group = byGene.get(key);
    if (group) group.variants.push(variant);
    else byGene.set(key, { gene, variants: [variant] });
  }
  return byGene;
}

/** How many known changes in the gene both files report (line 2238's covered count). */
export function geneCoverage(
  gene: string,
  refVariants: readonly CarrierRefVariant[],
  genotypesA: ReadonlyMap<number, string>,
  genotypesB: ReadonlyMap<number, string>,
): GeneCoverage {
  const group = pathogenicByGene(refVariants).get(normalise(gene));
  if (!group) return { known: 0, covered: 0 };
  const covered = group.variants.filter(
    (variant) => genotypesA.has(variant.rsid) && genotypesB.has(variant.rsid),
  ).length;
  return { known: group.variants.length, covered };
}

/** The lowest-rsid pathogenic change this file shows one copy of, or null. */
function oneCopyReading(
  person: OneSidedPerson,
  variants: readonly CarrierRefVariant[],
): CarrierVariantReading | null | "two-copies" {
  let found: CarrierVariantReading | null = null;
  for (const variant of variants) {
    const genotype = person.genotypes.get(variant.rsid);
    if (genotype === undefined) continue;
    const copies = copiesShown(genotype, variant.alt);
    // Two changed copies in one file is a different sentence, which the
    // brief does not give; nothing is rendered rather than a wrong one.
    if (copies === "two copies") return "two-copies";
    if (copies === "one copy" && found === null) {
      found = {
        rsid: variant.rsid,
        classification: (variant.clinvarSignificance ?? "").trim(),
        genotype,
        copies,
      };
    }
  }
  return found;
}

/** True when this file reports at least one of the gene's known positions. */
function reportsAny(person: OneSidedPerson, variants: readonly CarrierRefVariant[]): boolean {
  return variants.some((variant) => person.genotypes.has(variant.rsid));
}

/** True when this file shows a changed copy, or a reading it cannot count, at any of the positions. */
function showsAnyChange(person: OneSidedPerson, variants: readonly CarrierRefVariant[]): boolean {
  return variants.some((variant) => {
    const genotype = person.genotypes.get(variant.rsid);
    return genotype !== undefined && copiesShown(genotype, variant.alt) !== null;
  });
}

function conditionFor(gene: string, conditions: readonly CarrierCondition[]): CarrierCondition | null {
  const wanted = normalise(gene);
  return (
    conditions.find((condition) =>
      condition.geneSymbols.some((symbol) => normalise(symbol) === wanted),
    ) ?? null
  );
}

/**
 * Every gene where exactly one file shows one copy of a pathogenic change
 * and the other shows none: `no-second-copy` when the other file reports at
 * least one of the gene's known positions, `not-covered` when it reports
 * none of them. A gene the carrier rule answered is skipped, as is a gene
 * where either file shows two copies or a reading it cannot count. Ordered
 * by gene, then by nothing else.
 */
/**
 * The genes the carrier rule answered for both people: a match where each
 * file's reading is pathogenic or likely pathogenic. A match refused because
 * the other side's change is harmless or of unknown meaning has not answered
 * the pathogenic carrier's question, so the one-sided reading still renders.
 */
export function answeredGenes(matches: readonly CarrierMatch[]): Set<string> {
  return new Set(
    matches
      .filter(
        (match) =>
          isPathogenicClassification(match.a.variant.classification) &&
          isPathogenicClassification(match.b.variant.classification),
      )
      .map((match) => normalise(match.gene)),
  );
}

export function evaluateOneSided(input: OneSidedInput): OneSidedReading[] {
  const answered = answeredGenes(input.matches);
  const readings: OneSidedReading[] = [];
  const groups = [...pathogenicByGene(input.refVariants).values()].sort((left, right) =>
    left.gene.localeCompare(right.gene, "en"),
  );
  for (const group of groups) {
    if (answered.has(normalise(group.gene))) continue;
    // The no-second-copy sentence presumes a recessive pattern; for any
    // other recorded pattern, or none, the sentence would be false.
    const condition = conditionFor(group.gene, input.conditions);
    if (normalise(condition?.inheritanceMode ?? "") !== "autosomal_recessive") continue;
    const readingA = oneCopyReading(input.a, group.variants);
    const readingB = oneCopyReading(input.b, group.variants);
    if (readingA === "two-copies" || readingB === "two-copies") continue;
    if ((readingA === null) === (readingB === null)) continue;
    const carrier = readingA ? input.a : input.b;
    const carrierReading = (readingA ?? readingB) as CarrierVariantReading;
    const other = readingA ? input.b : input.a;
    // The other file must show no changed copy and no uncountable reading at
    // any known position; the carrier rule would otherwise have answered.
    if (showsAnyChange(other, group.variants)) continue;
    const coverage = geneCoverage(group.gene, input.refVariants, input.a.genotypes, input.b.genotypes);
    const reportsPosition = reportsAny(other, group.variants);
    readings.push({
      kind: reportsPosition ? "no-second-copy" : "not-covered",
      gene: group.gene,
      conditionId: condition?.conditionId ?? null,
      conditionName: condition?.conditionName ?? null,
      carrier: {
        dataSubjectId: carrier.dataSubjectId,
        displayLabel: carrier.displayLabel,
        variant: carrierReading,
      },
      other: { dataSubjectId: other.dataSubjectId, displayLabel: other.displayLabel },
      uncoveredRsid: reportsPosition ? null : carrierReading.rsid,
      coverage,
    });
  }
  return readings;
}
