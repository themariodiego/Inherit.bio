import {describe,it,expect} from "vitest";
import {ACCOUNT_COMPLETE_VARIANT_HEADER,streamAccountCompleteVariantCsv} from "./account-complete-variant-csv";
const encoder=new TextEncoder();
async function render(text:string,width=3){
 const result:Uint8Array[]=[];
 for await(const bytes of streamAccountCompleteVariantCsv((async function*(){const raw=encoder.encode(text);
  for(let i=0;i<raw.length;i+=width)yield raw.subarray(i,i+width);})()))result.push(bytes);
 return new TextDecoder().decode(Buffer.concat(result));
}
describe("complete recipient-authorized native variant CSV",()=>{
 it("retains every original field and exact CSV escaping across split UTF8 and JSON escapes",async()=>{
  expect(ACCOUNT_COMPLETE_VARIANT_HEADER).toBe("alt,pos,ref,rsid,chrom,genotype\n");
  const native='{"alt": "A,\\\"雪", "pos": 123, "ref": null, "rsid": 456, "chrom": 22, "genotype": "0/1\\n\\uD83D\\uDE00"}';
  expect(await render(native,1)).toBe('"A,""雪",123,,rs456,22,"0/1\n😀"\n');
 });
 it("retains a genuine long scalar without a metadata or whole-row buffer cap",async()=>{
  const long="A".repeat(4_100_000);
  const native=JSON.stringify({alt:long,pos:1,ref:"G",rsid:null,chrom:1,genotype:"0/1"});
  expect(await render(native,786_432)).toBe(`"${long}",1,"G",,1,"0/1"\n`);
 });
 it.each([
  '{"alt":null,"pos":1,"ref":null,"rsid":null,"chrom":1}',
  '{"alt":null,"pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1","extra":1}',
  '{"pos":1,"alt":null,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":null,"pos":1,"alt":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":null,"pos":0,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":null,"pos":1,"ref":null,"rsid":1.5,"chrom":1,"genotype":"0/1"}',
  '{"alt":{},"pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":null,"pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":null}',
  '{"alt":"\\uD800","pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":"\\uDC00","pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":"\\x41","pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}',
  '{"alt":null,"pos":1,"ref":null,"rsid":null,"chrom":1,"genotype":"0/1"}{}',
 ])("refuses missing, foreign, reordered, malformed or incomplete native fields %#",async text=>{
  await expect(render(text)).rejects.toThrow("account_complete_variant_unavailable");
 });
});
