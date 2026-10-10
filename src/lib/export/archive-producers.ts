import {z} from "zod";
import source from "../../../docs/export-archive-producers.json";
import {plannedArchiveMembers} from "./member-plan";

const producer=z.object({origin:z.string().min(20),reader:z.string().min(10),
 plannedMembers:z.array(z.string().min(1)).min(1)}).strict();
const schema=z.object({version:z.literal("export-archive-producers-v1"),producers:z.object({
 "legacy-account":producer,"approved-unbound":producer,"claimed-bound-subject":producer}).strict()}).strict();
export type ArchiveProducer=keyof z.infer<typeof schema>["producers"];
/** Every table/object plan member must have an implemented eligible producer.
 * This registry does not authorize a job or excuse a missing archive member.
 * Each producer's real ZIP tests prove its assigned patterns and content.
 * Unimplemented whole-account/non-self classes keep their existing refusal. */
export function parseArchiveProducers(value:unknown,planned:ReadonlySet<string>=plannedArchiveMembers()){
 const parsed=schema.parse(value),covered=new Set<string>();
 // Both complete claimant producers must really emit their retained audit and
 // printable history; a second origin cannot cover up an omitted first origin.
 const claimantPatterns=new Set(["manifest.json","legal-audit.json","originals/","variants/",
  "subjects/{subject_id}/audit-log.json","subjects/{subject_id}/reports.txt"]);
 for(const name of ["approved-unbound","claimed-bound-subject"] as const){
  const members=new Set(parsed.producers[name].plannedMembers);
  if(members.size!==claimantPatterns.size||[...claimantPatterns].some(pattern=>!members.has(pattern)))
   throw new Error("archive_producer_member_unassigned");
 }
 for(const entry of Object.values(parsed.producers)){
  if(new Set(entry.plannedMembers).size!==entry.plannedMembers.length)throw new Error("duplicate_archive_producer_member");
  for(const name of entry.plannedMembers){if(!planned.has(name))throw new Error("unknown_archive_producer_member");covered.add(name);}
 }
 if(covered.size!==planned.size||[...planned].some(name=>!covered.has(name)))throw new Error("archive_producer_member_unassigned");
 return parsed;
}
const plan=parseArchiveProducers(source);
export function producerArchiveMembers(name:ArchiveProducer):Set<string>{return new Set(plan.producers[name].plannedMembers);}
/** Resolve only this producer's declared patterns. Real subject UUIDs resolve
 * templates; arbitrary strings, nested extras and foreign paths cannot count. */
export function generatedProducerMembers(names:readonly string[],producer:ArchiveProducer):Set<string>{
 const patterns=producerArchiveMembers(producer),found=new Set<string>();
 for(const pattern of patterns){
  const parts=pattern.split("{subject_id}"),prefix=parts[0],suffix=parts[1];
  if(names.some(name=>suffix===undefined?pattern.endsWith("/")?name.startsWith(pattern)&&name.length>pattern.length:name===pattern:
   name.startsWith(prefix)&&name.endsWith(suffix)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(name.slice(prefix.length,name.length-suffix.length))))found.add(pattern);
 }
 return found;
}
