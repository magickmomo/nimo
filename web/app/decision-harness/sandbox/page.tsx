"use client";
import {ChangeEvent,useEffect,useMemo,useRef,useState} from "react";
import {ArchiveRecord,SAMPLE,contextOf,type Choice} from "../../../lib/decision-harness";
import {createSandbox,sandboxFrame,stepSandbox,supportsSandboxChoice,type SandboxState} from "../../../lib/decision-sandbox";
import "../harness.css";

const json=(v:unknown)=>JSON.stringify(v,null,2);
type UsageRow={kind:"decisions"|"responses";usage:unknown;latencyMs:number|null};
const decisionCost=(usage:unknown)=>{
 const u=usage as {input_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number}}|null;
 if(typeof u?.input_tokens!=="number")return 0;
 const total=u.input_tokens,cached=Math.min(total,Math.max(0,u.input_tokens_details?.cached_tokens??0));
 const written=Math.min(total-cached,Math.max(0,u.input_tokens_details?.cache_write_tokens??0));
 return ((total-cached-written)*0.10+cached*0.01+written*0.125)/1_000_000;
};
const describeCost=(cost:number)=>"$"+cost.toFixed(6);

export default function SandboxPage(){
 const [record,setRecord]=useState<ArchiveRecord>(SAMPLE);
 const [sandbox,setSandbox]=useState<SandboxState>(()=>createSandbox(contextOf(SAMPLE).world));
 const [manual,setManual]=useState("travel:south");
 const [mode,setMode]=useState<"manual"|"ai">("manual");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [owner,setOwner]=useState(false);
 const [last,setLast]=useState<unknown>(null);
 const [apiHistory,setApiHistory]=useState<UsageRow[]>([]);
 const [runProgress,setRunProgress]=useState<{completed:number;target:number;status:string}|null>(null);
 const activeRef=useRef(false);
 const stoppedRef=useRef(false);
 const controllerRef=useRef<AbortController|null>(null);
 useEffect(()=>()=>{stoppedRef.current=true;controllerRef.current?.abort();},[]);
 const halt=()=>{stoppedRef.current=true;controllerRef.current?.abort();setRunProgress(p=>p?{...p,status:"Stopping after the current request…"}:p);};
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
   setApiHistory([]);setLast(null);setRunProgress(null);setError("");setManual("");setMode("manual");
  }catch(e){setError(e instanceof Error?e.message:"Could not load archive");}
  event.target.value="";
 }
 function reset(){
  setSandbox(createSandbox(contextOf(record).world));setApiHistory([]);setLast(null);setRunProgress(null);setError("");
 }
 async function executeOne(current:SandboxState, chosenMode:"manual"|"ai",choiceId:string,signal:AbortSignal):Promise<{next:SandboxState;trace:unknown;api:UsageRow[]}>{
   const currentFrame=sandboxFrame(current);
   let choice:Choice|undefined;
   const trace:{selection?:unknown;generation?:unknown;validated?:unknown}={};
   const api:UsageRow[]=[];
   if(chosenMode==="ai"){
     if(!owner)throw Error("Sign in as Nimo's owner on this preview to make API calls");
     const response=await fetch("/api/decision-harness/run",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({traceId:record.traceId,context:currentFrame.context,
         choices:currentFrame.choices.map(c=>({id:c.id,description:c.description}))}),signal
     });
     const data=await response.json();
     if(!response.ok)throw Error(data.error??"Decisions API failed");
     trace.selection=data;
     api.push({kind:"decisions",usage:data.usage,latencyMs:data.latencyMs??null});
     if(!data.selectionValid)throw Error("Decisions API selected no valid action");
     choice=currentFrame.choices.find(c=>c.id===data.selectedChoice);
   }else choice=currentFrame.choices.find(c=>c.id===choiceId);
   if(!choice)throw Error("Selected action is not offered");
   if(!supportsSandboxChoice(choice)){
     const err=new Error("AI chose "+choice.id+"; this sandbox cannot replay that action. Stopped without executing it.");
     Object.assign(err,{selectedAction:choice.id});
     throw err;
   }
   let generated:null|Record<string,unknown>=null;
   if(choice.task){
     if(!owner)throw Error("Generation requires owner sign-in");
     const task=choice.task,w=current.world;
     const context={
       self:currentFrame.context.self,present:currentFrame.context.present,
       continuity:{memories:currentFrame.context.continuity.memories,
        projects:currentFrame.context.continuity.projects,
        unfinishedSketch:currentFrame.context.continuity.unfinishedSketch},
       relevantWorkspace:task==="write_document"?(w.workspace??[]).slice(0,12):undefined,
       sketch:task.includes("sketch")?w.sketchbook:undefined,
       knownObjects:task==="remember_object"?w.objectMemory:undefined
     };
     const response=await fetch("/api/decision-harness/generate",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({task,choiceId:choice.id,context}),signal
     });
     const data=await response.json();
     if(!response.ok)throw Error(data.error??"Responses generation failed");
     generated=data.generated;
     trace.generation=data;
     api.push({kind:"responses",usage:data.usage,latencyMs:data.latencyMs??null});
   }
   const next=stepSandbox(current,choice.id,generated);
   trace.validated=next.history.at(-1);
   return {next,trace:{selected:choice.id,...trace},api};
 }
 async function step(){
   if(activeRef.current||sandbox.step>=30)return;
   activeRef.current=true;stoppedRef.current=false;setBusy(true);setError("");setRunProgress(null);
   const controller=new AbortController();controllerRef.current=controller;
   try{
     const result=await executeOne(sandbox,mode,selected,controller.signal);
     setApiHistory(h=>[...h,...result.api]);
     setLast(result.trace);setSandbox(result.next);
     const outcome=result.next.history.at(-1);
     if(outcome?.status!=="simulated_success")setError(outcome?.summary??"Sandbox replay failed");
   }catch(e){if(!stoppedRef.current)setError(e instanceof Error?e.message:"Step failed");}
   finally{controllerRef.current=null;activeRef.current=false;setBusy(false);}
 }
 async function runTwenty(){
   if(activeRef.current||!owner||sandbox.step>=30)return;
   activeRef.current=true;stoppedRef.current=false;setBusy(true);setError("");
   const target=Math.min(20,30-sandbox.step);
   setRunProgress({completed:0,target,status:"Running"});
   let current=sandbox;
   let completed=0;
   try{
     for(let i=0;i<target;i++){
       if(stoppedRef.current)break;
       const controller=new AbortController();controllerRef.current=controller;
       const result=await executeOne(current,"ai","",controller.signal);
       controllerRef.current=null;
       // Abort/stop does not retroactively execute a result returned after cancellation.
       if(stoppedRef.current)break;
       current=result.next;
       setSandbox(current);setLast(result.trace);
       setApiHistory(h=>[...h,...result.api]);
       completed++;
       const outcome=current.history.at(-1);
       setRunProgress({completed,target,status:"Running"});
       if(outcome?.status!=="simulated_success"){
         setError("Stopped after "+completed+" step(s): "+(outcome?.summary??"Sandbox action failed"));
         break;
       }
     }
     setRunProgress({completed,target,status:stoppedRef.current?"Stopped by owner":
       completed===target?"Completed": "Stopped on an unsuccessful step"});
   }catch(e){
     if(stoppedRef.current)setRunProgress({completed,target,status:"Stopped by owner"});
     else{
       setError((e instanceof Error?e.message:"AI step failed")+" — stopped after "+completed+" successful step(s).");
       setRunProgress({completed,target,status:"Stopped on an error"});
     }
   }finally{controllerRef.current=null;activeRef.current=false;setBusy(false);}
 }
 const tokenTotals=apiHistory.reduce((a,x)=>{
  const usage=x.usage as {input_tokens?:number;output_tokens?:number}|null;
  return {input:a.input+(usage?.input_tokens??0),output:a.output+(usage?.output_tokens??0)};
 },{input:0,output:0});
 const selectionEstimate=apiHistory.filter(x=>x.kind==="decisions").reduce((sum,x)=>sum+decisionCost(x.usage),0);
 return <main className="dh-shell">
  <div className="dh-heading"><div>
   <div className="dh-eyebrow">Nimo / experimental replay</div>
   <h1>Decision sandbox</h1>
   <p>Run a selection, generate missing action parameters if necessary, and replay supported outcomes in an isolated copy of a historical world snapshot.</p>
  </div><span className="dh-pill">Local state only</span></div>
  <div className="dh-notice"><strong>Not the live Cloudflare D1 executor.</strong> This is an in-browser replay of a limited set of actions using Nimo's shared map and pathfinding rules. It can test handoffs and repeated decisions, but food effects, storage transactions, Oracle calls and other live mechanics are not emulated. No production world writes occur. AI and generation calls require owner sign-in and incur API charges.</div>
  <section className="dh-panel dh-controls dh-sandbox-controls">
   <div className="dh-field"><label htmlFor="sandbox-upload">World snapshot</label><input id="sandbox-upload" type="file" accept=".json,application/json" onChange={e=>void upload(e)} disabled={busy}/><small>#{record.traceId} — archived or synthetic</small></div>
   <div className="dh-field"><label htmlFor="sandbox-mode">Selection mode</label>
    <select id="sandbox-mode" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as "manual"|"ai")}><option value="manual">Manual decision</option><option value="ai">Decisions API (real AI)</option></select>
   </div>
   <div className="dh-field"><label htmlFor="sandbox-action">Action to replay</label>
    <select id="sandbox-action" value={selected} onChange={e=>setManual(e.target.value)} disabled={busy||mode==="ai"}>
     {supported.map(c=><option key={c.id} value={c.id}>{c.id}</option>)}
    </select><small>{frame.choices.length-supported.length} choices have no safe replay implementation</small>
   </div>
   <div className="dh-actions">
    <button type="button" className="dh-run" disabled={busy||sandbox.step>=30} onClick={()=>void step()}>Run one sandbox step</button>
    <button type="button" className="dh-run dh-ai" disabled={busy||!owner||sandbox.step>=30} onClick={()=>void runTwenty()}>Run 20 AI decisions</button>
    {busy?<button type="button" className="dh-quiet" onClick={halt}>Stop run</button>:
      <button type="button" className="dh-quiet" onClick={reset}>Reset</button>}
    {!owner&&<small>For AI and generation, <a href="/world/settings">sign in as owner</a>.</small>}
    <small>Batch stops on unsupported actions, validation failures or API errors. Maximum 30 total replay steps. Each AI call costs money.</small>
   </div>
  </section>
  {runProgress&&<section className="dh-panel dh-batch-progress" role="status">
    <strong>{runProgress.status}</strong> — {runProgress.completed} / {runProgress.target} decisions
    <progress max={runProgress.target} value={runProgress.completed} aria-label="Batch progress"/>
   </section>}
  {error&&<div className="dh-error" role="alert">{error}</div>}
  <section className="dh-panel dh-summary">
   <div><div className="dh-eyebrow">Isolated sandbox</div><h2>Step {sandbox.step} / 30</h2><p>Position: ({String(position.x)},{String(position.y)}) · Inventory slots: {String(sandbox.world.garden?.inventoryUsed??"?")}/{String(sandbox.world.garden?.capacity??"?")}</p></div>
   <div className="dh-stats"><div><span>Decisions calls</span><strong>{apiHistory.filter(x=>x.kind==="decisions").length}</strong></div>
    <div><span>Responses calls</span><strong>{apiHistory.filter(x=>x.kind==="responses").length}</strong></div>
    <div><span>Input tokens</span><strong>{tokenTotals.input}</strong></div>
    <div><span>Output tokens</span><strong>{tokenTotals.output}</strong></div>
    <div><span>Est. selection cost</span><strong>{describeCost(selectionEstimate)}</strong></div></div>
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
  <div className="dh-footnote"><strong>Cost comparison:</strong> Selection costs above are estimates from reported Decisions API token usage; they exclude Responses API generation and infrastructure. The sandbox records Responses token usage but cannot yet calculate a verified total bill or savings against Legacy because it has no matched baseline. <a href="/decision-harness">Return to single-decision harness</a>. Browser-only replay; refreshing resets it.</div>
 </main>;
}
