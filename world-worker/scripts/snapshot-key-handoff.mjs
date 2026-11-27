import { constants, createDecipheriv, privateDecrypt, publicEncrypt } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";

const [action,snapshot,key,other,output]=process.argv.slice(2);
const bytes=readFileSync(snapshot);
const magic=Buffer.from("NIMO-E00-1\n");
if(!bytes.subarray(0,magic.length).equals(magic))throw Error("Unexpected envelope version");
const wrappedStart=magic.length+2;
const nonceStart=wrappedStart+bytes.readUInt16BE(magic.length);
const headerEnd=nonceStart+12;
const options={padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"};

if(action==="wrap"){
  const contentKey=privateDecrypt({...options,key:readFileSync(key)},bytes.subarray(wrappedStart,nonceStart));
  try {
    const wrapped=publicEncrypt({...options,key:readFileSync(other)},contentKey);
    writeFileSync(output,wrapped.toString("base64")+"\n",{mode:0o600,flag:"wx"});
  } finally {
    contentKey.fill(0);
  }
} else if(action==="restore"){
  const contentKey=privateDecrypt({...options,key:readFileSync(key)},Buffer.from(readFileSync(other,"utf8").trim(),"base64"));
  try {
    const cipher=createDecipheriv("aes-256-gcm",contentKey,bytes.subarray(nonceStart,headerEnd));
    cipher.setAAD(bytes.subarray(0,headerEnd));
    cipher.setAuthTag(bytes.subarray(-16));
    writeFileSync(output,Buffer.concat([cipher.update(bytes.subarray(headerEnd,-16)),cipher.final()]),{mode:0o600,flag:"wx"});
  } finally {
    contentKey.fill(0);
  }
} else {
  throw Error("Expected wrap or restore");
}
