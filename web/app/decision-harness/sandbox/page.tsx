"use client";
import {ChangeEvent,useEffect,useMemo,useRef,useState} from "react";
import {ArchiveRecord,SAMPLE,contextOf,type Choice} from "../../../lib/decision-harness";
import {createSandbox,sandboxFrame,stepSandbox,supportsSandboxChoice,type SandboxState} from "../../../lib/decision-sandbox";
import {buildExperimentalContext,type ContextTier} from "../../../lib/decision-context-experiment";
import "../harness.css";

const json=(v:unknown)=>JSON.stringify(v,null,2);
type UsageRow={kind:"decisions"|"responses";usage:unknown;latencyMs:number|null};
type StepLog={
 step:number;startedAt:string;completedAt:string;status:"success"|"failed";
 selectionMode:"manual"|"ai";contextTier:ContextTier;action:string|null;
 context:unknown;offeredChoices:unknown;selectionResponse:unknown;
 generationResponse:unknown;outcome:unknown;usage:UsageRow[];
 error?:string;
};
const saveJson=(name:string,payload:unknown)=>{
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1500);
};

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
 const [loadingLive,setLoadingLive]=useState(false);
 const [captureSource,setCaptureSource]=useState<{type:"live"|"uploaded";capturedAt:string|null;fetchedAt?:string|null}|null>(null);
 const [sandbox,setSandbox]=useState<SandboxState>(()=>createSandbox(contextOf(SAMPLE).world));
 const [manual,setManual]=useState("travel:south");
 const [mode,setMode]=useState<"manual"|"ai">("ai");
 const [contextTier,setContextTier]=useState<ContextTier>("E");
 const [batchSize,setBatchSize]=useState<10|20>(20);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [owner,setOwner]=useState(false);
 const [last,setLast]=useState<unknown>(null);
 const [apiHistory,setApiHistory]=useState<UsageRow[]>([]);
 const [stepLogs,setStepLogs]=useState<StepLog[]>([]);
 const [runErrors,setRunErrors]=useState<string[]>([]);
 const [runProgress,setRunProgress]=useState<{completed:number;target:number;status:string}|null>(null);
 const activeRef=useRef(false);
 const stoppedRef=useRef(false);
 const controllerRef=useRef<AbortController|null>(null);
 useEffect(()=>()=>{stoppedRef.current=true;controllerRef.current?.abort();},[]);
 const halt=()=>{stoppedRef.current=true;controllerRef.current?.abort();setRunProgress(p=>p?{...p,status:"Stopping after the current request…"}:p);};
 useEffect(()=>{void fetch("/api/world/session",{cache:"no-store"}).then(r=>r.json()).then(x=>setOwner(Boolean(x.authenticated))).catch(()=>{});},[]);
 const frame=useMemo(()=>{const f=sandboxFrame(sandbox);return {...f,context:buildExperimentalContext(sandbox.world,sandbox.history,contextTier)};},[sandbox,contextTier]);
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
   const first=records.find(r=>Number.isSafeInteger(r.traceId)&&r.traceId!==SAMPLE.traceId&&Array.isArray(r.request?.input));
   if(!first)throw Error("No real archived decision input found. Upload the last-60-minute decision-input export, not a sandbox or comparison export.");
   const snapshot=contextOf(first);
   if(snapshot.visitor)throw Error("Visitor messages are not yet supported by the isolated replay");
   setRecord(first);setSandbox(createSandbox(snapshot.world));
   setCaptureSource({type:"uploaded",capturedAt:first.capturedAt??null});
   setApiHistory([]);setStepLogs([]);setRunErrors([]);setLast(null);setRunProgress(null);setError("");setManual("");setMode("ai");
  }catch(e){setError(e instanceof Error?e.message:"Could not load archive");}
  event.target.value="";
 }
 async function loadLatestLiveContext(){
  if(busy||loadingLive||!owner)return;
  setLoadingLive(true);setError("");
  try{
   const res=await fetch("/api/decision-harness/live-context",{cache:"no-store"});
   const data=await res.json() as {error?:string;record?:ArchiveRecord;capturedAt?:string;fetchedAt?:string};
   if(!res.ok||!data.record)throw Error(data.error??"Could not fetch live context");
   const latest=data.record;
   if(!Number.isSafeInteger(latest.traceId)||latest.traceId===SAMPLE.traceId)throw Error("Invalid live decision capture");
   const snapshot=contextOf(latest);
   if(snapshot.visitor)throw Error("Latest input was a visitor turn; use a normal autonomous archive");
   const isolated=createSandbox(snapshot.world);
   setRecord(latest);setSandbox(isolated);
   setStepLogs([]);setApiHistory([]);setRunErrors([]);setLast(null);setRunProgress(null);
   setManual("");setMode("ai");setContextTier("E");
   setCaptureSource({type:"live",capturedAt:latest.capturedAt??data.capturedAt??null,fetchedAt:data.fetchedAt??null});
  }catch(e){setError(e instanceof Error?e.message:"Unable to load real live input");}
  finally{setLoadingLive(false);}
 }
 function reset(){
  setSandbox(createSandbox(contextOf(record).world));setApiHistory([]);setStepLogs([]);setRunErrors([]);setLast(null);setRunProgress(null);setError("");
 }
 async function executeOne(current:SandboxState, chosenMode:"manual"|"ai",choiceId:string,signal:AbortSignal):Promise<{next:SandboxState;trace:unknown;api:UsageRow[];log:StepLog}>{
   const f=sandboxFrame(current);
   const currentFrame={...f,context:buildExperimentalContext(current.world,current.history,contextTier)};
   const log:StepLog={step:current.step+1,startedAt:new Date().toISOString(),completedAt:"",
     status:"failed",selectionMode:chosenMode,contextTier,action:null,context:currentFrame.context,
     offeredChoices:currentFrame.choices,selectionResponse:null,generationResponse:null,outcome:null,usage:[]};
   let choice:Choice|undefined;
   const trace:{selection?:unknown;generation?:unknown;validated?:unknown}={};
   const api:UsageRow[]=[];
   try{
   if(chosenMode==="ai"){
     if(!owner)throw Error("Sign in as Nimo's owner on this preview to make API calls");
     const response=await fetch("/api/decision-harness/run",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({traceId:record.traceId,context:currentFrame.context,
         choices:currentFrame.choices.map(c=>({id:c.id,description:c.description}))}),signal
     });
     const data=await response.json();
     if(!response.ok)throw Error(data.error??"Decisions API failed");
     trace.selection=data;log.selectionResponse=data;
     api.push({kind:"decisions",usage:data.usage,latencyMs:data.latencyMs??null});
     if(!data.selectionValid)throw Error("Decisions API selected no valid action");
     choice=currentFrame.choices.find(c=>c.id===data.selectedChoice);
   }else choice=currentFrame.choices.find(c=>c.id===choiceId);
   if(!choice)throw Error("Selected action is not offered");
   log.action=choice.id;
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
       goalAwareness:currentFrame.context.goalAwareness,recentExperience:currentFrame.context.recentExperience,
       adaptiveKnowledge:currentFrame.context.adaptiveKnowledge,
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
     // Log unsuccessful generations too, including retry diagnostics and paid usage.
     // The API never returns rejected drawing content, only validation paths.
     trace.generation=data;log.generationResponse=data;
     if(data.usage)api.push({kind:"responses",usage:data.usage,latencyMs:data.latencyMs??null});
     if(!response.ok){
       const detail=Array.isArray(data.attempts)?data.attempts.map((a:{issues?:string[]})=>a.issues?.join("; ")).filter(Boolean).join(" | "):"";
       throw Error((data.error??"Responses generation failed")+(detail?" — "+detail:""));
     }
     generated=data.generated;
   }
   const next=stepSandbox(current,choice.id,generated);
   trace.validated=next.history.at(-1);
   log.outcome=trace.validated;
   log.status=next.history.at(-1)?.status==="simulated_success"?"success":"failed";
   log.completedAt=new Date().toISOString();log.usage=[...api];
   return {next,trace:{selected:choice.id,...trace},api,log};
   }catch(e){
     log.error=e instanceof Error?e.message:String(e);
     log.completedAt=new Date().toISOString();log.usage=[...api];
     // Preserve paid usage and failed selections even when a step cannot execute.
     const error=e instanceof Error?e:new Error(String(e));
     Object.assign(error,{stepLog:log,partialUsage:api});
     throw error;
   }
 }
 async function step(){
   if(activeRef.current||sandbox.step>=30)return;
   activeRef.current=true;stoppedRef.current=false;setBusy(true);setError("");setRunProgress(null);
   const controller=new AbortController();controllerRef.current=controller;
   try{
     const result=await executeOne(sandbox,mode,selected,controller.signal);
     setApiHistory(h=>[...h,...result.api]);
     setStepLogs(h=>[...h,result.log]);
     setLast(result.trace);setSandbox(result.next);
     const outcome=result.next.history.at(-1);
     if(outcome?.status!=="simulated_success")setError(outcome?.summary??"Sandbox replay failed");
   }catch(e){
     const diagnostic=e as Error & {stepLog?:StepLog;partialUsage?:UsageRow[]};
     if(diagnostic.stepLog){
       setStepLogs(h=>[...h,diagnostic.stepLog!]);
       setApiHistory(h=>[...h,...(diagnostic.partialUsage??[])]);
     }
     if(!stoppedRef.current){
       const message=e instanceof Error?e.message:"Step failed";
       setError(message);setRunErrors(h=>[...h,message]);
     }
   }
   finally{controllerRef.current=null;activeRef.current=false;setBusy(false);}
 }
 async function runTwenty(){
   if(activeRef.current||!owner||sandbox.step>=30||record.traceId===SAMPLE.traceId)return;
   activeRef.current=true;stoppedRef.current=false;setBusy(true);setError("");
   const target=Math.min(batchSize,30-sandbox.step);
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
       setStepLogs(h=>[...h,result.log]);
       setApiHistory(h=>[...h,...result.api]);
       completed++;
       const outcome=current.history.at(-1);
       setRunProgress({completed,target,status:"Running"});
       if(outcome?.status!=="simulated_success"){
         const message="Stopped after "+completed+" step(s): "+(outcome?.summary??"Sandbox action failed");
         setError(message);setRunErrors(h=>[...h,message]);
         break;
       }
     }
     setRunProgress({completed,target,status:stoppedRef.current?"Stopped by owner":
       completed===target?"Completed": "Stopped on an unsuccessful step"});
   }catch(e){
     const diagnostic=e as Error & {stepLog?:StepLog;partialUsage?:UsageRow[]};
     if(diagnostic.stepLog){
       setStepLogs(h=>[...h,diagnostic.stepLog!]);
       setApiHistory(h=>[...h,...(diagnostic.partialUsage??[])]);
     }
     if(stoppedRef.current)setRunProgress({completed,target,status:"Stopped by owner"});
     else{
       const message=(e instanceof Error?e.message:"AI step failed")+" — stopped after "+completed+" successful step(s).";
       setError(message);setRunErrors(h=>[...h,message]);
       setRunProgress({completed,target,status:"Stopped on an error"});
     }
   }finally{controllerRef.current=null;activeRef.current=false;setBusy(false);}
 }
 const tokenTotals=apiHistory.reduce((a,x)=>{
  const usage=x.usage as {input_tokens?:number;output_tokens?:number}|null;
  return {input:a.input+(usage?.input_tokens??0),output:a.output+(usage?.output_tokens??0)};
 },{input:0,output:0});
 const selectionEstimate=apiHistory.filter(x=>x.kind==="decisions").reduce((sum,x)=>sum+decisionCost(x.usage),0);
 const outcomes=sandbox.history;
 const moves=outcomes.filter(h=>h.status==="simulated_success"&&h.action.startsWith("travel:"));
 const movementReversals=moves.reduce((sum,h,i)=>{
  const prev=moves[i-1],before=prev?.before as {position?:{x?:number;y?:number}}|undefined,after=h.after as {position?:{x?:number;y?:number}};
  return sum+Number(Boolean(prev&&before?.position?.x===after?.position?.x&&before?.position?.y===after?.position?.y));
 },0);
 const repeatedReflections=outcomes.filter((h,i)=>i>0&&h.action==="reflect"&&outcomes[i-1].action==="reflect").length;
 const goalChanges=outcomes.filter(h=>h.action==="reflect"&&h.status==="simulated_success");
 const completedGoals=goalChanges.filter(h=>h.legacyDecision?.intentDisposition==="complete").length;
 const replacedGoals=goalChanges.filter(h=>h.legacyDecision?.intentDisposition==="replace").length;
 const abandonedGoals=goalChanges.filter(h=>h.legacyDecision?.intentDisposition==="abandon").length;
 const unchangedStateSteps=outcomes.filter(h=>{
  const b=h.before as {goal?:unknown;position?:unknown;inventoryUsed?:unknown};
  const a=h.after as {goal?:unknown;position?:unknown;inventoryUsed?:unknown};
  return h.status==="simulated_success"&&JSON.stringify([b.goal,b.position,b.inventoryUsed])===JSON.stringify([a.goal,a.position,a.inventoryUsed]);
 }).length;
 const actionFrequency=Object.fromEntries([...new Set(outcomes.map(h=>h.action))].map(a=>[a,outcomes.filter(h=>h.action===a).length]));
 const diagnostics={movementReversals,repeatedReflections,completedGoals,replacedGoals,abandonedGoals,unchangedStateSteps,
  uniqueActions:Object.keys(actionFrequency).length,actionFrequency,
  note:"State-change count compares position, inventory count and goal only; writing and creative actions can change other state. All outcomes simulated."};
 function exportFullRun(){
   const decisionCalls=apiHistory.filter(x=>x.kind==="decisions").length;
   const responseCalls=apiHistory.filter(x=>x.kind==="responses").length;
   const summary={
     stepsAttempted:stepLogs.length,stepsSucceeded:stepLogs.filter(x=>x.status==="success").length,
     stepsFailed:stepLogs.filter(x=>x.status==="failed").length,
     decisionCalls,responseCalls,
     inputTokens:tokenTotals.input,outputTokens:tokenTotals.output,
     estimatedSelectionCostUsd:selectionEstimate,
     totalBilledCostUsd:null,
     baselineLegacyCostUsd:null,
     note:"Selection cost is estimated, not billed. Responses costs and legacy comparison are not yet calculated."
   };
   saveJson("nimo-sandbox-run-"+new Date().toISOString().replaceAll(":","-")+".json",{
     format:"nimo-sandbox-run-v2",exportedAt:new Date().toISOString(),contextTier,batchSize,
     branch:"experiment/decision-context-harness",
     sandboxType:"browser-isolated-emulator-not-D1-worker",
     captureSource,
     source:{traceId:record.traceId,capturedAt:record.capturedAt??null},
     summary,runProgress,errors:runErrors,
     initialWorld:contextOf(record).world,
     steps:stepLogs,apiUsage:apiHistory,
     replayOutcomes:sandbox.history,finalWorld:sandbox.world,
     finalCompactContext:frame.context,longRunDiagnostics:diagnostics
   });
 }
 return <main className="dh-shell">
  <div className="dh-heading"><div>
   <div className="dh-eyebrow">Nimo / experimental replay</div>
   <h1>Decision sandbox</h1>
   <p>Run a selection, generate missing action parameters if necessary, and replay supported outcomes in an isolated copy of a historical world snapshot.</p>
  </div><span className="dh-pill">Local state only</span></div>
  <div className="dh-notice"><a href="/decision-harness/context-experiment"><strong>Compare five context strategies on historical snapshots</strong></a> with 1–5 AI decisions per strategy and a downloadable comparison report.</div>\n  <div className="dh-notice"><strong>Not the live Cloudflare D1 executor.</strong> This is an in-browser replay of a limited set of actions using Nimo's shared map and pathfinding rules. It can test handoffs and repeated decisions, but food effects, storage transactions, Oracle calls and other live mechanics are not emulated. No production world writes occur. AI and generation calls require owner sign-in and incur API charges.</div>
  <section className="dh-panel dh-controls dh-sandbox-controls">
   <div className="dh-field"><label htmlFor="sandbox-upload">World snapshot</label><input id="sandbox-upload" type="file" accept=".json,application/json" onChange={e=>void upload(e)} disabled={busy}/>
    <small>#{record.traceId} — {record.traceId===SAMPLE.traceId?"built-in sample (AI batch disabled)":captureSource?.type==="live"?"most recent captured real decision input":"real archived input loaded"}</small>
    {captureSource?.capturedAt&&<small>Captured {new Date(captureSource.capturedAt).toLocaleString()} · {captureSource.type==="live"?"Loaded from live Worker's private decision archive":"Uploaded historical archive"}. Snapshot is frozen for this sandbox run.</small>}
   </div>
   <div className="dh-field">
    <label>Read actual production decision context</label>
    <button type="button" className="dh-run" disabled={busy||loadingLive||!owner} onClick={()=>void loadLatestLiveContext()}>
     {loadingLive?"Reading private decision archive…":"Load latest real decision context"}
    </button>
    <small>Reads the exact last captured live decision input from private R2. It may be minutes or hours old, and does not advance Nimo's world. Reset and reload to start from a newer capture.</small>
   </div>
   <div className="dh-field"><label htmlFor="sandbox-mode">Selection mode</label>
    <select id="sandbox-mode" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as "manual"|"ai")}><option value="manual">Manual decision</option><option value="ai">Decisions API (real AI)</option></select>
   </div>
   <div className="dh-field"><label htmlFor="sandbox-context">Decision context</label>
    <select id="sandbox-context" value={contextTier} disabled={busy||stepLogs.length>0} onChange={e=>setContextTier(e.target.value as ContextTier)}>
     <option value="E">E — Adaptive (recommended)</option><option value="B">B — Recent experience</option>
     <option value="A">A — Baseline</option><option value="C">C — Goal awareness</option><option value="D">D — Full retrieval</option>
    </select><small>Locked after first step. Reset to change strategy.</small></div>
   <div className="dh-field"><label htmlFor="sandbox-batch">Endurance test length</label>
    <select id="sandbox-batch" value={batchSize} disabled={busy} onChange={e=>setBatchSize(Number(e.target.value) as 10|20)}>
     <option value={10}>10 decisions</option><option value={20}>20 decisions</option>
    </select><small>Real Decisions + focused generation when needed</small></div>
   <div className="dh-field"><label htmlFor="sandbox-action">Action to replay</label>
    <select id="sandbox-action" value={selected} onChange={e=>setManual(e.target.value)} disabled={busy||mode==="ai"}>
     {supported.map(c=><option key={c.id} value={c.id}>{c.id}</option>)}
    </select><small>{frame.choices.length-supported.length} choices have no safe replay implementation</small>
   </div>
   <div className="dh-actions">
    <button type="button" className="dh-run" disabled={busy||sandbox.step>=30} onClick={()=>void step()}>Run one sandbox step</button>
    <button type="button" className="dh-run dh-ai" disabled={busy||!owner||sandbox.step>=30||record.traceId===SAMPLE.traceId} onClick={()=>void runTwenty()}>Run {batchSize} AI decisions</button>
    <button type="button" className="dh-quiet" onClick={exportFullRun} disabled={!stepLogs.length}>Download full run (JSON)</button>
    {busy?<button type="button" className="dh-quiet" onClick={halt}>Stop run</button>:
      <button type="button" className="dh-quiet" onClick={reset}>Reset</button>}
    {!owner&&<small>For AI and generation, <a href="/world/settings">sign in as owner</a>.</small>}
    <small>Load the most recent live decision input or upload an archive to enable the endurance batch. Both stay isolated; the built-in sample is for manual tests only.</small>
    <small>Sketch generation may retry once after invalid strokes. Rejected candidates are never exported; safe diagnostics and all reported usage are logged. Maximum 30 replay steps. Each model call costs money.</small>
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
  <section className="dh-panel dh-summary">
   <div><div className="dh-eyebrow">Long-run behaviour diagnostics</div><h2>Patterns and continuity</h2>
    <p>Based on simulated outcomes. Repetition is diagnostic, not automatically a failure.</p></div>
   <div className="dh-stats">
    <div><span>Movement reversals</span><strong>{diagnostics.movementReversals}</strong></div>
    <div><span>Consecutive reflections</span><strong>{diagnostics.repeatedReflections}</strong></div>
    <div><span>Goals completed</span><strong>{diagnostics.completedGoals}</strong></div>
    <div><span>Goals replaced</span><strong>{diagnostics.replacedGoals}</strong></div>
    <div><span>Unique actions</span><strong>{diagnostics.uniqueActions}</strong></div>
    <div><span>Steps without tracked change</span><strong>{diagnostics.unchangedStateSteps}</strong></div>
   </div>
  </section>
  <div className="dh-detail">
   <section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><div className="dh-eyebrow">Execution trace</div><h3>History</h3><p>Only simulated outcomes; not verified Cloudflare execution.</p></div></div>
    {sandbox.history.length===0?<p>No steps yet.</p>:<ol className="dh-sandbox-history">{sandbox.history.map((h,i)=><li key={i}>
     <strong>{h.action}</strong> — {h.status}<p>{h.summary}</p>
     {h.route&&<small>Route: {h.route.map(p=>`(${p.x},${p.y})`).join(" → ")}</small>}
    </li>)}</ol>}
   </section>
   <section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><div className="dh-eyebrow">Latest step</div><h3>Selection → generation → replay · {contextTier}</h3></div></div>
    <div className="dh-code-block"><div className="dh-code-head"><strong>Full trace</strong><button onClick={()=>navigator.clipboard.writeText(json(last))}>Copy</button></div><pre>{json(last??"No step selected")}</pre></div>
    <div className="dh-code-block"><div className="dh-code-head"><strong>Current compact context</strong><button onClick={()=>navigator.clipboard.writeText(json(frame.context))}>Copy</button></div><pre>{json(frame.context)}</pre></div>
   </section>
  </div>
  <div className="dh-footnote"><strong>Cost comparison:</strong> Selection costs above are estimates from reported Decisions API token usage; they exclude Responses API generation and infrastructure. The sandbox records Responses token usage but cannot yet calculate a verified total bill or savings against Legacy because it has no matched baseline. <a href="/decision-harness">Return to single-decision harness</a>. Browser-only replay; refreshing resets it.</div>
 </main>;
}
