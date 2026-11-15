import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const worker=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
const cache=readFileSync(new URL('../src/world-snapshot-cache.ts',import.meta.url),'utf8');
test('public snapshot is stored independently from owner data',()=>{
 const section=worker.split('async function publicWorldSnapshot(')[1].split('async function offlineWorldSnapshot(')[0];
 assert.ok(section.includes('environmentMemory(db)'));
 assert.ok(!section.includes('documents(db)'));
 assert.ok(!section.includes('recentTrace(db)'));
 assert.ok(worker.includes('saveWorldSnapshot(env.ARCHIVES,publicSnapshot)'));
});
test('offline fallback uses R2 archives without D1 access',()=>{
 assert.ok(cache.includes('archivedWorldSnapshot(bucket)'));
 assert.ok(cache.includes('latestArchiveKeys(new Date())'));
 assert.ok(!cache.includes('.prepare('));
});
