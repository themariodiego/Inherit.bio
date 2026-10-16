import {expect,it} from "vitest";
import {readEmbryoDispositionReceipt} from "./disposition-receipt";
const NOW=Date.parse("2026-10-01T00:00:00Z"),E="50000000-0000-4000-8000-000000000001",P="50000000-0000-4000-8000-000000000002";
const expected={embryoId:E,action:"confirm" as const,disposition:"transferred" as const};
const transferred={embryoId:E,disposition:"transferred",effectiveAt:"2026-10-01T00:00:00.000Z",retentionExpiresAt:"2048-10-01T00:00:00.000Z",
  recordKeyDelivery:{recipientSetRevision:2,callerState:"delivered_inline"},recordKeyCard:{recordKey:"0123456789ABCDEFGHJK",
    claimUrl:"https://synthetic.example.invalid/future-person/claim",closingDateWords:"1 October 2048",closingDateIso:"2048-10-01",closingDateState:"definitive_transferred_claim_window"}};
it("accepts each exact registered native action receipt and the explicit withheld-card disposition",()=>{
  expect(readEmbryoDispositionReceipt(200,transferred,expected,NOW)).toEqual(transferred);
  const withheld={...transferred,recordKeyDelivery:{...transferred.recordKeyDelivery,callerState:"not_a_card_recipient"},recordKeyCard:null};
  expect(readEmbryoDispositionReceipt(200,withheld,expected,NOW)).toEqual(withheld);
  const awaiting={status:"awaiting_other_parent",proposalId:P,expiresAt:"2026-10-02T00:00:00.000Z"};
  expect(readEmbryoDispositionReceipt(202,awaiting,{...expected,action:"propose"},NOW)).toEqual(awaiting);
  const recorded={embryoId:E,disposition:"stored",effectiveAt:transferred.effectiveAt,retentionExpiresAt:transferred.retentionExpiresAt};
  expect(readEmbryoDispositionReceipt(200,recorded,{...expected,disposition:"stored",action:"commit-single-authority"},NOW)).toEqual(recorded);
});
it.each(["extra","cross-record","cross-disposition","wrong-status","wrong-action","missing-card","extra-card","bad-key","wrong-date","wrong-date-words","bad-state","bad-url","extra-delivery"])("refuses %s without treating the transfer as confirmed",kind=>{
  const value=structuredClone(transferred);let status=200;let target={...expected};
  if(kind==="extra")Object.assign(value,{ownerId:P});
  if(kind==="cross-record")value.embryoId=P;
  if(kind==="cross-disposition")target={...target,disposition:"stored" as never};
  if(kind==="wrong-status")status=202;
  if(kind==="wrong-action")target={...target,action:"propose" as never};
  if(kind==="missing-card")Object.assign(value,{recordKeyCard:null});
  if(kind==="extra-card")value.recordKeyDelivery.callerState="not_a_card_recipient";
  if(kind==="bad-key")value.recordKeyCard.recordKey="I".repeat(20);
  if(kind==="wrong-date")value.recordKeyCard.closingDateIso="2048-10-02";
  if(kind==="wrong-date-words")value.recordKeyCard.closingDateWords="2 October 2048";
  if(kind==="bad-state")value.recordKeyCard.closingDateState="provisional_until_terminal_ordinal_resolution";
  if(kind==="bad-url")value.recordKeyCard.claimUrl="javascript:alert(1)";
  if(kind==="extra-delivery")Object.assign(value.recordKeyDelivery,{parentId:P});
  expect(readEmbryoDispositionReceipt(status,value,target,NOW)).toBeNull();
});
it("requires a future closed proposal receipt and never accepts it as a confirmed disposition",()=>{
  const body={status:"awaiting_other_parent",proposalId:P,expiresAt:new Date(NOW).toISOString()};
  expect(readEmbryoDispositionReceipt(202,body,{...expected,action:"propose"},NOW)).toBeNull();
  expect(readEmbryoDispositionReceipt(202,{...body,expiresAt:"2026-10-02T00:00:00Z",disposition:"transferred"},{...expected,action:"propose"},NOW)).toBeNull();
  expect(readEmbryoDispositionReceipt(202,{...body,expiresAt:"2026-10-02T00:00:00Z"},expected,NOW)).toBeNull();
});

it("compares the Card date to the actual UTC deadline even when the receipt carries an offset",()=>{
  const value={...transferred,retentionExpiresAt:"2048-09-30T23:30:00-01:00"};
  expect(readEmbryoDispositionReceipt(200,value,expected,NOW)).toEqual(value);
  expect(readEmbryoDispositionReceipt(200,{...value,recordKeyCard:{...value.recordKeyCard,
    closingDateIso:"2048-09-30",closingDateWords:"30 September 2048"}},expected,NOW)).toBeNull();
});
