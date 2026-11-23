"use client";
import {ChangeEvent,useEffect,useMemo,useRef,useState} from "react";
import {SAMPLE,contextOf,offerChoices,type ArchiveRecord,type Choice,type LooseRecord} from "../../../lib/decision-harness";
import {buildExperimentalContext,CONTEXT_TIERS,type ContextTier} from "../../../lib/decision-context-experiment";
import {createSandbox,stepSandbox,supportsSandboxChoice,type SandboxState} from "../../../lib/decision-sandbox";
import "../harness.css";

type Usage={input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number}};
type Trial={
 tier:ContextTier;step:number;selected:string|null;status:"success"|"failed"|"unsupported";
 message:string;inputCharacters:number;context:LooseRecord;choices:string[];
 selectionResponse:unknown;generationResponse:unknown;
 outcome:unknown;usage:{decisions:Usage|null;responses:Usage|null};
};
type TrialGroup={tier:ContextTier;trials:Trial[];finalState:LooseRecord;stopReason:string|null};
const stringify=(x:unknown)=>JSON.stringify(x,null,2);
const estimateSelection=(u:Usage|null)=>{
 if(!u?.input_tokens)return 0;
 const total=u.input_tokens,cached=Math.max(0,Math.min(total,u.input_tokens_details?.cached_tokens??0));
 const written=Math.max(0,Math.min(total-cached,u.input_tokens_details?.cache_write_tokens??0));
 return ((total-cached-written)*.10+cached*.01+written*.125)/1e6;
};
const exportJson=(data:unknown)=>{
 const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="nimo-context-experiment-"+new Date().toISOString().replaceAll(":","-")+".json";
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
const requestJson=async(path:string,body:unknown,signal:AbortSignal)=>{
 const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
 const data=await response.json();
 if(!response.ok)throw Error(typeof data.error==="string"?data.error:"API error");
 return data;
};
export default function ContextExperimentPage(){
 const [records,setRecords]=useState<ArchiveRecord[]>([SAMPLE]);
 const [traceId,setTraceId]=useState(SAMPLE.traceId);
 const [steps,setSteps]=useState(3);
 const [owner,setOwner]=useState(false);
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState("");
 const [error,setError]=useState("");
 const [groups,setGroups]=useState<TrialGroup[]>([]);
 const [selectedTier,setSelectedTier]=useState<ContextTier>("E");
 const [detail,setDetail]=useState(0);
 const [runMode,setRunMode]=useState<"ai"|"offline">("ai");
 const [goalCheck,setGoalCheck]=useState<{pass:boolean;results:{name:string;passed:boolean;detail:string}[]}|null>(null);
 const stopping=useRef(false),controller=useRef<AbortController|null>(null),active=useRef(false);
 useEffect(()=>{void fetch("/api/world/session",{cache:"no-store"}).then(r=>r.json()).then(d=>setOwner(Boolean(d.authenticated))).catch(()=>{});return ()=>{stopping.current=true;controller.current?.abort();};},[]);
 const record=records.find(r=>r.traceId===traceId)??records[0];
 const world=useMemo(()=>contextOf(record).world,[record]);
 const initial=useMemo(()=>createSandbox(world),[world]);
 const sampleContext=useMemo(()=>buildExperimentalContext(world,[],selectedTier),[world,selectedTier]);
 const currentGroup=groups.find(g=>g.tier===selectedTier);
 const currentTrial=currentGroup?.trials[detail]??currentGroup?.trials[0];
 const totals=groups.map(g=>{
  const success=g.trials.filter(x=>x.status==="success").length;
  const choices=g.trials.map(x=>x.selected).filter((x):x is string=>!!x);
  const travel=g.trials.filter(x=>x.selected?.startsWith("travel:")).length;
  const reversals=g.trials.filter((x,i)=>i>0&&x.selected?.startsWith("travel:")&&g.trials[i-1].selected?.startsWith("travel:")&&
    x.outcome&&g.trials[i-1].outcome&&JSON.stringify((x.outcome as {after?:{position?:unknown}}).after?.position)===JSON.stringify((g.trials[i-1].outcome as {before?:{position?:unknown}}).before?.position)).length;
  const input=g.trials.reduce((n,x)=>n+(x.usage.decisions?.input_tokens??0)+(x.usage.responses?.input_tokens??0),0);
  const output=g.trials.reduce((n,x)=>n+(x.usage.responses?.output_tokens??0),0);
  const selectionCost=g.trials.reduce((n,x)=>n+estimateSelection(x.usage.decisions),0);
  return {tier:g.tier,attempted:g.trials.length,success,travel,reversals,unique:new Set(choices).size,input,output,selectionCost};
 });
 async function upload(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];if(!f)return;
  try{
   if(f.size>20_000_000)throw Error("Archive must be smaller than 20 MB");
   const raw=JSON.parse(await f.text());
   const archive=(Array.isArray(raw?.records)?raw.records:Array.isArray(raw)?raw:[raw]) as ArchiveRecord[];
   const valid=archive.filter(r=>Number.isSafeInteger(r.traceId)&&Array.isArray(r.request?.input)&&!contextOf(r).visitor);
   if(!valid.length)throw Error("No supported archived decision snapshot found. Use the last-60m decision input export.");
   setRecords(valid);setTraceId(valid[0].traceId);setGroups([]);setError("");setDetail(0);
  }catch(x){setError(x instanceof Error?x.message:"Invalid export");}
  e.target.value="";
 }
 async function run(){
  if(active.current||!owner&&runMode==="ai")return;
  active.current=true;stopping.current=false;setBusy(true);setGroups([]);setProgress("");setError("");
  try{
   for(const variant of CONTEXT_TIERS){
    if(stopping.current)break;
    const tier=variant.id;
    let state:SandboxState=createSandbox(world);
    const trials:Trial[]=[];
    let stopReason:string|null=null;
    for(let i=0;i<steps&&!stopping.current;i++){
     const choices=offerChoices(state.world,null);
     const context=buildExperimentalContext(state.world,state.history,tier);
     const trial:Trial={tier,step:i+1,selected:null,status:"failed",message:"",
      inputCharacters:JSON.stringify(context).length,context,
      choices:choices.map(c=>c.id),selectionResponse:null,generationResponse:null,
      outcome:null,usage:{decisions:null,responses:null}};
     setProgress(variant.name+" — decision "+(i+1)+"/"+steps);
     const ac=new AbortController();controller.current=ac;
     try{
      let choice:Choice|undefined;
      if(runMode==="ai"){
       const data=await requestJson("/api/decision-harness/run",{traceId:record.traceId,context,
        choices:choices.map(c=>({id:c.id,description:c.description}))},ac.signal);
       trial.selectionResponse=data;trial.usage.decisions=data.usage??null;
       choice=data.selectionValid?choices.find(c=>c.id===data.selectedChoice):undefined;
       if(!choice)throw Error("Decisions API returned no eligible action");
      }else{
       // Offline mode verifies context/replay mechanics, not AI behaviour.
       choice=choices.find(c=>c.id==="idle");
      }
      trial.selected=choice?.id??null;
      if(!choice||!supportsSandboxChoice(choice)){
       trial.status="unsupported";throw Error("Action "+(choice?.id??"unknown")+" has no isolated replay implementation");
      }
      let generated:LooseRecord|null=null;
      if(choice.task){
       if(runMode==="offline"){
        trial.status="unsupported";throw Error("Offline mode cannot generate creative action parameters");
       }
       const w=state.world;
       const taskContext={self:context.self,present:context.present,continuity:context.continuity,
        recentExperience:context.recentExperience,goalAwareness:context.goalAwareness,
        activityAwareness:context.activityAwareness,retrievedKnowledge:context.retrievedKnowledge,
        relevantWorkspace:choice.task==="write_document"?(w.workspace??[]).slice(0,12):undefined,
        sketch:choice.task.includes("sketch")?w.sketchbook:undefined};
       const data=await requestJson("/api/decision-harness/generate",{task:choice.task,choiceId:choice.id,context:taskContext},ac.signal);
       trial.generationResponse=data;trial.usage.responses=data.usage??null;
       generated=data.generated;
      }
      const next=stepSandbox(state,choice.id,generated);
      state=next;
      trial.outcome=next.history.at(-1);
      trial.status=next.history.at(-1)?.status==="simulated_success"?"success":"failed";
      trial.message=next.history.at(-1)?.summary??"No replay outcome";
      if(trial.status!=="success")throw Error(trial.message);
     }catch(x){
      trial.message=x instanceof Error?x.message:String(x);
      stopReason=trial.message;
     }finally{
      controller.current=null;
      if(!stopping.current){trials.push(trial);setGroups(g=>[...g.filter(x=>x.tier!==tier),{tier,trials:[...trials],finalState:state.world,stopReason}].sort((a,b)=>a.tier.localeCompare(b.tier)));}
     }
     if(stopReason)break;
    }
   }
   setProgress(stopping.current?"Stopped by user":"Comparison finished");
  }catch(x){setError(x instanceof Error?x.message:"Experiment failed");}
  finally{controller.current=null;active.current=false;setBusy(false);}
 }
 function runGoalCheck(){
  // Deterministic read-only test: no API calls, no D1 writes.
  const checks:{name:string;passed:boolean;detail:string}[]=[];
  const test=(name:string,disposition:string,goal:string|null,expected:string|null)=>{
   try{
    const fixture=createSandbox(world);
    const next=stepSandbox(fixture,"reflect",{monologue:"Reconsidering the current intention.",activity:"reflecting",goal,intentDisposition:disposition});
    const actual=next.world.state.currentGoal??null;
    const recorded=next.world.state.lastIntentOutcome;
    checks.push({name,passed:next.history.at(-1)?.status==="simulated_success"&&actual===expected&&recorded?.disposition===disposition,
     detail:"New goal: "+JSON.stringify(actual)+", disposition: "+String(recorded?.disposition)});
   }catch(e){checks.push({name,passed:false,detail:e instanceof Error?e.message:String(e)});}
  };
  const original=world.state.currentGoal??null;
  test("Keep intention","keep",original,original);
  test("Complete intention","complete",null,null);
  test("Abandon intention","abandon",null,null);
  test("Replace intention","replace","Explore the open garden nook.","Explore the open garden nook.");
  try{
   const fixture=createSandbox(world);
   const updated=stepSandbox(fixture,"reflect",{monologue:"The walk is complete.",activity:"resting",goal:null,intentDisposition:"complete"});
   const context=buildExperimentalContext(updated.world,updated.history,"E");
   const passed=context.self?.currentIntention===null&&context.goalAwareness?.disposition?.disposition==="complete";
   checks.push({name:"Next decision receives completion",passed,detail:"Adaptive context reads recorded completion and no active intention."});
  }catch(e){checks.push({name:"Next decision receives completion",passed:false,detail:String(e)});}
  setGoalCheck({pass:checks.every(x=>x.passed),results:checks});
 }
 function stop(){stopping.current=true;controller.current?.abort();setProgress("Stopping…");}
 return <main className="dh-shell">
  <div className="dh-heading"><div><div className="dh-eyebrow">Nimo / decision harness</div>
   <h1>Context experiment</h1>
   <p>Compare five context strategies, including a lean adaptive candidate, using the same historical snapshot. Each strategy replays its own isolated sequence.</p>
  </div><span className="dh-pill">Test branch only</span></div>
  <div className="dh-notice"><strong>Controlled comparison, not production execution.</strong> Runs are isolated browser replays with real Decisions API calls when AI is selected. Every variant begins from the same archived snapshot. Unsupported tools stop that variant; this does not exercise the Cloudflare D1 executor. Choosing different paths means the later states are not identical across variants. API charges apply.</div>
  <section className="dh-panel dh-controls dh-sandbox-controls">
   <div className="dh-field"><label htmlFor="cx-file">Historical snapshots</label>
    <input id="cx-file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>void upload(e)}/>
    <select aria-label="Choose historical snapshot" disabled={busy} value={traceId} onChange={e=>{setTraceId(Number(e.target.value));setGroups([]);}}>
     {records.map(r=><option key={r.traceId} value={r.traceId}>#{r.traceId} · {r.capturedAt??"archive"}</option>)}
    </select><small>{records.length} snapshot(s) loaded; records stay in your browser</small>
   </div>
   <div className="dh-field"><label htmlFor="cx-mode">Mode</label>
    <select id="cx-mode" disabled={busy} value={runMode} onChange={e=>setRunMode(e.target.value as "ai"|"offline")}>
     <option value="ai">Real Decisions API</option><option value="offline">Offline plumbing check (idle only)</option>
    </select>
    <label htmlFor="cx-steps">Decisions per strategy</label>
    <select id="cx-steps" disabled={busy} value={steps} onChange={e=>setSteps(Number(e.target.value))}>
     <option value={1}>1 (5 total)</option><option value={3}>3 (15 total)</option><option value={5}>5 (25 total)</option>
    </select>
   </div>
   <div className="dh-actions">
    <button className="dh-run dh-ai" type="button" disabled={busy||runMode==="ai"&&!owner} onClick={()=>void run()}>Compare five strategies</button>
    <button type="button" className="dh-quiet" disabled={busy} onClick={runGoalCheck}>Check goal transitions (offline)</button>
    {busy?<button type="button" className="dh-quiet" onClick={stop}>Stop</button>:null}
    <button type="button" className="dh-quiet" disabled={!groups.length} onClick={()=>exportJson({
     format:"nimo-context-experiment-v2",exportedAt:new Date().toISOString(),goalTransitionChecks:goalCheck,
     source:{traceId:record.traceId,capturedAt:record.capturedAt??null},mode:runMode,
     stepsPerStrategy:steps,summary:totals,
     warning:"Costs are estimated for Decisions selections only; Responses token usage is included but pricing is not computed. No production world writes.",
     variants:groups})}>Download comparison (JSON)</button>
    {!owner&&<small>Sign in at <a href="/world/settings">World settings</a> to make AI calls.</small>}
    <small>Run deterministic goal checks first, then 3–5 AI decisions per tier (up to 25 paid selections). Every tier starts from the same snapshot.</small>
   </div>
  </section>
  {progress&&<section className="dh-panel dh-batch-progress" role="status">{progress}</section>}
  {error&&<div className="dh-error" role="alert">{error}</div>}
  {goalCheck&&<section className="dh-panel dh-stage-view" role="status"><h3>Offline goal transition checks: {goalCheck.pass?"All passed":"Failures detected"}</h3>
    <ol>{goalCheck.results.map(c=><li key={c.name}><strong>{c.passed?"PASS":"FAIL"} · {c.name}</strong> — {c.detail}</li>)}</ol>
  </section>}
  <section className="dh-panel dh-stage-view">
   <div className="dh-stage-head"><div><h3>Five context strategies</h3><p>Each tier adds only the context described here.</p></div></div>
   <div className="dh-variant-grid">{CONTEXT_TIERS.map(t=><button key={t.id} type="button" onClick={()=>{setSelectedTier(t.id);setDetail(0);}} className={"dh-variant-card "+(selectedTier===t.id?"active":"")}>
    <strong>{t.id} · {t.name}</strong><small>{t.description}</small>
   </button>)}</div>
   <div className="dh-code-block"><div className="dh-code-head"><strong>Starting context: {selectedTier}</strong><button type="button" onClick={()=>navigator.clipboard.writeText(stringify(sampleContext))}>Copy</button></div><pre>{stringify(sampleContext)}</pre></div>
  </section>
  {groups.length>0&&<section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><h3>Comparison results</h3><p>Loop counts are diagnostics, not instructions to maximise activity. Estimated charges cover selection only; input/output tokens include generation.</p></div></div>
   <div className="dh-comparison-scroll"><table className="dh-comparison-table"><thead><tr><th>Strategy</th><th>Completed</th><th>Unique actions</th><th>Movement reversals</th><th>Input tokens</th><th>Output tokens</th><th>Estimated selection cost</th></tr></thead><tbody>
    {totals.map(t=><tr key={t.tier}><td>{t.tier}</td><td>{t.success}/{t.attempted}</td><td>{t.unique}</td><td>{t.reversals}</td><td>{t.input.toLocaleString()}</td><td>{t.output.toLocaleString()}</td><td>{"$"+t.selectionCost.toFixed(6)}</td></tr>)}
   </tbody></table></div>
   <p>These are diagnostic results from separate stochastic runs, not proof that one tier is superior. Repeat with more archived snapshots before choosing a default.</p>
  </section>}
  {currentGroup&&<section className="dh-panel dh-stage-view"><div className="dh-stage-head"><div><h3>{selectedTier}: decision trace</h3><p>{currentGroup.stopReason?"Stopped: "+currentGroup.stopReason:"Sequence complete or still running"}</p></div></div>
   <div className="dh-trial-row">{currentGroup.trials.map((t,i)=><button type="button" key={i} className={"dh-quiet "+(detail===i?"dh-trial-selected":"")} onClick={()=>setDetail(i)}>{i+1}. {t.selected??"error"} · {t.status}</button>)}</div>
   {currentTrial&&<div className="dh-code-block"><div className="dh-code-head"><strong>Full selected decision and context</strong><button type="button" onClick={()=>navigator.clipboard.writeText(stringify(currentTrial))}>Copy</button></div><pre>{stringify(currentTrial)}</pre></div>}
  </section>}
  <div className="dh-footnote"><a href="/decision-harness/sandbox">Back to Decision Sandbox</a>. A historical upload is read locally; no direct D1 access or database mutations are needed. For a genuinely controlled single-step test, select 1 decision per strategy; 3–5 decision tests probe how context and actions affect later behaviour.</div>
 </main>;
}
