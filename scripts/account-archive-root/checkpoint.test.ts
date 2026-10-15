import { describe, expect, it } from "vitest";
import { parseRootAccountArchiveCheckpoint } from "./checkpoint";

const hash = "a".repeat(64);
function actualShape() {
  return { version: "account-archive-root-delivery-checkpoint-v1", accountId: "00000000-0000-4000-8000-000000000001",
    delivery: { version: "account-archive-test-delivery-proof-v1",
      admission: { version: "account-archive-test-fixture-admission-v1", configurationSha256: hash,
        accountJobs: 0, liveDownloads: 0, undisposedAllocations: 0 },
      exportId: "00000000-0000-4000-8000-000000000002", attemptId: "00000000-0000-4000-8000-000000000003",
      expiresAt: "2026-10-12T12:00:00.000Z", sizeBytes: 1234, sha256: hash, captureSha256: hash,
      allocations: { count: 2, written: 2, disposed: 0, absent: 0, deleted: 0, identitySha256: hash,
        deadlinePassed: false, stopped: false, cleanupDue: false } } };
}
const refused = "root_account_archive_checkpoint_unavailable";
describe("Root's saved actual delivery checkpoint", () => {
  it("retains the complete closed public identity, native allocation bag and admission", () => {
    const value = actualShape();
    expect(parseRootAccountArchiveCheckpoint(value)).toEqual(value);
    expect(parseRootAccountArchiveCheckpoint(value)).not.toBe(value);
  });
  it("refuses absence rather than inventing an earlier completed delivery", () => {
    for (const value of [null, undefined, [], {}]) expect(() => parseRootAccountArchiveCheckpoint(value)).toThrow(refused);
  });
  it("refuses additional credential or environment fields", () => {
    expect(() => parseRootAccountArchiveCheckpoint({ ...actualShape(), credential: "private" })).toThrow(refused);
    const value = actualShape();
    expect(() => parseRootAccountArchiveCheckpoint({ ...value,
      delivery: { ...value.delivery, environment: {} } })).toThrow(refused);
  });
  it("refuses a missing original capture digest", () => {
    const value = actualShape(), { captureSha256, ...delivery } = value.delivery;
    expect(captureSha256).toBe(hash);
    expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery })).toThrow(refused);
  });
  it("refuses noncanonical source and allocation digests", () => {
    const value = actualShape();
    expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery, sha256: "A".repeat(64) } })).toThrow(refused);
    expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery,
      allocations: { ...value.delivery.allocations, identitySha256: "0" } } })).toThrow(refused);
  });
  it("refuses a partial written bag and any already disposed, absent or ACKed allocation", () => {
    for (const patch of [{ written: 1 }, { disposed: 1 }, { absent: 1 }, { deleted: 1 }]) {
      const value = actualShape();
      expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery,
        allocations: { ...value.delivery.allocations, ...patch } } })).toThrow(refused);
    }
  });
  it("refuses zero allocations and fractional or unsafe byte counts", () => {
    const value = actualShape();
    expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery,
      allocations: { ...value.delivery.allocations, count: 0, written: 0 } } })).toThrow(refused);
    for (const sizeBytes of [0, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery, sizeBytes } })).toThrow(refused);
  });
  it("refuses an unadmitted earlier account job, live download or outstanding object", () => {
    for (const patch of [{ accountJobs: 1 }, { liveDownloads: 1 }, { undisposedAllocations: 1 }]) {
      const value = actualShape();
      expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery,
        admission: { ...value.delivery.admission, ...patch } } })).toThrow(refused);
    }
  });
  it("refuses invalid account, export and attempt identities", () => {
    const value = actualShape();
    expect(() => parseRootAccountArchiveCheckpoint({ ...value, accountId: "owner" })).toThrow(refused);
    for (const key of ["exportId", "attemptId"])
      expect(() => parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery, [key]: "unknown" } })).toThrow(refused);
  });
  it("does not convert expiry or stop labels into authority to dispose", () => {
    const value = actualShape();
    const parsed = parseRootAccountArchiveCheckpoint({ ...value, delivery: { ...value.delivery,
      allocations: { ...value.delivery.allocations, deadlinePassed: true, stopped: true, cleanupDue: true } } });
    expect(parsed.delivery.allocations).toEqual({ ...value.delivery.allocations,
      deadlinePassed: true, stopped: true, cleanupDue: true });
    // The browser disposal audit must still recapture this exact native bag.
    expect(parsed.delivery.allocations.identitySha256).toBe(hash);
  });
});


import {vi} from "vitest";
import {chownSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {readRootAccountArchiveCheckpoint,saveRootAccountArchiveCheckpoint} from "./checkpoint";
function publicScratch(){
 const parent=realpathSync(mkdtempSync(path.join(realpathSync(tmpdir()),"archive-checkpoint-")));
 chownSync(parent,process.getuid!(),process.getgid!());const root=path.join(parent,"checkout");mkdirSync(root,{mode:0o700});
 return {parent,root,directory:path.join(parent,".checkout-account-archive-root-obligation")};
}
it("retains the whole obligation outside all ordinary test and build output cleanup and refuses overwrite",()=>{
 const scratch=publicScratch(),cwd=vi.spyOn(process,"cwd").mockReturnValue(scratch.root);
 try{
  for(const name of ["test-results",".next","dist"])mkdirSync(path.join(scratch.root,name),{mode:0o700});
  const value=actualShape();saveRootAccountArchiveCheckpoint(value);
  const file=path.join(scratch.directory,"checkpoint.json"),bytes=readFileSync(file);
  expect(lstatSync(scratch.directory).mode&0o777).toBe(0o700);expect(lstatSync(file).mode&0o777).toBe(0o600);
  for(const name of ["test-results",".next","dist"])rmSync(path.join(scratch.root,name),{recursive:true});
  expect(readFileSync(file)).toEqual(bytes);expect(readRootAccountArchiveCheckpoint()).toEqual(value);
  expect(()=>saveRootAccountArchiveCheckpoint(value)).toThrow();expect(readFileSync(file)).toEqual(bytes);
 }finally{cwd.mockRestore();rmSync(scratch.parent,{recursive:true,force:true});}
});
it("refuses a symlink checkpoint or an existing sibling obligation without adopting either",()=>{
 const scratch=publicScratch(),cwd=vi.spyOn(process,"cwd").mockReturnValue(scratch.root);
 try{
  saveRootAccountArchiveCheckpoint(actualShape());const file=path.join(scratch.directory,"checkpoint.json");
  const retained=path.join(scratch.directory,"retained.json");
  const bytes=readFileSync(file);unlinkSync(file);symlinkSync(retained,file);
  expect(()=>readRootAccountArchiveCheckpoint()).toThrow(refused);
  expect(()=>saveRootAccountArchiveCheckpoint(actualShape())).toThrow();expect(lstatSync(file).isSymbolicLink()).toBe(true);
  expect(bytes.length).toBeGreaterThan(0);
 }finally{cwd.mockRestore();rmSync(scratch.parent,{recursive:true,force:true});}
});
