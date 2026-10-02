import {describe,expect,it,vi} from "vitest";
import type {AccountExportHttpDependencies} from "./account-export-http";
const present=vi.hoisted(()=>vi.fn());
vi.mock("./account-export-http",()=>({accountExportHttpDependencies:()=>({generation:null}),presentAccountExportCreate:present}));
import {accountExportControls} from "./account-export-controls";

describe("settings export presentation",()=>{
 it("keeps the default unconfigured provider closed without Auth, RPC, nonce or job work",async()=>{
  expect(await accountExportControls()).toEqual({available:false});expect(present).not.toHaveBeenCalled();
 });
 it("passes only the actual read-only presentation, refusing stale/absent/canceled authority",async()=>{
  const deps={generation:{}} as AccountExportHttpDependencies;
  const create={operation:"create",nonce:"synthetic-action",csrf:"synthetic-csrf"};present.mockResolvedValueOnce(create);
  expect(await accountExportControls(deps)).toEqual({available:true,create});
  expect(present.mock.calls[0][0]).toBe(deps);expect(present.mock.calls[0][1].aborted).toBe(true);
  present.mockResolvedValueOnce(null);expect(await accountExportControls(deps)).toEqual({available:false});
  present.mockRejectedValueOnce(new Error("current_source_unavailable"));expect(await accountExportControls(deps)).toEqual({available:false});
 });
});
