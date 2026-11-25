#!/usr/bin/env node
// Read-only Stage 1 collector. Preserves exact HTTP JSON response bytes from
// World 004, including every cursor page, separately from derived metrics.
// This is NOT byte-for-byte R2 object export; it is the lossless API response.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const BASE=(process.env.WORLD_004_WORKER_URL||'').replace(/\/$/,'');
const TOKEN=process.env.WORLD_004_INTERNAL_SECRET||'';
const START=process.env.EXPERIMENT_START||'';
const STOP=process.env.EXPERIMENT_STOP||'';
const OUT=process.env.EXPERIMENT_OUTPUT||'experiment-evidence';
const MAX_PAGES=1000;
function assert(condition,message){if(!condition)throw Error(message)}
function iso(s){const n=Date.parse(s);assert(Number.isFinite(n)&&new Date(n).toISOString()===s,'Expected exact UTC ISO timestamp: '+s);return n}
function daysBetween(start,stop){
  const result=[];
  for(let t=Date.UTC(new Date(start).getUTCFullYear(),new Date(start).getUTCMonth(),new Date(start).getUTCDate());t<stop;t+=86400000)
    result.push(new Date(t).toISOString().slice(0,10));
  return result;
}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function download(path,filename,manifest){
  const response=await fetch(BASE+path,{headers:{Authorization:'Bearer '+TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(90000),redirect:'error'});
  assert(response.ok,`HTTP ${response.status} exporting ${path}: ${(await response.text()).slice(0,180)}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert(bytes.length>0,'Empty export: '+path);
  const parsed=JSON.parse(bytes.toString('utf8'));
  await writeFile(join(OUT,filename),bytes);
  manifest.files.push({path:filename,bytes:bytes.length,sha256:hash(bytes)});
  return parsed;
}
async function main(){
  assert(BASE.startsWith('https://')&&new URL(BASE).username===''&&new URL(BASE).password==='','Set HTTPS WORLD_004_WORKER_URL');
  assert(TOKEN.length>=16,'WORLD_004_INTERNAL_SECRET missing');
  const start=iso(START),stop=iso(STOP);
  assert(stop>start&&stop-start<=86400000,'Experiment must be a positive window <=24h');
  assert(Date.now()>=stop+5*60000,'Wait at least five minutes after experiment end before export');
  await mkdir(OUT,{recursive:true});
  const manifest={format:'nimo-stage1-evidence-v1',window:{start:START,stop:STOP},collectedAt:new Date().toISOString(),source:BASE,files:[],pages:[],completeness:{state:'checking',warnings:[]}};
  try{
    const params=new URLSearchParams({start:START,stop:STOP});
    const ledger=await download('/export/canary?'+params,'raw-world-004-ledger.json',manifest);
    assert(ledger.format==='nimo-world-004-canary-v1','Unexpected ledger format');
    assert(ledger.experiment?.start===START&&ledger.experiment?.stop===STOP,'Ledger window mismatch');
    const truncated=ledger.truncatedTables??[];
    assert(Array.isArray(truncated),'Invalid truncatedTables');
    if(truncated.length)manifest.completeness.warnings.push('Ledger tables truncated: '+truncated.join(', '));
    const contexts=[];const ids=new Set();
    for(const day of daysBetween(start,stop)){
      let cursor=null;const seen=new Set();
      for(let page=1;page<=MAX_PAGES;page++){
        const query=new URLSearchParams({date:day});
        if(cursor)query.set('cursor',cursor);
        const file=`raw-decision-context-${day}-page-${String(page).padStart(4,'0')}.json`;
        const payload=await download('/decision-context/export?'+query,file,manifest);
        assert(payload.format==='nimo-decision-input-export-v1'&&payload.date===day,'Unexpected R2 page');
        assert(Array.isArray(payload.records),'Missing decision context records');
        manifest.pages.push({day,page,file,records:payload.records.length,truncated:payload.truncated});
        for(const r of payload.records){
          const time=Date.parse(r.capturedAt);
          assert(Number.isFinite(time)&&Number.isSafeInteger(r.traceId),'Invalid decision context record');
          if(time>=start&&time<stop){
            const key=r.traceId+':'+r.capturedAt;
            assert(!ids.has(key),'Duplicate decision audit '+key);
            ids.add(key);contexts.push(r);
          }
        }
        if(!payload.truncated){assert(payload.nextCursor===null||!payload.nextCursor,'Unexpected terminal cursor');break}
        assert(typeof payload.nextCursor==='string'&&payload.nextCursor&&!seen.has(payload.nextCursor),'Missing/looping cursor');
        seen.add(payload.nextCursor);cursor=payload.nextCursor;
        assert(page<MAX_PAGES,'Exceeded cursor page guard');
      }
    }
    const traces=ledger.actionTrace??[],decisions=ledger.decisions??[],events=ledger.events??[];
    const byAction={};const byKind={};const byStatus={};
    for(const e of events){const k=String(e.action??e.kind??'unknown');byAction[k]=(byAction[k]??0)+1}
    let inputTokens=0,outputTokens=0,cachedInputTokens=0,calls=0;
    for(const t of traces){
      const kind=String(t.kind??'unknown'),status=String(t.status??'unknown');
      byKind[kind]=(byKind[kind]??0)+1;byStatus[status]=(byStatus[status]??0)+1;
      if(kind==='decide'&&t.metadata){
        try{
          const m=typeof t.metadata==='string'?JSON.parse(t.metadata):t.metadata;
          if(m.usage){calls++;inputTokens+=Number(m.usage.input_tokens)||0;outputTokens+=Number(m.usage.output_tokens)||0;cachedInputTokens+=Number(m.usage.cached_input_tokens)||0}
        }catch{manifest.completeness.warnings.push('Unparseable trace metadata '+t.id)}
      }
    }
    const selected=contexts.filter(r=>r.outcome?.status==='selected').length;
    const failed=contexts.filter(r=>r.outcome?.status==='failed').length;
    if(contexts.length<decisions.length)manifest.completeness.warnings.push('Fewer archived model contexts than decisions; inspect missing trace IDs');
    const metrics={
      format:'nimo-stage1-metrics-v1',window:manifest.window,
      counts:{decisions:decisions.length,events:events.length,actionTrace:traces.length,
        decisionContexts:contexts.length,selectedContexts:selected,failedContexts:failed,
        rewards:(ledger.rewards??[]).length,sketchesChanged:(ledger.sketchesChanged??[]).length,
        documentsChanged:(ledger.documentsChanged??[]).length,projectsChanged:(ledger.projectsChanged??[]).length},
      actionCounts:byAction,traceKindCounts:byKind,traceStatusCounts:byStatus,
      usage:{observedModelCalls:calls,inputTokens,cachedInputTokens,outputTokens},
      note:'Counts describe observed records, not causal improvement or creative quality. Zero counts may mean missing data.',
      warnings:manifest.completeness.warnings
    };
    const bytes=Buffer.from(JSON.stringify(metrics,null,2)+'\n');
    await writeFile(join(OUT,'metrics.json'),bytes);
    manifest.files.push({path:'metrics.json',bytes:bytes.length,sha256:hash(bytes)});
    manifest.completeness.state=manifest.completeness.warnings.length?'incomplete_or_unverified':'export_complete';
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    await writeFile(join(OUT,'manifest.json'),manifestBytes);
    // Fail closed: no Codex evaluation on incomplete exports.
    assert(manifest.completeness.state==='export_complete',manifest.completeness.warnings.join('; '));
    process.stdout.write(JSON.stringify({metrics,manifest})+'\n');
  }catch(error){
    manifest.completeness.state='failed';
    manifest.completeness.warnings.push(String(error.message||error));
    await writeFile(join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    throw error;
  }
}
main().catch(err=>{console.error('Evidence collection failed:',err.message);process.exitCode=1});
