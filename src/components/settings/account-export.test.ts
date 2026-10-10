import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {AccountExport} from "./account-export";

describe("complete export settings control",()=>{
 it("renders the unavailable default as a disabled action, with no status credential or ready link",()=>{
  const html=renderToStaticMarkup(createElement(AccountExport,{control:{available:false}}));
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Prepare complete export<\/button>/u);
  expect(html).toContain("A complete export cannot be prepared right now.");
  expect(html).not.toContain("Check export status");expect(html).not.toContain("href=");
 });
 it("presents an explicit action without starting a create, poll or embedding internal proofs in HTML",()=>{
  const html=renderToStaticMarkup(createElement(AccountExport,{control:{available:true,
   create:{operation:"create",nonce:"synthetic-action-proof",csrf:"synthetic-csrf-proof"}}}));
  expect(html).toContain("Prepare complete export");expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("synthetic-action-proof");expect(html).not.toContain("synthetic-csrf-proof");
  expect(html).not.toContain("Check export status");expect(html).not.toContain("href=");
 });
 it("offers a separately issued ready action without rendering source descriptors, cookies or a download URL",()=>{
  const exportId=randomUUID(),html=renderToStaticMarkup(createElement(AccountExport,{control:{available:true,
   create:{operation:"create",nonce:"synthetic-unused-create",csrf:"synthetic-unused-csrf"},
   open:{status:"ready",exportId,filename:"inherit-account-export.zip",sizeBytes:1,sha256:"a".repeat(64),
    openAction:{method:"POST",operation:"open-ready"},
    operation:"open-ready",nonce:"synthetic-ready-action",csrf:"synthetic-ready-csrf"}}}));
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Prepare complete export<\/button>/u);
  expect(html).toContain("Check export status");expect(html).toContain("Save complete export");
  for(const hidden of [exportId,"synthetic-unused-create","synthetic-unused-csrf","synthetic-ready-action","synthetic-ready-csrf","href=","/api/downloads/"])
   expect(html).not.toContain(hidden);
 });
});
