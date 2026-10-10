import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
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
});
