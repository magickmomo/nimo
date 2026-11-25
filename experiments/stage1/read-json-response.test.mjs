import test from 'node:test';
import assert from 'node:assert/strict';
import {readJsonResponse} from './read-json-response.mjs';

test('successful JSON export preserves exact bytes and reads once',async()=>{
  const body='{"format":"test", "rows":[1,2]}\n';
  const response=new Response(body,{status:200,headers:{'content-type':'application/json'}});
  const result=await readJsonResponse(response,'/export/canary');
  assert.equal(result.bytes.toString('utf8'),body);
  assert.deepEqual(result.parsed,{format:'test',rows:[1,2]});
  assert.equal(response.bodyUsed,true);
});

test('non-2xx export reports response text without trying to read body again',async()=>{
  const response=new Response('Unauthorized',{status:401});
  await assert.rejects(readJsonResponse(response,'/export/canary'),/HTTP 401 exporting \/export\/canary: Unauthorized/);
  assert.equal(response.bodyUsed,true);
});

test('empty successful response is rejected',async()=>{
  await assert.rejects(readJsonResponse(new Response('',{status:200}),'/export/canary'),/Empty export/);
});

test('malformed JSON remains a visible failure',async()=>{
  await assert.rejects(readJsonResponse(new Response('{invalid',{status:200}),'/export/canary'),SyntaxError);
});
