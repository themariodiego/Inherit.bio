import "server-only";
import { assertEmbryoDto as current, type EmbryoFinding as CurrentFinding, type QcDto as CurrentQc } from "@/lib/embryos/policy";
import { assertEmbryoDto as legacy, type EmbryoFinding as LegacyFinding, type QcDto as LegacyQc,
  type RscEmbryoDetail as LegacyDetail } from "@/lib/embryos/historical-policy-v1";

export type HistoricalFinding = Omit<LegacyFinding,"finding"> & { finding: LegacyFinding["finding"]|CurrentFinding["finding"] };
export type HistoricalQc = LegacyQc|CurrentQc;
export type HistoricalDetail = Omit<LegacyDetail,"findings"|"qc"> & { findings:HistoricalFinding[];qc:HistoricalQc };
const unavailable = (): never => { throw new Error("export unavailable"); };

/** JSON candidates only; the policy walkers never invoke a getter or cycle. */
export function assertHistoricalJson(value:unknown,seen=new Set<object>(),depth=0):void {
  if(depth>16)return unavailable();
  if(value===null||typeof value==="string"||typeof value==="boolean")return;
  if(typeof value==="number"&&Number.isFinite(value))return;
  if(!value||typeof value!=="object"||seen.has(value))return unavailable();seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>10000||Reflect.ownKeys(value).length!==value.length+1)return unavailable();
    for(let index=0;index<value.length;index++){
      const field=Object.getOwnPropertyDescriptor(value,String(index));
      if(!field||!field.enumerable||!("value" in field))return unavailable();assertHistoricalJson(field.value,seen,depth+1);
    }
  }else{
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return unavailable();
    for(const key of Reflect.ownKeys(value)){
      const field=Object.getOwnPropertyDescriptor(value,key)!;
      if(typeof key!=="string"||!field.enumerable||!("value" in field))return unavailable();assertHistoricalJson(field.value,seen,depth+1);
    }
  }
  seen.delete(value);
}
export function readHistoricalFinding(value:unknown):HistoricalFinding {
  assertHistoricalJson(value);
  if(!value||typeof value!=="object"||Array.isArray(value))return unavailable();
  const source=(value as Record<string,unknown>).finding;
  const versioned=source!==null&&typeof source==="object"&&(Object.hasOwn(source,"schema_version")||Object.hasOwn(source,"figure_basis"));
  // A present malformed/new receipt never falls back into the legacy branch.
  return versioned?current("EmbryoFinding",value as CurrentFinding):legacy("EmbryoFinding",value as LegacyFinding);
}
export function readHistoricalQc(value:unknown):HistoricalQc {
  assertHistoricalJson(value);
  if(!value||typeof value!=="object"||Array.isArray(value))return unavailable();
  return Object.hasOwn(value,"figure_basis")?current("qc",value as CurrentQc):legacy("qc",value as LegacyQc);
}
export function readHistoricalDetail(value:unknown):HistoricalDetail {
  assertHistoricalJson(value);
  if(!value||typeof value!=="object"||Array.isArray(value))return unavailable();
  const row=value as Record<string,unknown>;
  if(!Array.isArray(row.findings))return unavailable();
  const findings=row.findings.map(readHistoricalFinding),qc=readHistoricalQc(row.qc);
  const legacyFindings=findings.map(source=>{
    if(source.finding===null)return source;
    const {schema_version:_v,figure_basis:_b,...original}=source.finding as unknown as Record<string,unknown>;void _v;void _b;
    return {...source,finding:original};
  });
  const {figure_basis:_b,...originalQc}=qc as unknown as Record<string,unknown>;void _b;
  // Strip only already-validated saved version receipts in the validation view.
  // No receipt/value is manufactured, and the original record is returned.
  legacy("rscEmbryoDetail",{...row,findings:legacyFindings,qc:originalQc});
  return value as HistoricalDetail;
}
export function historicalFindingBasis(finding:HistoricalFinding["finding"]){
  if(finding!==null&&"schema_version" in finding)return {sourceShape:"finding-v2" as const,
    schemaVersion:finding.schema_version,figureBasis:structuredClone(finding.figure_basis)};
  return {sourceShape:"legacy-v1" as const,figureBasis:null,classificationDisposition:"unrecorded" as const};
}
