import fs from "node:fs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "@playwright/test";
import { captureCurrentDensity } from "../e2e/helpers/density-current-capture";
import { densityEarlyCaptureStep, densityEarlyCaptureAsyncStep, type DensityEarlyCaptureObserver } from "./density-early-capture";
import { DENSITY_EARLY_CAPTURE_STAGES, createHostedBootstrapDiagnostics, emitHostedBootstrapFailure,
 hostedBootstrapDiagnosticLine, HOSTED_BOOTSTRAP_PREFIX } from "./comprehension/hosted-owned-diagnostics";
import { freshRuntimeCommandFailure } from "./comprehension/fresh-t6-resources";
import { ciRuntimeSetupFailure } from "./ci-browser-runtime-failure";
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function sink(){
 const capture=createHostedBootstrapDiagnostics(),lines:string[]=[];
 const observe:DensityEarlyCaptureObserver=(stage,metadata)=>emitHostedBootstrapFailure(stage,metadata,"unreturned",line=>{lines.push(line);capture.push(Buffer.from(line+"\n"));});
 return {observe,lines,finish:()=>capture.finish()};
}
const refusal={classification:"setup-refused",exitCode:null,signal:null,cleanup:"unreturned"};
function fixture(kind="none"){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),"density-early-public-"));roots.push(parent);
 const root=path.join(parent,"checkout"),output=path.join(parent,"capture");fs.mkdirSync(path.join(root,"docs"),{recursive:true});
 const register={routes:[{id:"public.home",path:"/",kind:"page",surface:"marketing",stateProfile:"fixture"}],stateProfiles:{fixture:{supported:["empty"]}}};
 const text=kind==="register-parse"?"{":JSON.stringify(kind==="census-plan"?{...register,routes:[]}:register);
 if(kind!=="register-source")fs.writeFileSync(path.join(root,"docs/route-register.json"),text);
 if(kind!=="contract-source")fs.writeFileSync(path.join(root,"docs/density-baseline.json"),kind==="contract-parse"?"{":"{}");
 if(kind==="output-create")fs.mkdirSync(output);
 const original=new Error("PRIVATE_UNKNOWN_SOURCE_REJECTION");
 const source={head:"a".repeat(40),tree:"b".repeat(40),registerSha256:createHash("sha256").update(text).digest("hex")};
 const observeSource=kind==="current-source-sync"?()=>{throw original;}:kind==="current-source-async"?async()=>{throw original;}:async()=>{
  if(kind==="census-write")fs.writeFileSync(path.join(output,"current-census.json"),"existing-not-adoptable");
  return kind==="source-parse"?{...source,privateValue:"PRIVATE_MUST_NOT_ESCAPE"}:kind==="register-match"?{...source,registerSha256:"c".repeat(64)}:source;
 };
 return {root,output,original,source,options:{root,output,fontManifestPath:path.join(parent,"never-read-font"),browser:{} as Browser,
  observeSource:observeSource as ()=>Promise<typeof source>,observeRuntime:vi.fn(),fixtures:[]}};
}
describe("early owned density actual-operation diagnostics",()=>{
 it.each([
  ["output-create","density-capture-output-create"],["register-source","density-capture-register-source"],
  ["register-parse","density-capture-register-parse"],["contract-source","density-capture-contract-source"],
  ["contract-parse","density-capture-contract-parse"],["current-source-sync","density-capture-current-source"],
  ["current-source-async","density-capture-current-source"],["source-parse","density-capture-source-parse"],
  ["register-match","density-capture-register-match"],["census-plan","density-capture-census-plan"],
  ["census-write","density-capture-census-write"],
 ])("reports only the real failed %s boundary (%s), never captures/authority/private values",async(kind,stage)=>{
  const f=fixture(kind),out=sink();
  await expect(captureCurrentDensity({...f.options,observeEarlyCaptureFailure:out.observe})).rejects.toThrow();
  expect(out.finish()).toEqual([{stage,...refusal}]);expect(f.options.observeRuntime).not.toHaveBeenCalled();
  expect(out.lines.join("\n")).not.toContain("PRIVATE");for(const line of out.lines)expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);
  if(kind!=="output-create"&&kind!=="census-write")expect(fs.readdirSync(f.output)).toEqual([]);
  if(kind==="census-write")expect(fs.readFileSync(path.join(f.output,"current-census.json"),"utf8")).toBe("existing-not-adoptable");
 });
 it.each(["sync","async"])("retains the identical original %s error and its original finally cleanup",async mode=>{
  const out=sink(),original=new Error("PRIVATE_ID_TOKEN_STACK"),cleanup=vi.fn();let caught:unknown;
  try{
   if(mode==="sync")densityEarlyCaptureStep("density-capture-census-plan",()=>{throw original;},out.observe);
   else await densityEarlyCaptureAsyncStep("density-capture-current-source",async()=>{throw original;},out.observe);
  }catch(error){caught=error;}finally{cleanup();}
  expect(caught).toBe(original);expect(cleanup).toHaveBeenCalledTimes(1);expect(out.finish()).toEqual([{stage:mode==="sync"?"density-capture-census-plan":"density-capture-current-source",...refusal}]);
 });
 it("does not read error message/stack/output/metadata accessors or impersonated fields",()=>{
  const read=vi.fn(()=>{throw new Error("PRIVATE_ACCESSOR");}),original=Object.create(null);
  for(const key of ["message","stack","stderr","stdout","runtimeStage","classification","exitCode","signal","env","id"])
   Object.defineProperty(original,key,{get:read});
  const out=sink();let caught:unknown;try{densityEarlyCaptureStep("density-capture-register-source",()=>{throw original;},out.observe);}catch(error){caught=error;}
  expect(caught).toBe(original);expect(read).not.toHaveBeenCalled();expect(out.finish()).toEqual([{stage:"density-capture-register-source",...refusal}]);
 });
 it("does not inspect throwing proxy descriptors/prototype and still retains the original refusal",()=>{
  const read=vi.fn(()=>{throw new Error("PRIVATE_PROXY");}),original=new Proxy({}, {get:read,getOwnPropertyDescriptor:read,getPrototypeOf:read});
  const out=sink();let caught:unknown;try{densityEarlyCaptureStep("density-capture-contract-source",()=>{throw original;},out.observe);}catch(error){caught=error;}
  expect(caught).toBe(original);expect(read).not.toHaveBeenCalled();expect(out.finish()).toEqual([{stage:"density-capture-contract-source",...refusal}]);
 });
 it.each(["sync","async"])("diagnostic sink failure cannot replace the original %s rejection or skip cleanup",async mode=>{
  const original=new Error("ORIGINAL_PRIVATE"),observe=vi.fn(()=>{throw new Error("SINK_PRIVATE");}),cleanup=vi.fn();let caught:unknown;
  try{if(mode==="sync")densityEarlyCaptureStep("density-capture-output-create",()=>{throw original;},observe);
   else await densityEarlyCaptureAsyncStep("density-capture-current-source",async()=>{throw original;},observe);
  }catch(error){caught=error;}finally{cleanup();}
  expect(caught).toBe(original);expect(observe).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledTimes(1);
 });
 it("projects actual branded native metadata to exactly three fields before the existing emitter/collector",()=>{
  const original=ciRuntimeSetupFailure("runtime-image",freshRuntimeCommandFailure("exit-nonzero",7));
  // ciRuntimeSetupFailure does not adopt the separate command brand; use its
  // real guard classification while deliberately retaining its runtimeStage.
  const observed=vi.fn< DensityEarlyCaptureObserver >();let caught:unknown;
  try{densityEarlyCaptureStep("density-capture-current-source",()=>{throw original;},observed);}catch(error){caught=error;}
  expect(caught).toBe(original);expect(Object.keys(observed.mock.calls[0][1]).sort()).toEqual(["classification","exitCode","signal"]);
  expect(observed.mock.calls[0][1]).toEqual({classification:"setup-refused",exitCode:null,signal:null});expect(Object.isFrozen(observed.mock.calls[0][1])).toBe(true);
 });
 it.each(["guard","invalid-response"])("maps actual branded %s refusal while dropping runtimeStage",kind=>{
  let reason:unknown;if(kind==="guard"){try{assert(false,"PRIVATE_GUARD");}catch(error){reason=error;}}else reason=new SyntaxError("PRIVATE_JSON");
  const original=ciRuntimeSetupFailure("build-identity",reason),out=sink();let caught:unknown;
  try{densityEarlyCaptureStep("density-capture-source-parse",()=>{throw original;},out.observe);}catch(error){caught=error;}
  expect(caught).toBe(original);expect(out.finish()).toEqual([{stage:"density-capture-source-parse",...refusal}]);expect(out.lines.join("\n")).not.toContain("PRIVATE");
 });
 it("retains the actual branded process class without forwarding command/output fields",()=>{
  const original=freshRuntimeCommandFailure("exit-nonzero",7),out=sink();
  expect(()=>densityEarlyCaptureStep("density-capture-contract-source",()=>{throw original;},out.observe)).toThrow();
  expect(out.finish()).toEqual([{stage:"density-capture-contract-source",classification:"exit-nonzero",exitCode:7,signal:null,cleanup:"unreturned"}]);
 });
 it.each(["sync","async"])("successful %s operations return the exact original object and emit nothing",async mode=>{
  const result=Object.freeze({actual:"same-reference"}),operation=vi.fn(()=>result),out=sink();
  const returned=mode==="sync"?densityEarlyCaptureStep("density-capture-register-parse",operation,out.observe)
   :await densityEarlyCaptureAsyncStep("density-capture-current-source",async()=>operation(),out.observe);
  expect(returned).toBe(result);expect(operation).toHaveBeenCalledTimes(1);expect(out.finish()).toEqual([]);
 });
 it("the default callback-free path emits nothing and retains exact rejection",()=>{
  const original=new Error("PRIVATE");let caught:unknown;try{densityEarlyCaptureStep("density-capture-register-match",()=>{throw original;});}catch(error){caught=error;}
  expect(caught).toBe(original);
 });
 it("successful early preflight returns the exact original missing-provider HOLD/census without opening a state",async()=>{
  const f=fixture(),out=sink(),result=await captureCurrentDensity({...f.options,observeEarlyCaptureFailure:out.observe});
  expect(result).toEqual({status:"HOLD_CURRENT_DENSITY_FIXTURES",g2_5Acceptance:false,captures:0,pageRoutes:1,requiredCaptureCount:2,
   holds:[{routeId:"public.home",state:"empty",reason:"native-state-fixture-missing"}]});
  expect(out.finish()).toEqual([]);expect(f.options.observeRuntime).not.toHaveBeenCalled();
  const saved=JSON.parse(fs.readFileSync(path.join(f.output,"current-census.json"),"utf8"));
  expect(saved.source).toEqual(f.source);expect(saved.requiredCaptureCount).toBe(2);expect(saved.states).toEqual([{routeId:"public.home",state:"empty"}]);
 });
 it("all ten new fixed stages use the unchanged strict five-field/512-byte/16-frame/EOF contract",()=>{
  expect(DENSITY_EARLY_CAPTURE_STAGES).toHaveLength(10);expect(new Set(DENSITY_EARLY_CAPTURE_STAGES).size).toBe(10);const capture=createHostedBootstrapDiagnostics();
  for(let i=0;i<30;i++){
   const value={stage:DENSITY_EARLY_CAPTURE_STAGES[i%10],...refusal};const line=hostedBootstrapDiagnosticLine(value)!;
   expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);expect(Object.keys(JSON.parse(line.slice(HOSTED_BOOTSTRAP_PREFIX.length))).sort()).toEqual(["classification","cleanup","exitCode","signal","stage"]);
   capture.push(Buffer.from(line+"\n"));expect(hostedBootstrapDiagnosticLine({...value,privateMessage:"PRIVATE"})).toBeNull();
  }
  const records=capture.finish();expect(records).toHaveLength(16);capture.push(Buffer.from(hostedBootstrapDiagnosticLine({stage:DENSITY_EARLY_CAPTURE_STAGES[0],...refusal})!+"\n"));expect(capture.finish()).toEqual(records);
  expect(hostedBootstrapDiagnosticLine({stage:"density-capture-private-source",...refusal})).toBeNull();
 });
});
