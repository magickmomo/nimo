"use client";

import {ChangeEvent, useEffect, useMemo, useState} from "react";
import {ArchiveRecord, Report, SAMPLE, runPreview, contextOf, offerChoices} from "../../lib/decision-harness";
import "./harness.css";

const nice=(v:unknown)=>JSON.stringify(v,null,2);
function estimatedDecisionCost(usage:unknown):string|null{
 if(!usage||typeof usage!=="object")return null;
 const u=usage as {input_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number}};
 if(typeof u.input_tokens!=="number")return null;
 const total=u.input_tokens;
 const cached=Math.max(0,Math.min(total,u.input_tokens_details?.cached_tokens??0));
 const writes=Math.max(0,Math.min(total-cached,u.input_tokens_details?.cache_write_tokens??0));
 const uncached=Math.max(0,total-cached-writes);
 const usd=(uncached*.10+cached*.01+writes*.125)/1000000;
 return "$"+usd.toFixed(7);
}
function download(name:string,value:unknown){
 const blob=new Blob([nice(value)],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob),anchor=document.createElement("a");
 anchor.href=url;anchor.download=name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),500);
}
export default function DecisionHarnessPage(){
 const [records,setRecords]=useState<ArchiveRecord[]>([SAMPLE]);
 const [source,setSource]=useState<"sample"|"uploaded">("sample");
 const [traceId,setTraceId]=useState<number>(SAMPLE.traceId);
 const [choiceId,setChoiceId]=useState<string>("start_sketch");
 const [result,setResult]=useState<Report|null>(null);
 const [active,setActive]=useState("context");
 const [error,setError]=useState("");
 const [ownerSignedIn,setOwnerSignedIn]=useState(false);
 const [aiBusy,setAiBusy]=useState(false);
 useEffect(()=>{void fetch("/api/world/session",{cache:"no-store"}).then(r=>r.json()).then(d=>setOwnerSignedIn(Boolean(d.authenticated))).catch(()=>setOwnerSignedIn(false));},[]);
 const record=records.find(r=>r.traceId===traceId)??records[0];
 const choices=useMemo(()=>{
  try{const {world,visitor}=contextOf(record);return offerChoices(world,visitor);}catch{return [];}
 },[record]);
 const chosen=choices.some(c=>c.id===choiceId)?choiceId:(choices.find(c=>c.id==="start_sketch")?.id??choices[0]?.id??"");
 const stage=result?.stages.find(s=>s.id===active)??result?.stages[0]??null;

 async function loadFile(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];if(!file)return;
  setError("");setResult(null);
  try{
   if(file.size>20_000_000)throw Error("Choose a JSON export smaller than 20 MB.");
   const parsed=JSON.parse(await file.text());
   const extracted=(Array.isArray(parsed?.records)?parsed.records:Array.isArray(parsed)?parsed:[parsed])
    .filter((r:unknown)=>r&&typeof r==="object"&&Number.isSafeInteger((r as ArchiveRecord).traceId)&&Array.isArray((r as ArchiveRecord).request?.input)) as ArchiveRecord[];
   if(!extracted.length)throw Error("No compatible decision-input records were found.");
   for(const r of extracted)contextOf(r);
   setRecords(extracted);setTraceId(extracted[0].traceId);setChoiceId("");setSource("uploaded");
  }catch(e){setError(e instanceof Error?e.message:"Unable to read the export");}
  event.target.value="";
 }
 function run(){
  try{
   const next=runPreview(record,chosen||null);
   setResult(next);setActive("context");setError("");
  }catch(e){setError(e instanceof Error?e.message:"Could not run simulation");}
 }
 async function runWithAI(){
  if(aiBusy||!ownerSignedIn)return;
  setAiBusy(true);setError("");
  try{
   const baseline=runPreview(record,null);
   if(!baseline.request)throw Error("This snapshot requires a direct reply rather than a Decisions API choice.");
   const res=await fetch("/api/decision-harness/run",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({traceId:record.traceId,context:baseline.context,
      choices:baseline.choices.map(c=>({id:c.id,description:c.description}))})
   });
   const body=await res.json() as {error?:string;response?:unknown;request?:unknown;selectedChoice?:string|null;latencyMs?:number;usage?:unknown;selectionValid?:boolean};
   if(!res.ok)throw Error(body.error??"AI decision failed");
   const next=runPreview(record,body.selectedChoice??null);
   next.ai={latencyMs:body.latencyMs??null,usage:body.usage??null,valid:body.selectionValid===true,response:body.response??null};
   const requestStage=next.stages.find(s=>s.id==="decisions_request");
   if(requestStage&&body.request)requestStage.output=body.request;
   const responseStage=next.stages.find(s=>s.id==="decisions_response");
   if(responseStage){
    responseStage.input={request:body.request};
    responseStage.output=body.response??null;
    responseStage.status="done";responseStage.source="openai_decisions_api";
    responseStage.note=body.selectionValid?
      "Real Decisions API response. The selected choice was checked against offered options. No world action executed.":
      "OpenAI returned no validated action. No world action executed.";
   }
   const routeStage=next.stages.find(s=>s.id==="route");
   if(routeStage&&body.selectionValid){
    routeStage.source="ai_selected_offline_route";
    routeStage.note="Routing proposal based on a real AI choice; execution is disabled.";
   }
   setResult(next);setActive("decisions_response");
  }catch(e){
   setError(e instanceof Error?e.message:"AI decision failed");
   if(e instanceof Error&&e.message.includes("sign-in"))setOwnerSignedIn(false);
  }finally{setAiBusy(false);}
 }
 function reset(){
  setRecords([SAMPLE]);setSource("sample");setTraceId(SAMPLE.traceId);setChoiceId("start_sketch");setResult(null);setError("");
 }
 return <div className="dh-shell">
   <div className="dh-heading">
    <div>
     <div className="dh-eyebrow">Nimo / Experimental framework</div>
     <h1>Decision harness</h1>
     <p>Inspect what Nimo would receive, what choices the world offers, and where a selected action would go next.</p>
    </div>
    <span className="dh-pill">Read-only test harness</span>
   </div>
   <div className="dh-notice"><a href="/decision-harness/sandbox"><strong>Open the multi-step Decision Sandbox</strong></a> to replay selected actions with isolated state and a focused Responses generation handoff. It does not use the live D1 executor.</div>
   <div className="dh-notice"><strong>Neither mode changes Nimo's world.</strong> Run simulation stays entirely in your browser. Run with AI sends only the compact context and offered choices to our owner-protected server and the OpenAI Decisions API; it incurs a small API charge. Original uploaded archives are never sent. The built-in example is synthetic.</div>
   <section className="dh-panel dh-controls">
    <div className="dh-field">
     <label htmlFor="dh-file">Decision source</label>
     <div className="dh-file-row"><label className="dh-file-button" htmlFor="dh-file">Upload context JSON</label><input id="dh-file" type="file" accept=".json,application/json" onChange={loadFile}/><button className="dh-quiet" onClick={reset} type="button">Use demo</button></div>
     <small>{source==="sample"?"Synthetic example. Upload an archived last-60m export to use real snapshots.":records.length+" archived decision"+(records.length===1?"":"s")+" loaded locally."}</small>
    </div>
    <div className="dh-field">
     <label htmlFor="dh-trace">World snapshot</label>
     <select id="dh-trace" value={traceId} onChange={e=>{setTraceId(Number(e.target.value));setResult(null);setChoiceId("");}}>
      {records.map(r=><option key={r.traceId} value={r.traceId}>#{r.traceId} · {r.capturedAt??"unknown time"}</option>)}
     </select>
    </div>
    <div className="dh-field">
     <label htmlFor="dh-choice">Test a selection</label>
     <select id="dh-choice" value={chosen} onChange={e=>{setChoiceId(e.target.value);setResult(null);}}>
      {choices.map(c=><option key={c.id} value={c.id}>{c.id} — {c.description}</option>)}
     </select>
     <small>A manual selection—not a prediction by the Decisions API.</small>
    </div>
    <div className="dh-actions">
     <button className="dh-run" type="button" onClick={run} disabled={!choices.length||aiBusy}>Run simulation</button>
     <button className="dh-run dh-ai" type="button" onClick={()=>void runWithAI()} disabled={!ownerSignedIn||!choices.length||aiBusy||Boolean(contextOf(record).visitor)}>{aiBusy?"Running AI…":"Run with AI"}</button>
     {!ownerSignedIn&&<small>Owner sign-in required for paid AI testing. <a href="/world/settings">Sign in</a></small>}
    </div>
   </section>
   {error&&<div className="dh-error" role="alert">{error}</div>}
   {result?<div className="dh-results">
    <div className="dh-summary dh-panel">
     <div><div className="dh-eyebrow">{result.ai?"Actual Decisions API selection":"Offline simulation result"}</div><h2>Decision #{result.traceId}</h2><p>Selected: <strong>{result.selection?.description??"No validated selection"}</strong></p>
      {result.ai&&<p className="dh-ai-usage">Latency: {result.ai.latencyMs??"unknown"} ms · Tokens: {String((result.ai.usage as {input_tokens?:number}|null)?.input_tokens??"unavailable")} · Est. cost: {estimatedDecisionCost(result.ai.usage)??"unavailable"} · World actions: 0</p>}
     </div>
     <div className="dh-stats"><div><span>Available choices</span><strong>{result.choices.length}</strong></div><div><span>Original payload</span><strong>{(result.counts.original/1000).toFixed(1)}k</strong></div><div><span>Proposed payload</span><strong>{(result.counts.proposal/1000).toFixed(1)}k</strong></div></div>
     <button type="button" className="dh-download" onClick={()=>download("nimo-harness-trace-"+result.traceId+".json",result)}>Download full trace</button>
    </div>
    <div className="dh-detail">
     <nav className="dh-stage-list dh-panel" aria-label="Trace stages">
      {result.stages.map((s,i)=><button key={s.id} type="button" onClick={()=>setActive(s.id)} className={"dh-stage "+(stage?.id===s.id?"selected":"")}>
       <span className="dh-stage-number">{String(i+1).padStart(2,"0")}</span>
       <span className="dh-stage-meta"><strong>{s.title}</strong><small>{s.source.replaceAll("_"," ")} · {s.status.replaceAll("_"," ")}</small></span>
      </button>)}
     </nav>
     {stage&&<section className="dh-stage-view dh-panel">
      <div className="dh-stage-head"><div><div className="dh-eyebrow">Stage {result.stages.indexOf(stage)+1} / {result.stages.length}</div><h3>{stage.title}</h3><p>{stage.note}</p></div><span className="dh-pill dh-status">{stage.status.replaceAll("_"," ")}</span></div>
      <div className="dh-code-block"><div className="dh-code-head"><strong>{stage.id==="context"?"Original world context":"Input"}</strong><button type="button" onClick={()=>navigator.clipboard.writeText(nice(stage.input))}>Copy JSON</button></div><pre>{nice(stage.input)}</pre></div>
      <div className="dh-code-block"><div className="dh-code-head"><strong>{stage.id==="context"?"New compact decision context":"Output"}</strong><button type="button" onClick={()=>navigator.clipboard.writeText(nice(stage.output))}>Copy JSON</button></div><pre>{nice(stage.output)}</pre></div>
     </section>}
    </div>
   </div>:<section className="dh-empty dh-panel">
    <div className="dh-eyebrow">Ready to inspect</div>
    <h2>Try Nimo's next decision without changing his world.</h2>
    <p>Run simulation manually or sign in as the owner and use Run with AI to get an actual Decisions API selection. Both options preserve a nine-stage input/output trace.</p>
   </section>}
   <div className="dh-footnote">Experimental feature branch only. Full historic prompts can contain private information; avoid sharing exported traces publicly. Only the compact context is submitted for an explicit AI run. Character counts are not token counts or billable usage.</div>
  </div>;
}
