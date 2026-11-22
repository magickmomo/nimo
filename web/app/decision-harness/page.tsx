"use client";

import {ChangeEvent, useMemo, useState} from "react";
import {ArchiveRecord, Report, SAMPLE, runPreview, contextOf, offerChoices} from "../../lib/decision-harness";
import "./harness.css";

const nice=(v:unknown)=>JSON.stringify(v,null,2);
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
    <span className="dh-pill">Offline simulation</span>
   </div>
   <div className="dh-notice"><strong>No model calls or world changes.</strong> The Run button builds a dry-run decision trace in your browser. Uploaded logs stay on this device and are not sent to Nimo, OpenAI or the site’s servers. The default example is synthetic.</div>
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
    <button className="dh-run" type="button" onClick={run} disabled={!choices.length}>Run simulation</button>
   </section>
   {error&&<div className="dh-error" role="alert">{error}</div>}
   {result?<div className="dh-results">
    <div className="dh-summary dh-panel">
     <div><div className="dh-eyebrow">Simulation result</div><h2>Decision #{result.traceId}</h2><p>Selected: <strong>{result.selection?.description??"No selection"}</strong></p></div>
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
    <h2>Run a decision without affecting the world.</h2>
    <p>The trace will show the context builder, offered actions, proposed Decisions API request, manual selection, handoff, and the steps that have not actually executed.</p>
   </section>}
   <div className="dh-footnote">Experimental feature branch only. Full historic prompts can contain private information; avoid sharing exported traces publicly. Character counts are not token counts or billable usage.</div>
  </div>;
}
