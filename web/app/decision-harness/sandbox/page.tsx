"use client";
import {ChangeEvent,useEffect,useMemo,useState} from "react";
import {ArchiveRecord,SAMPLE,contextOf,type Choice} from "../../../lib/decision-harness";
import {createSandbox,sandboxFrame,stepSandbox,supportsSandboxChoice,type SandboxState} from "../../../lib/decision-sandbox";
import "../harness.css";

const json=(v:unknown)=>JSON.stringify(v,null,2);
export default function SandboxPage(){
 const [record,setRecord]=useState<ArchiveRecord>(SAMPLE);
 const [sandbox,setSandbox]=useState<SandboxState>(()=>createSandbox(contextOf(SAMPLE).world));
 const [manual,setManual]=useState("travel:south");
 const [mode,setMode]=useState<"manual"|"ai">("manual");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [owner,setOwner]=useState(false);
 const [last,setLast]=useState<unknown>(null);
 const [apiHistory,setApiHistory]=useState<{kind:string;usage:unknown;latencyMs:number|null}[]>([]);
 useEffect(()=>{void fetch("/api/world/session",{cache:"no-store"}).then(r=>r.json()).then(x=>setOwner(Boolean(x.authenticated))).catch(()=>{});},[]);
 const frame=useMemo(()=>sandboxFrame(sandbox),[sandbox]);
 const supported=frame.choices.filter(supportsSandboxChoice);
 const selected=supported.some(c=>c.id===manual)?manual:(supported[0]?.id??"");
 const position=sandbox.world.perception?.position??{};
 const latest=sandbox.history.at(-1);
 async function upload(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];if(!file)return;
  try{
   if(file.size>20_000_000)throw Error("Archive exceeds 20MB");
   const data=JSON.parse(await file.text());
   const records=(Array.isArray(data?.records)?data.records:Array.isArray(data)?data:[data]) as ArchiveRecord[];
   const first=records.find(r=>Number.isSafeInteger(r.traceId)&&Array.isArray(r.request?.input));
   if(!first)throw Error("No compatible archived input found");
   const snapshot=contextOf(first);
   if(snapshot.visitor)throw Error("Visitor messages are not yet supported by the isolated replay");
   setRecord(first);setSandbox(createSandbox(snapshot.world));
   setApiHistory([]);setLast(null);setError("");setManual("");setMode("manual");
  }catch(e){setError(e instanceof Error?e.message:"Could not load archive");}
  event.target.value="";
 }
 function reset(){
  setSandbox(createSandbox(contextOf(record).world));setApiHistory([]);setLast(null);setError("");
 }
 async function step(){
  if(busy||sandbox.step>=30)return;
  setBusy(true);setError("");
  try{
   let choice:Choice|undefined;
   const trace:{selection?:unknown;generation?:unknown;validated?:unknown}={};
   if(mode==="ai"){
    if(!owner)throw Error("Sign in as Nimo's owner on this preview to make API calls");
    const response=await fetch("/api/decision-harness/run",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({traceId:record.traceId,context:frame.context,choices:frame.choices.map(c=>({id:c.id,description:c.description}))})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error??"Decisions API failed");
    trace.selection=data;
    setApiHistory(h=>[...h,{kind:"decisions",usage:data.usage,latencyMs:data.latencyMs??null}]);
    if(!data.selectionValid)throw Error("Decisions API selected no valid action");
    choice=frame.choices.find(c=>c.id===data.selectedChoice);
   }else choice=supported.find(c=>c.id===selected);
   if(!choice)throw Error("No selected choice");
   if(!supportsSandboxChoice(choice)){
    setLast({selected:choice.id,decision:trace.selection,result:"This action has no isolated replay executor yet. No change made."});
    throw Error("AI chose "+choice.id+"; this sandbox does not emulate that action yet.");
   }
   let generated:null|Record<string,unknown>=null;
   if(choice.task){
    if(!owner)throw Error("Generation requires owner sign-in; choose a direct action for offline replay");
    const task=choice.task;
    const w=sandbox.world;
    const context={
     self:frame.context.self,present:frame.context.present,
     continuity:{memories:frame.context.continuity.memories,projects:frame.context.continuity.projects,
      unfinishedSketch:frame.context.continuity.unfinishedSketch},
     relevantWorkspace:task==="write_document"?(w.workspace??[]).slice(0,12):undefined,
     sketch:task.includes("sketch")?w.sketchbook:undefined,
     knownObjects:task==="remember_object"?w.objectMemory:undefined
    };
    const response=await fetch("/api/decision-harness/generate",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({task,choiceId:choice.id,context})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error??"Responses generation failed");
    generated=data.generated;
    trace.generation=data;
    setApiHistory(h=>[...h,{kind:"responses",usage:data.usage,latencyMs:data.latencyMs??null}]);
   }
   const next=stepSandbox(sandbox,choice.id,generated);
   trace.validated=next.history.at(-1);
   setLast({selected:choice.id,...trace});
   setSandbox(next);
  }catch(e){setError(e instanceof Error?e.message:"Step failed");}
  finally{setBusy(false);}
 }
 const tokenTotals=apiHistory.reduce((a,x)=>{
  const usage=x.usage as {input_tokens?:number;output_tokens?:number}|null;
  return {input:a.input+(usage?.input_tokens??0),output:a.output+(usage?.output_tokens??0)};
 },{input:0,output:0});
 return <main className="dh-shell">
  <div className="dh-heading"><div>
   <div className="dh-eyebrow">Nimo / experimental replay</div>
   <h1>Decision sandbox</h1>
   <p>Run a selection, generate missing action parameters if necessary, and replay supported outcomes in an isolated copy of a historical world snapshot.</p>
  </div><span className="dh-pill">Local state only</span></div>
  <div className="dh-notice"><strong>Not the live Cloudflare D1 executor.</strong> This is an in-browser replay of a limited set of actions using Nimo's shared map and pathfinding rules. It can test handoffs and repeated decisions, but food effects, storage transactions, Oracle calls and other live mechanics are not emulated. No production world writes occur. AI and generation calls require owner sign-in and incur API charges.</div>
  <section className="dh-panel dh-controls dh-sandbox-controls">
   <div className="dh-field"><label htmlFor="sandbox-upload">World snapshot</label><input id="sandbox-upload" type="file" accept=".json,application/json" onChange={e=>void upload(e)}/><small>#{record.traceId} — archived or synthetic</small></div>
   <div className="dh-field"><label htmlFor="sandbox-mode">Selection mode</label>
    <select id="sandbox-mode" value={mode} onChange={e=>setMode(e.target.value as "manual"|"ai")}><option value="manual">Manual decision</option><option value="ai">Decisions API (real AI)</option></select>
   </div>
   <div className="dh-field"><label htmlFor="sandbox-action">Action to replay</label>
    <select id="sandbox-action" value={selected} onChange={e=>setManual(e.target.value)} disabled={mode==="ai"}>
     {supported.map(c=><option key={c.id} value={c.id}>{c.id}</option>)}
    </select><small>{frame.choices.length-supported.length} choices have no safe replay implementation</small>
   </div>
   <div className="dh-actions"><button type="button" className="dh-run" disabled={busy||sandbox.step>=30} onClick={()=>void step()}>{busy?"Running…":"Run one sandbox step"}</button>
    <button type="button" className="dh-quiet" disabled={busy} onClick={reset}>Reset</button>
    {!owner&&<small>For AI and generation, <a href="/world/settings">sign in as owner</a>.</small>}
   </div>
  </section>
  {error&&<div className="dh-error" role="alert">{error}</div>}
  <section className="dh-panel dh-summary">
   <div><div className="dh-eyebrow">Isolated sandbox</div><h2>Step {sandbox.step} / 30</h2><p>Position: ({String(position.x)},{String(position.y)}) · Inventory slots: {String(sandbox.world.garden?.inventoryUsed??"?")}/{String(sandbox.world.garden?.capacity??"?")}</p></div>
   <div className="dh-stats"><div><span>Decisions calls</span><strong>{apiHistory.filter(x=>x.kind==="decisions").length}</strong></div>
    <div><span>Responses calls</span><strong>{apiHistory.filter(x=>x.kind==="responses").length}</strong></div>
    <div><span>Input tokens</span><strong>{tokenTotals.input}</strong></div>
    <div><span>Output tokens</span><strong>{tokenTotals.output}</strong></div></div>
  </section>
  <div className="dh-detail">
   <section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><div className="dh-eyebrow">Execution trace</div><h3>History</h3><p>Only simulated outcomes; not verified Cloudflare execution.</p></div></div>
    {sandbox.history.length===0?<p>No steps yet.</p>:<ol className="dh-sandbox-history">{sandbox.history.map((h,i)=><li key={i}>
     <strong>{h.action}</strong> — {h.status}<p>{h.summary}</p>
     {h.route&&<small>Route: {h.route.map(p=>`(${p.x},${p.y})`).join(" → ")}</small>}
    </li>)}</ol>}
   </section>
   <section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><div className="dh-eyebrow">Latest step</div><h3>Selection → generation → replay</h3></div></div>
    <div className="dh-code-block"><div className="dh-code-head"><strong>Full trace</strong><button onClick={()=>navigator.clipboard.writeText(json(last))}>Copy</button></div><pre>{json(last??"No step selected")}</pre></div>
    <div className="dh-code-block"><div className="dh-code-head"><strong>Current compact context</strong><button onClick={()=>navigator.clipboard.writeText(json(frame.context))}>Copy</button></div><pre>{json(frame.context)}</pre></div>
   </section>
  </div>
  <div className="dh-footnote"><a href="/decision-harness">Return to the single-decision harness</a>. Sandbox records are kept in this browser session only. Refreshing resets the replay.</div>
 </main>;
}
