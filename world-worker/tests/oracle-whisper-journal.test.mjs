import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source=readFileSync(new URL("../src/index.ts",import.meta.url),"utf8");

test("public journal includes Oracle whispers without exposing private visitor messages",()=>{
 const expected="(kind='world' AND action='ORACLE_WHISPER')";
 const occurrences=source.split(expected).length-1;
 assert.equal(occurrences,2,"Both initial public events and paginated journal must include the Oracle whisper");
 assert.match(source,/async function publicEvents\(/);
 assert.match(source,/async function journalPage\(/);
 assert.match(source,/action IS NULL OR action <> 'REQUEST'/);
 assert.doesNotMatch(source,/kind IN \('thought','tool','belief','identity','world'\)/,
  "Only specifically approved world dialogue should appear, not all world events");
});

test("Oracle message has correct public event type and action",()=>{
 assert.match(source,/await log\(env\.DB,"world",oracleEncounter\.invitation,"ORACLE_WHISPER"\)/);
});
