import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {SubjectExports} from "./subject-exports";
import {SUBJECT_EXPORT_HEADING,SUBJECT_EXPORT_JOINT_RESULTS,SUBJECT_EXPORT_SELF_LABEL,SUBJECT_EXPORT_ADULT_LABEL} from "@/copy/subjects/subject-export";

describe("one-record export settings section",()=>{
 it("states the joint-results refusal in place of the action and keeps every proof out of the HTML",()=>{
  const self=randomUUID(),joint=randomUUID(),adult=randomUUID();
  const html=renderToStaticMarkup(createElement(SubjectExports,{items:[
   {subjectId:self,self:true,label:null,route:`/api/subjects/${self}/export`,control:{available:true,create:{operation:"create",nonce:"synthetic-action-proof",csrf:"synthetic-csrf-proof"}}},
   {subjectId:joint,self:false,label:"Synthetic adult",route:`/api/subjects/${joint}/export`,control:{available:false,refusal:"jointResults"}},
   {subjectId:adult,self:false,label:null,route:`/api/subjects/${adult}/export`,control:{available:false}}]}));
  expect(html).toContain(SUBJECT_EXPORT_HEADING);expect(html).toContain(SUBJECT_EXPORT_SELF_LABEL);
  expect(html).toContain("Synthetic adult");expect(html).toContain(SUBJECT_EXPORT_ADULT_LABEL);
  expect(html.split(SUBJECT_EXPORT_JOINT_RESULTS.replaceAll("'","&#x27;"))).toHaveLength(2);
  expect(html.match(/data-slot="account-export-control"/gu)).toHaveLength(2);
  for(const hidden of ["synthetic-action-proof","synthetic-csrf-proof","href=","/api/subjects/"])expect(html).not.toContain(hidden);
 });
});
