import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {accountArchiveScope} from "./account-archive-scope";

const account=randomUUID(),subject=randomUUID(),other=randomUUID();
const base={targetKind:"account",targetId:account,actor:{accountId:account},partitions:[{subjectId:subject,class:"ordinary"}]};
describe("the account producer's two scopes",()=>{
 it("is the whole account or one ordinary subject job, nothing else",()=>{
  expect(accountArchiveScope(base)).toBe("account");
  expect(accountArchiveScope({...base,targetKind:"subject",targetId:subject})).toBe("subject");
  expect(accountArchiveScope({...base,targetId:other})).toBeNull();
  expect(accountArchiveScope({...base,targetKind:"subject",targetId:other})).toBeNull();
  expect(accountArchiveScope({...base,targetKind:"subject",targetId:subject,partitions:[{subjectId:subject,class:"claimed-bound"}]})).toBeNull();
  expect(accountArchiveScope({...base,targetKind:"subject",targetId:subject,partitions:[...base.partitions,{subjectId:other,class:"ordinary"}]})).toBeNull();
  expect(accountArchiveScope({...base,targetKind:"cohort",targetId:subject})).toBeNull();
 });
});
