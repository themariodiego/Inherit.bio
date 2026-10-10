import {describe,expect,it} from "vitest";
import source from "../../../docs/export-archive-producers.json";
import {plannedArchiveMembers} from "./member-plan";
import {parseArchiveProducers,producerArchiveMembers,generatedProducerMembers} from "./archive-producers";

describe("every archive member has an exact implemented eligible producer",()=>{
 it("holds complete union equality with the unchanged table/object plan",()=>{
  const plan=parseArchiveProducers(source);
  expect(new Set(Object.values(plan.producers).flatMap(entry=>entry.plannedMembers))).toEqual(plannedArchiveMembers());
 });
 it("fails when a newly registered class has no producing contract",()=>{
  expect(()=>parseArchiveProducers(source,new Set([...plannedArchiveMembers(),"subjects/{subject_id}/new-record.json"])))
   .toThrow("archive_producer_member_unassigned");
 });
 it.each(["approved-unbound","claimed-bound-subject"] as const)("cannot suppress a missing %s producer or invent an unknown pattern",name=>{
  const missing=structuredClone(source);missing.producers[name].plannedMembers.pop();
  expect(()=>parseArchiveProducers(missing)).toThrow("archive_producer_member_unassigned");
  const unknown=structuredClone(source);unknown.producers["legacy-account"].plannedMembers.push("made-up.json");
  expect(()=>parseArchiveProducers(unknown)).toThrow("unknown_archive_producer_member");
 });
 it("refuses duplicate declarations and an unreviewed additional origin",()=>{
  const duplicate=structuredClone(source);duplicate.producers["legacy-account"].plannedMembers.push("manifest.json");
  expect(()=>parseArchiveProducers(duplicate)).toThrow("duplicate_archive_producer_member");
  expect(()=>parseArchiveProducers({...source,producers:{...source.producers,unreviewed:source.producers["approved-unbound"]}})).toThrow();
 });
 it("only genuine UUID partition paths resolve claimant templates",()=>{
  const paths=["manifest.json","legal-audit.json","variants/file.csv","originals/file/source.jsonl",
   "subjects/38000000-0000-4000-8000-000000000002/audit-log.json","subjects/38000000-0000-4000-8000-000000000002/reports.txt"];
  expect(generatedProducerMembers(paths,"approved-unbound")).toEqual(producerArchiveMembers("approved-unbound"));
  for(const bad of ["subjects/{subject_id}/reports.txt","subjects/not-a-subject/reports.txt","subjects/38000000-0000-4000-8000-000000000002/nested/reports.txt"]){
   expect(generatedProducerMembers([...paths.slice(0,-1),bad],"approved-unbound")).not.toEqual(producerArchiveMembers("approved-unbound"));
  }
 });
});
