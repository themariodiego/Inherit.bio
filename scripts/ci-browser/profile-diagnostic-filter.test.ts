import {spawn} from "node:child_process";
import {once} from "node:events";
import {readFileSync} from "node:fs";
import {PassThrough} from "node:stream";
import {expect,it,vi} from "vitest";
import {PROFILE_DIAGNOSTIC_LINE_BYTES,PROFILE_DIAGNOSTIC_PREFIX,profileDiagnosticLine}
  from "../../src/lib/future-person/identity-profile-diagnostic-contract";
import {forwardProfileDiagnostics,PROFILE_DIAGNOSTIC_RECORD_LIMIT,profileDiagnosticFilter} from "./profile-diagnostic-filter";

const wire=(value:unknown)=>PROFILE_DIAGNOSTIC_PREFIX+JSON.stringify(value);
const rpc=wire({stage:"rpc",code:"40P01"}),proof=wire({stage:"proof",code:"unavailable"});
const schema=wire({stage:"schema",issues:[{code:"custom",field:"items.*.saveContext.currentProfileId"}]});
it("forwards the exact closed three stage records across every possible chunk split",()=>{
  for(const line of [rpc,proof,schema])for(let split=0;split<=line.length+1;split++){
    const emit=vi.fn(),filter=profileDiagnosticFilter(emit),bytes=Buffer.from(line+"\n");
    filter.write(bytes.subarray(0,split));filter.write(bytes.subarray(split));filter.end();
    expect(emit.mock.calls).toEqual([[line]]);
  }
});
it.each([
  {stage:"rpc",code:"private@example.test"},{stage:"rpc",code:"40P01",message:"protected"},
  {stage:"proof",code:"42501"},{stage:"proof",code:"unavailable",accountId:"protected"},
  {stage:"schema",issues:[{code:"custom",field:"items.19.currentProfileId"}]},
  {stage:"schema",issues:[{code:"custom",field:"items.*.private@example.test"}]},
  {stage:"schema",issues:[{code:"custom",field:"items.*.saveContext.subjectId.subjectId.subjectId"}]},
  {stage:"schema",issues:[{code:"custom",field:"items.*",value:"protected"}]},
  {stage:"schema",issues:[{code:"private",field:"items.*"}]},
  {stage:"schema",issues:Array.from({length:9},()=>({code:"custom",field:"items.*"}))},
  {stage:"schema",issues:[null]},[],null,{stage:"private",code:"unavailable"},
])("refuses unapproved fields, values, identities and shape %#",value=>{
  expect(profileDiagnosticLine(value)).toBeNull();
  const emit=vi.fn(),filter=profileDiagnosticFilter(emit);filter.write(wire(value)+"\n");filter.end();
  expect(emit).not.toHaveBeenCalled();
});
it("discards ordinary logs, prefixes inside raw output, malformed and truncated lines",()=>{
  const emit=vi.fn(),filter=profileDiagnosticFilter(emit);
  filter.write("Authorization: private-token\nprivate path "+rpc+"\n"+PROFILE_DIAGNOSTIC_PREFIX+"{bad}\n");
  filter.write(schema+"\n"+proof);filter.end();filter.write("\n"+rpc+"\n");
  expect(emit.mock.calls).toEqual([[schema]]);
});
it("requires the canonical frame and refuses duplicate-key or escaped-value payloads instead of relaying raw JSON",()=>{
  const emit=vi.fn(),filter=profileDiagnosticFilter(emit);
  filter.write(PROFILE_DIAGNOSTIC_PREFIX+'{"stage":"rpc","code":"private contact","code":"40P01"}\n');
  filter.write(PROFILE_DIAGNOSTIC_PREFIX+'{"stage":"rpc","code":"40\\u005001"}\n');
  filter.write(PROFILE_DIAGNOSTIC_PREFIX+'{ "stage":"proof","code":"unavailable"}\n');
  filter.write(rpc+"\n");filter.end();expect(emit.mock.calls).toEqual([[rpc]]);
});
it("rejects oversize lines through their newline, even with an approved-looking suffix, and resumes at a new line",()=>{
  const emit=vi.fn(),filter=profileDiagnosticFilter(emit);
  filter.write("x".repeat(PROFILE_DIAGNOSTIC_LINE_BYTES));filter.write(rpc+"\n"+proof+"\n");
  filter.write(Buffer.from("private 😀 "+rpc+"\n"));filter.end();expect(emit.mock.calls).toEqual([[proof]]);
});
it("shares the fixed output budget across both actual stream inputs, and discards close-truncated data",()=>{
  const a=new PassThrough(),b=new PassThrough(),emit=vi.fn(),close=forwardProfileDiagnostics([a,b],emit);
  for(let i=0;i<PROFILE_DIAGNOSTIC_RECORD_LIMIT+20;i++)(i%2?a:b).write(rpc+"\n");
  expect(emit).toHaveBeenCalledTimes(PROFILE_DIAGNOSTIC_RECORD_LIMIT);
  close();a.write(proof+"\n");b.write(schema+"\n");expect(emit).toHaveBeenCalledTimes(PROFILE_DIAGNOSTIC_RECORD_LIMIT);
  a.destroy();b.destroy();
});
it("does not inspect serialization hooks or expose throwing diagnostic accessors",()=>{
  const serialize=vi.fn(()=>"protected");
  expect(profileDiagnosticLine({stage:"proof",code:"unavailable",toJSON:serialize})).toBeNull();
  expect(serialize).not.toHaveBeenCalled();
  expect(profileDiagnosticLine(Object.defineProperty({},"stage",{get(){throw new Error("protected");}}))).toBeNull();
  const filter=profileDiagnosticFilter(()=>{throw new Error("sink unavailable");});
  expect(()=>filter.write(rpc+"\n")).not.toThrow();filter.end();
});
it("passes only closed records through two genuine Node child-process pipe hops",async()=>{
  const producer=spawn(process.execPath,["-e",`const a=${JSON.stringify(rpc+"\n")},b=${JSON.stringify(schema+"\n")};
    process.stdout.write('private cookie=credential\\n'+a.slice(0,19));
    process.stderr.write('private provider payload\\n');
    setTimeout(()=>{process.stdout.write(a.slice(19));process.stderr.write(b);},10);`],{stdio:["ignore","pipe","pipe"]});
  const relay=spawn(process.execPath,["-e",`process.stdout.write('private relay log\\n');
    process.stderr.write('private relay stderr\\n');process.stdin.on('data',chunk=>process.stdout.write(chunk));`],{stdio:["pipe","pipe","pipe"]});
  const producerClose=once(producer,"close"),relayClose=once(relay,"close"),output:string[]=[];
  const stopInside=forwardProfileDiagnostics([producer.stdout,producer.stderr],line=>relay.stdin.write(line+"\n"));
  const stopHost=forwardProfileDiagnostics([relay.stdout,relay.stderr],line=>output.push(line));
  try{
    expect((await producerClose)[0]).toBe(0);relay.stdin.end();expect((await relayClose)[0]).toBe(0);
    expect(output.sort()).toEqual([rpc,schema].sort());expect(output.join("\n")).not.toMatch(/cookie|credential|provider|payload|relay/u);
  }finally{stopInside();stopHost();producer.kill();relay.kill();}
});
it("wires both actual launcher boundaries to the closed filter without forwarding raw app pipes",()=>{
  const source=readFileSync(new URL("./server.mts",import.meta.url),"utf8");
  expect(source).toContain("forwardProfileDiagnostics([child.stdout,child.stderr]");
  expect(source).toContain("forwardProfileDiagnostics([app.stdout,app.stderr]");
  expect(source).not.toMatch(/child\.stdout\?\.pipe\(process\.stdout\)|app\.stdout\?\.resume\(\); app\.stderr\?\.resume\(\)/u);
});


