/** Foreign database variants retain all six native fields. This column order
 * matches their canonical JSONB key order so a large scalar can stream without
 * a row-sized buffer. The legacy own-upload CSV producer is unchanged. */
export const ACCOUNT_COMPLETE_VARIANT_COLUMNS=["alt","pos","ref","rsid","chrom","genotype"] as const;
export const ACCOUNT_COMPLETE_VARIANT_HEADER=ACCOUNT_COMPLETE_VARIANT_COLUMNS.join(",")+"\n";
const encoder=new TextEncoder(),unavailable=()=>new Error("account_complete_variant_unavailable");

/** Consume one complete canonical native six-field JSONB object. Only scalars
 * are accepted, and strings are decoded incrementally before CSV escaping.
 * EOF, exact key/type/order and Unicode are mandatory; no supported string
 * length becomes a metadata limit or a silently omitted variant. */
export async function* streamAccountCompleteVariantCsv(source:AsyncIterable<Uint8Array>):AsyncGenerator<Uint8Array>{
 const decoder=new TextDecoder("utf-8",{fatal:true});
 type State="start"|"key-start"|"key"|"colon"|"value"|"string"|"escape"|"unicode"|"literal"|"separator"|"end";
 let state:State="start",ordinal=0,key="",literal="",unicode="",high:number|undefined,output="";
 const current=()=>ACCOUNT_COMPLETE_VARIANT_COLUMNS[ordinal];
 function complete(){return state==="end"&&ordinal===6;}
 const emit=(value:string)=>{output+=value.replaceAll('"','""');};
 const stringField=()=>["alt","ref","genotype"].includes(current());
 function decoded(value:string){
  if(high!==undefined)throw unavailable();emit(value);
 }
 function scalarEnd(){
  if(literal==="null"){
   if(current()==="genotype"||!["alt","ref","rsid"].includes(current()))throw unavailable();
  }else{
   if(stringField()||! /^(0|[1-9][0-9]*)$/u.test(literal)||literal.length>16)throw unavailable();
   const number=Number(literal);if(!Number.isSafeInteger(number)||number<0||current()!=="rsid"&&number===0)throw unavailable();
   output+=(current()==="rsid"?"rs":"")+literal;
  }
  literal="";state="separator";
 }
 function character(ch:string){
  // A completed literal may consume this same separator after validation.
  if(state==="literal"&&/[ \t\r\n,}]/u.test(ch))scalarEnd();
  if(state!=="string"&&state!=="escape"&&state!=="unicode"&&state!=="key"&&/[ \t\r\n]/u.test(ch))return;
  switch(state){
   case "start":if(ch!=="{")throw unavailable();state="key-start";return;
   case "key-start":if(ch!=='"'||ordinal>=6)throw unavailable();key="";state="key";return;
   case "key":
    if(ch==='"'){if(key!==current())throw unavailable();state="colon";return;}
    if(!/^[a-z]$/u.test(ch)||key.length>=8)throw unavailable();key+=ch;return;
   case "colon":if(ch!==":")throw unavailable();state="value";return;
   case "value":
    if(ordinal)output+=",";
    if(ch==='"'){if(!stringField())throw unavailable();output+='"';state="string";return;}
    literal=ch;if(ch!=="n"&&!/^[0-9]$/u.test(ch))throw unavailable();state="literal";return;
   case "literal":if(literal.length>=16||!/[a-z0-9]/u.test(ch))throw unavailable();literal+=ch;return;
   case "string":
    if(ch==='"'){if(high!==undefined)throw unavailable();output+='"';state="separator";return;}
    if(ch==="\\"){state="escape";return;}
    if(ch.codePointAt(0)!<0x20)throw unavailable();decoded(ch);return;
   case "escape":{
    if(ch==="u"){unicode="";state="unicode";return;}
    if(high!==undefined)throw unavailable();
    const escaped:Record<string,string>={'"':'"',"\\":"\\","/":"/",b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"};
    if(!(ch in escaped))throw unavailable();decoded(escaped[ch]);state="string";return;}
   case "unicode":{
    if(!/^[a-fA-F0-9]$/u.test(ch))throw unavailable();unicode+=ch;if(unicode.length!==4)return;
    const code=Number.parseInt(unicode,16);
    if(high!==undefined){if(code<0xdc00||code>0xdfff)throw unavailable();emit(String.fromCodePoint(0x10000+(high-0xd800)*1024+code-0xdc00));high=undefined;}
    else if(code>=0xd800&&code<=0xdbff)high=code;
    else if(code>=0xdc00&&code<=0xdfff)throw unavailable();else decoded(String.fromCodePoint(code));
    state="string";return;}
   case "separator":
    ordinal++;if(ordinal===6){if(ch!=="}")throw unavailable();output+="\n";state="end";return;}
    if(ch!==",")throw unavailable();state="key-start";return;
   case "end":throw unavailable();
  }
 }
 try{
  for await(const bytes of source){if(!(bytes instanceof Uint8Array)||bytes.byteLength===0)throw unavailable();
   for(const ch of decoder.decode(bytes,{stream:true})){character(ch);if(output.length>=4096){yield encoder.encode(output);output="";}}
  }
  for(const ch of decoder.decode()){character(ch);if(output.length>=4096){yield encoder.encode(output);output="";}}
  if(!complete())throw unavailable();if(output)yield encoder.encode(output);
 }catch{throw unavailable();}
}
