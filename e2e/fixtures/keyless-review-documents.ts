/** Explicit synthetic documentary bytes for software journeys. These papers
 * establish no government, human-review, owner-delivery or elapsed-time proof.
 * Names/DOB/parents are readable in the actual local PDF renderer, rather than
 * attesting invented identity fields from a blank image. */
export function keylessReviewDocument(kind:"photo"|"birth",identity:{fullName:string;placeOfBirth:string;parentNames:string[]}):Buffer {
  if([identity.fullName,identity.placeOfBirth,...identity.parentNames].some(value=>!/^Synthetic [A-Za-z0-9 ]{1,80}$/u.test(value)))throw new Error("Only explicit synthetic documentary text is allowed");
  const lines=kind==="photo"?["SYNTHETIC TEST DOCUMENT","Picture ID fixture",identity.fullName,"Birth date: 2000-01-31"]:
    ["SYNTHETIC TEST DOCUMENT","Birth record fixture",identity.fullName,"Birth date: 2000-01-31",`Place: ${identity.placeOfBirth}`,...identity.parentNames.map(name=>`Parent: ${name}`)];
  const text=lines.map((line,index)=>`BT /F1 8 Tf 20 ${240-index*20} Td (${line}) Tj ET`).join("\n");
  const contents=[`1 0 0 rg 20 20 80 50 re f\n${text}\n`,
    `0 0 1 rg 20 20 80 50 re f\nBT /F1 12 Tf 20 230 Td (SYNTHETIC TEST DOCUMENT) Tj ET\nBT /F1 12 Tf 20 210 Td (${kind==="photo"?"Picture ID":"Birth record"} fixture - page two) Tj ET\n`];
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(contents[0])} >>\nstream\n${contents[0]}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(contents[1])} >>\nstream\n${contents[1]}endstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let result="%PDF-1.7\n";const offsets:number[]=[];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets)result+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  result+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
