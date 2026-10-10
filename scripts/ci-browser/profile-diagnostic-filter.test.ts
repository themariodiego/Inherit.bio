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