import {Console} from "node:console";
import {Writable} from "node:stream";
import {EMBRYO_READ_DIAGNOSTIC_PREFIX,embryoReadDiagnosticLine,closedEmbryoReadDiagnostic} from "./profile-diagnostic-filter";
const readTables=["embryo_carrier_library","embryo_carrier_hold","embryo_statistical_coverage","embryo_qc","embryo_scores"] as const;
function realReadConsole(table:string){let output="";const sink=new Writable({write(chunk,_encoding,done){output+=chunk.toString();done();}});
 new Console({stdout:sink,stderr:sink}).error("embryo.read-failed",{route:"embryos.compare",table});return output;}
it.each(readTables)("carries the real %s Console catch through both existing launcher filters",table=>{
 const raw=realReadConsole(table),expected=embryoReadDiagnosticLine({route:"embryos.compare",table})!;
 for(let split=0;split<=Buffer.byteLength(raw);split++){
  const output:string[]=[],inside=profileDiagnosticFilter(line=>{const host=profileDiagnosticFilter(value=>output.push(value));
   for(const byte of Buffer.from(line+"\n"))host.write(Buffer.from([byte]));host.end();},true);
  inside.write(Buffer.from(raw).subarray(0,split));inside.write(Buffer.from(raw).subarray(split));inside.end();expect(output).toEqual([expected]);
 }
 expect(Buffer.byteLength(expected+"\n")).toBeLessThanOrEqual(512);
});
it("recognizes the original catch only at the real app hop and never treats unrelated private text as a frame",()=>{
 const emit=vi.fn(),outside=profileDiagnosticFilter(emit);outside.write(realReadConsole("embryo_qc"));outside.end();expect(emit).not.toHaveBeenCalled();
 const inside=profileDiagnosticFilter(emit,true);
 for(const raw of [realReadConsole("private-table"),realReadConsole("embryo_qc").replace("embryos.compare","other.route"),
  "private "+realReadConsole("embryo_qc"),realReadConsole("embryo_qc").replace(" }"," , message: 'PRIVATE' }"),
  "x".repeat(PROFILE_DIAGNOSTIC_LINE_BYTES)+realReadConsole("embryo_qc"),realReadConsole("embryo_qc").trimEnd()])inside.write(raw);
 inside.end();expect(emit).not.toHaveBeenCalled();
});
it("refuses forged, extra, accessor, missing and noncanonical embryo read records",()=>{
 const getter=vi.fn(()=>"embryo_qc"),emit=vi.fn();
 for(const value of [null,{}, {route:"embryos.compare"},{route:"private",table:"embryo_qc"},
  {route:"embryos.compare",table:"private"},{route:"embryos.compare",table:"embryo_qc",message:"PRIVATE"},
  Object.defineProperty({route:"embryos.compare"},"table",{get:getter}),new Proxy({},{ownKeys(){throw new Error("PRIVATE");}})])
  expect(closedEmbryoReadDiagnostic(value)).toBeNull();
 expect(getter).not.toHaveBeenCalled();
 const filter=profileDiagnosticFilter(emit);
 for(const wire of [EMBRYO_READ_DIAGNOSTIC_PREFIX+'{"route":"embryos.compare","table":"private","table":"embryo_qc"}',
  EMBRYO_READ_DIAGNOSTIC_PREFIX+'{ "route":"embryos.compare","table":"embryo_qc"}',
  EMBRYO_READ_DIAGNOSTIC_PREFIX+'{"route":"embryos.compare","table":"embryo_\\u0071c"}',
  EMBRYO_READ_DIAGNOSTIC_PREFIX+'{"route":"embryos.compare","table":"embryo_qc","message":"PRIVATE"}'])filter.write(wire+"\n");
 filter.end();expect(emit).not.toHaveBeenCalled();
});
it("suppresses output failure and close-truncated read metadata without changing the app refusal",()=>{
 const raw=realReadConsole("embryo_qc"),filter=profileDiagnosticFilter(()=>{throw new Error("PRIVATE");},true);
 expect(()=>filter.write(raw)).not.toThrow();filter.end();
 const emit=vi.fn(),partial=profileDiagnosticFilter(emit,true);partial.write(raw.trimEnd());partial.end();partial.write("\n");expect(emit).not.toHaveBeenCalled();
});
