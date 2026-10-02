/** Real Chromium label regression using the exact control rendered by ClaimReview.
 * This bounded control fixture carries no claim, session, provider or API authority. */
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {chromium,expect} from "@playwright/test";
import {ReviewReason} from "../src/components/future-person/review-reason";

assert(process.argv.length===2,"Unknown arguments");
const original="The synthetic documentary papers match no unique eligible record. No record was chosen.";
const edited="Both complete synthetic papers were reviewed again. No unique eligible record was chosen.";
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  page.setDefaultTimeout(5_000);
  for(const value of ["",original]) {
    await page.setContent(renderToStaticMarkup(createElement(ReviewReason,{value,disabled:false,onChange:()=>{}})));
    const reason=page.getByLabel("Reason",{exact:true});
    await expect(reason).toHaveCount(1);
    await expect(page.getByRole("textbox",{name:"Reason",exact:true})).toHaveCount(1);
    await expect(reason).toHaveValue(value);
    assert(await reason.evaluate(element=>{
      if(!(element instanceof HTMLTextAreaElement))return false;
      const labels=element.labels;
      return Boolean(element.id&&labels?.length===1&&labels[0].htmlFor===element.id&&labels[0].control===element
        &&labels[0].textContent==="Reason"&&element.minLength===20&&element.maxLength===2000
        &&element.rows===5&&element.required&&!element.disabled);
    }),"The actual textarea must retain its explicit association and all original constraints");
    for(const text of [original,edited,original]) {
      await reason.fill(text);
      await expect(page.getByLabel("Reason",{exact:true})).toHaveCount(1);
      await expect(page.getByRole("textbox",{name:"Reason",exact:true})).toHaveValue(text);
    }
    if(value===original) {
      // Plant the former association on the same actual rendered control.
      // This proves the regression detects nonempty implicit-label drift.
      await reason.evaluate(element=>{
        const label=(element as HTMLTextAreaElement).labels![0];
        label.removeAttribute("for");label.append(element);
      });
      await expect(page.getByLabel("Reason",{exact:true})).toHaveCount(0);
      await expect(page.getByRole("textbox",{name:"Reason",exact:true})).toHaveCount(1);
    }
  }
  await page.setContent(renderToStaticMarkup(createElement("div",null,
    createElement("section",{"aria-label":"First review"},createElement(ReviewReason,{value:original,disabled:false,onChange:()=>{}})),
    createElement("section",{"aria-label":"Second review"},createElement(ReviewReason,{value:edited,disabled:true,onChange:()=>{}})))));
  const first=page.getByRole("region",{name:"First review"}).getByLabel("Reason",{exact:true});
  const second=page.getByRole("region",{name:"Second review"}).getByLabel("Reason",{exact:true});
  await expect(first).toHaveValue(original);await expect(first).toBeEnabled();
  await expect(second).toHaveValue(edited);await expect(second).toBeDisabled();
  assert.notEqual(await first.getAttribute("id"),await second.getAttribute("id"),"Concurrent actual controls need distinct label targets");
  console.log(JSON.stringify({result:"PASS",browser:browser.version(),initialStates:2,refills:6,
    explicitAssociation:true,originalConstraints:true,independentControls:true,implicitLabelDriftRefused:true}));
} finally {await browser.close();}
