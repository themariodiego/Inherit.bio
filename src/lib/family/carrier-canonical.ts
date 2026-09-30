import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { carrierReference, exactGenotypes, parseCarrierAssertionRows, type CarrierCall } from "./carrier-assertions";
import {
  MAX_CLASSIFIED_POSITIONS,
  countPositionsBothCover,
  evaluateCarrierPairs,
  type CarrierCondition,
  type CarrierPairPerson,
  type CarrierPairSummary,
  type CarrierRefVariant,
} from "./carrier-pair";
import type { DeclaredChromosomalSex } from "./chromosomal-sex";
import { storedRohMeasure, type StoredRohMeasure } from "./roh";

/**
 * The carrier read over each Portrait person's CURRENT PREPARED SOURCE
 * (docs/carrier-importer-design.md, point 8). The legacy reader reads only the
 * files a pair captured before prepared uploads existed; this one reads the
 * upload a person has now.
 *
 * Everything that decides what may be read is in the database:
 * `public.family_portrait_carrier_calls_v1` proves the readiness receipt the
 * page captured (both current Portrait grants, sessions, acknowledgements,
 * independent logins and exact prepared sources, under the same locks), then
 * reads each source at the reviewed rule's loci only. This module passes the
 * page's own session and receipt and nothing else: no locus, file or subject
 * comes from here. It then reads each file by exact allele and asks the pair
 * rule, with each file's own stored runs measure.
 */

const uuid = z.uuid();
const nullableNumber = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/).transform(Number)]).nullable();
const callSchema = z.object({ chrom: z.number().int().min(1).max(25), pos: z.number().int().positive().safe(),
  ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string().max(200) }).strict();
const observedSchema = callSchema.extend({ ref: z.string(), alt: z.string(), usable: z.boolean() }).strict();
const sideSchema = z.object({
  subjectId: uuid,
  source: z.object({
    fileId: uuid,
    runs: z.object({ status: z.string().nullable(), reason: z.string().nullable(), totalBases: nullableNumber,
      coveredBases: nullableNumber, fraction: nullableNumber }).strict(),
    variants: z.array(callSchema).max(100_000),
    observed: z.array(observedSchema).max(100_000),
  }).strict().nullable(),
}).strict();
const responseSchema = z.object({ receipt: z.string().regex(/^[0-9a-f]{64}$/), assertions: z.unknown(),
  a: sideSchema, b: sideSchema }).strict();

type Rpc = (name: "family_portrait_carrier_calls_v1", args: { p_account_id: string; p_session_id: string;
  p_pair_id: string; p_counterpart_account_id: string; p_expected: string }) => PromiseLike<{ data: unknown; error: unknown }>;

type Side = z.infer<typeof sideSchema>;

function sideCalls(side: Side): CarrierCall[] {
  if (!side.source) return [];
  const fileId = side.source.fileId;
  return [
    ...side.source.variants.map((call) => ({ ...call, fileId })),
    ...side.source.observed.map((call) => ({ ...call, fileId })),
  ];
}

function sideRuns(side: Side): StoredRohMeasure[] {
  if (!side.source) return [];
  const runs = side.source.runs;
  return [storedRohMeasure({ roh_status: runs.status, roh_reason: runs.reason, roh_total_bases: runs.totalBases,
    roh_covered_bases: runs.coveredBases, roh_fraction: runs.fraction })];
}

export interface CanonicalCarrierRead {
  summary: CarrierPairSummary;
  refVariants: CarrierRefVariant[];
  conditions: CarrierCondition[];
}

/**
 * The pair rule over two prepared sources, or null when the database refused
 * the read (a changed receipt, grant, session or source) or answered in a
 * shape this module does not accept. Null is never read as "no carrier".
 */
export async function resolveCanonicalCarrierPair(
  db: Db,
  request: { pairId: string; counterpartAccountId: string; receipt: string },
  a: Omit<CarrierPairPerson, "chromosomalSex">,
  b: Omit<CarrierPairPerson, "chromosomalSex">,
  declaredSex: (subjectIds: [string, string]) => Promise<ReadonlyMap<string, DeclaredChromosomalSex>>,
): Promise<CanonicalCarrierRead | null> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return null;
    const response = await (db.rpc.bind(db) as unknown as Rpc)("family_portrait_carrier_calls_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_pair_id: request.pairId,
      p_counterpart_account_id: request.counterpartAccountId, p_expected: request.receipt });
    const parsed = responseSchema.safeParse(response.data);
    if (response.error || !parsed.success || parsed.data.receipt !== request.receipt
      || parsed.data.a.subjectId !== a.dataSubjectId || parsed.data.b.subjectId !== b.dataSubjectId) return null;
    const rows = parseCarrierAssertionRows(parsed.data.assertions);
    if (!rows || rows.length > MAX_CLASSIFIED_POSITIONS) return null;
    const reference = carrierReference(rows);
    const empty = { a: new Map<number, string>(), b: new Map<number, string>() };
    if (!rows.length) {
      return { ...reference, summary: { matches: [], classifiedPositions: 0, positionsBothCover: 0, genotypes: empty } };
    }
    const readA = exactGenotypes(reference.refVariants, sideCalls(parsed.data.a));
    const readB = exactGenotypes(reference.refVariants, sideCalls(parsed.data.b));
    // Each person's declared chromosomal sex, only now that a reviewed
    // position could produce a cross, and never written into a result (D-031).
    const sex = await declaredSex([a.dataSubjectId, b.dataSubjectId]);
    const fileIds = (side: Side) => side.source ? [side.source.fileId] : [];
    const inputFilesByGene = new Map<string, { a: string[]; b: string[] }>();
    for (const variant of reference.refVariants) {
      if (!variant.geneSymbol) continue;
      const current = inputFilesByGene.get(variant.geneSymbol) ?? { a: [], b: [] };
      current.a = [...new Set([...current.a, ...(readA.inputFilesByKey.get(variant.rsid) ?? [])])].sort();
      current.b = [...new Set([...current.b, ...(readB.inputFilesByKey.get(variant.rsid) ?? [])])].sort();
      inputFilesByGene.set(variant.geneSymbol, current);
    }
    const summary: CarrierPairSummary = {
      matches: evaluateCarrierPairs({
        a: { ...a, chromosomalSex: sex.get(a.dataSubjectId) ?? null, genotypes: readA.genotypes, runs: sideRuns(parsed.data.a) },
        b: { ...b, chromosomalSex: sex.get(b.dataSubjectId) ?? null, genotypes: readB.genotypes, runs: sideRuns(parsed.data.b) },
        refVariants: reference.refVariants,
        conditions: reference.conditions,
      }),
      classifiedPositions: rows.length,
      positionsBothCover: countPositionsBothCover(readA.genotypes, readB.genotypes),
      genotypes: { a: readA.genotypes, b: readB.genotypes },
      inputFileIds: { a: readA.genotypes.size ? fileIds(parsed.data.a) : [], b: readB.genotypes.size ? fileIds(parsed.data.b) : [] },
      checkedFileIds: { a: fileIds(parsed.data.a), b: fileIds(parsed.data.b) },
      inputFilesByGene,
      runsInputFileIds: { a: fileIds(parsed.data.a), b: fileIds(parsed.data.b) },
    };
    return { ...reference, summary };
  } catch {
    return null;
  }
}
