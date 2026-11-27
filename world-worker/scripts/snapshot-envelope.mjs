import { constants, createCipheriv, createDecipheriv, createHash, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = Buffer.from("NIMO-E00-1\n");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function seal(bytes, publicKey) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const wrapped = publicEncrypt({key:publicKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:"sha256"}, key);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(wrapped.length);
  const header = Buffer.concat([version,length,wrapped,nonce]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([header,encrypted,cipher.getAuthTag()]);
}

export function unseal(bytes, privateKey) {
  if (!bytes.subarray(0,version.length).equals(version) || bytes.length<version.length+30) {
    throw Error("Invalid snapshot envelope");
  }
  const wrappedStart = version.length+2;
  const nonceStart = wrappedStart+bytes.readUInt16BE(version.length);
  const headerEnd = nonceStart+12;
  if (bytes.length<headerEnd+16) throw Error("Truncated snapshot envelope");
  const key = privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"},bytes.subarray(wrappedStart,nonceStart));
  const decipher = createDecipheriv("aes-256-gcm",key,bytes.subarray(nonceStart,headerEnd));
  decipher.setAAD(bytes.subarray(0,headerEnd));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(headerEnd,-16)),decipher.final()]);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const [action,key,input,output] = process.argv.slice(2);
  if (!["seal","unseal"].includes(action) || !key || !input || !output) throw Error("Expected seal|unseal KEY INPUT OUTPUT");
  const transform = action==="seal" ? seal : unseal;
  writeFileSync(output,transform(readFileSync(input),readFileSync(key)),{mode:0o600,flag:"wx"});
}
