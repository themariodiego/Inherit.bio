/** Valid synthetic two-page PDF. Action/link objects must remain inert. */
export function reviewPdf():Buffer {
  const contents=["1 0 0 rg 20 20 120 160 re f\nBT /F1 18 Tf 20 210 Td (Synthetic page one) Tj ET\n",
    "0 0 1 rg 30 30 100 150 re f\nBT /F1 18 Tf 20 210 Td (Synthetic page two) Tj ET\n"];
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R /OpenAction 8 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [9 0 R] >>",
    `<< /Length ${Buffer.byteLength(contents[0])} >>\nstream\n${contents[0]}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(contents[1])} >>\nstream\n${contents[1]}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /S /JavaScript /JS (globalThis.__documentScriptExecuted=true;) >>",
    "<< /Type /Annot /Subtype /Link /Rect [0 0 200 260] /A << /S /URI /URI (https://outside.example/synthetic-private-name) >> >>",
  ];
  let result="%PDF-1.7\n";const offsets=[0];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(result);
  result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))result+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  result+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
