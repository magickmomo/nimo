"use client";
import {useRef,useState} from "react";
import {actionKey009,finishProject009,projectOpportunity009,startProject009,
 type ProjectProposal009} from "../../../../lib/cognition-009";
import {DECISIONS011,FORK_AT011,advance011,actionMetrics011,fork011,
 initialExperiment011,memoryContext011,memoryDecision011,
 type Branch011,type Experiment011} from "../../../../lib/cognition-011";
import "../lab.css";
import "../009/cognition.css";
type Phase="shared"|"memory-on"|"memory-off";
type ModelEntry={phase:Phase;step:number;task:"propose"|"create";model:string;input:number;output:number;result:unknown};
const createInitial=()=>initialExperiment011();
export default function Lab011(){
 const [seed,setSeed]=useState(9009),[mode,setMode]=useState<"hybrid"|"local">("hybrid"),
  [token,setToken]=useState(""),[busy,setBusy]=useState(false),[status,setStatus]=useState("Ready to compare matched branches."),
  [error,setError]=useState("");
 const [experiment,setExperiment]=useState<Experiment011>(createInitial);
 const live=useRef<Experiment011>(createInitial()),controller=useRef<AbortController|null>(null),
  modelEvents=useRef<ModelEntry[]>([]),rejectedAt=useRef<Record<Phase,number>>({"shared":-100,"memory-on":-100,"memory-off":-100});
 function save(e:Experiment011){live.current=e;setExperiment(e);}
 function reset(){if(busy)return;const next=initialExperiment011(seed);save(next);setError("");setStatus("Reset to seed "+seed);
  modelEvents.current=[];rejectedAt.current={"shared":-100,"memory-on":-100,"memory-off":-100};}
 async function modelRequest(task:"propose"|"create",phase:Phase,branch:Branch011,enabled:boolean,signal:AbortSignal){
  const context=memoryContext011(branch.state,branch.lessons,enabled);
  const r=await fetch("/api/world/lab/009/project",{method:"POST",signal,
   headers:{"Content-Type":"application/json","x-lab-owner-token":token},
   body:JSON.stringify({phase:task,context,...(task==="create"?{project:branch.state.project}:{})})});
  const data=await r.json() as {result?:Record<string,unknown>;error?:string;model?:string;usage?:{input:number;output:number}};
  if(!r.ok||!data.result)throw Error((r.status===422?"RECOVERABLE_PROPOSAL: ":"")+
   (data.error??"Lab project model failed"));
  const input=data.usage?.input??0,output=data.usage?.output??0;
  modelEvents.current.push({phase,step:branch.state.step,task,model:data.model??"unknown",input,output,result:data.result});
  return {result:data.result,input,output};
 }
 async function tick(phase:Phase,branch:Branch011,signal:AbortSignal):Promise<Branch011>{
  const memoryEnabled=phase==="memory-on";
  let b=branch;
  if(mode==="hybrid"&&projectOpportunity009(b.state)&&
     b.state.step-rejectedAt.current[phase]>=5){
   try{
    const p=await modelRequest("propose",phase,b,memoryEnabled,signal);
    b={...b,state:startProject009(b.state,p.result as ProjectProposal009),
     modelCalls:b.modelCalls+1,modelInput:b.modelInput+p.input,modelOutput:b.modelOutput+p.output};
   }catch(e){
    if(!(e instanceof Error&&e.message.startsWith("RECOVERABLE_PROPOSAL:")))throw e;
    rejectedAt.current[phase]=b.state.step;
   }
  }
  const selection=memoryDecision011(b.state,b.lessons,memoryEnabled);
  let creation:{title:string;content:string;input:number;output:number}|null=null;
  if(mode==="hybrid"&&selection.action.type==="create"&&b.state.project?.phase==="creating"){
   const p=await modelRequest("create",phase,b,memoryEnabled,signal);
   if(typeof p.result.title!=="string"||typeof p.result.content!=="string")throw Error("Incomplete creation");
   creation={title:p.result.title,content:p.result.content,input:p.input,output:p.output};
  }
  b=advance011(b,memoryEnabled,phase,selection);
  if(creation){
   b={...b,state:finishProject009(b.state,creation.title,creation.content),
    modelCalls:b.modelCalls+1,modelInput:b.modelInput+creation.input,
    modelOutput:b.modelOutput+creation.output};
  }
  return b;
 }
 async function run(){
  if(busy||(mode==="hybrid"&&!token.trim())){if(mode==="hybrid"&&!token.trim())setError("Owner token required for hybrid mode");return;}
  const c=new AbortController();controller.current=c;setBusy(true);setError("");
  modelEvents.current=[];rejectedAt.current={"shared":-100,"memory-on":-100,"memory-off":-100};
  let e=initialExperiment011(seed);save(e);
  try{
   while(e.shared.state.step<FORK_AT011&&!c.signal.aborted){
    if(document.visibilityState==="hidden"){setStatus("Stopped: page hidden; partial run preserved.");break;}
    const shared=await tick("shared",e.shared,c.signal);
    e={...e,shared};save(e);
    if(shared.state.step%20===0)setStatus("Shared checkpoint: "+shared.state.step+" / "+FORK_AT011);
   }
   if(e.shared.state.step===FORK_AT011&&!c.signal.aborted){
    const fork=fork011(e.shared);e={...e,on:fork.on,off:fork.off};save(e);
    setStatus("Forked identical state at step 60. Comparing both continuations.");
    while(e.on&&e.off&&e.on.state.step<DECISIONS011&&!c.signal.aborted){
     if(document.visibilityState==="hidden"){setStatus("Stopped: page hidden; partial run preserved.");break;}
     const on=await tick("memory-on",e.on,c.signal);
     e={...e,on};save(e);
     if(c.signal.aborted)break;
     const off=await tick("memory-off",e.off,c.signal);
     e={...e,off};save(e);
     if(on.state.step%20===0)setStatus("Both branches: "+on.state.step+" / 120 decisions");
    }
   }
   if(e.on?.state.step===DECISIONS011&&e.off?.state.step===DECISIONS011)
    setStatus("Complete: two 120-decision trajectories from the same step-60 snapshot.");
  }catch(err){if(!c.signal.aborted){setError(err instanceof Error?err.message:String(err));setStatus("Stopped; partial results preserved.");}}
  finally{controller.current=null;setBusy(false);}
 }
 function exportResults(){
  const e=live.current;
  const branches=[["shared",e.shared],["memory-on",e.on],["memory-off",e.off]] as const;
  const summary=branches.map(([name,b])=>({name,metrics:b? actionMetrics011(b):null}));
  const output={experiment:"Nimo 011",seed,modelMode:mode,totalDecisionsPerBranch:120,
   commonDecisions:60,consolidationInterval:20,comparisonNote:"The first 60 decisions are shared. Each continuation runs 60 additional decisions. Model generation may vary across calls; this is not a perfectly deterministic LLM comparison.",
   summary,modelCalls:modelEvents.current,branches:branches.map(([name,b])=>({name,
    state:b?.state,checkpoints:b?.checkpoints,lessons:b?.lessons,
    decisions:b?.decisions.map(d=>({...d,matchingLessons:d.retrieved.length,
     choiceChanged:d.differentFromBaseline})),
    episodes:b?.state.episodes,creations:b?.state.creations}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="nimo-011-memory-fork-"+seed+".json";a.click();URL.revokeObjectURL(url);
 }
 const summaries=[{name:"Shared initial run",branch:experiment.shared},{name:"Memory ON",branch:experiment.on},
  {name:"Memory OFF",branch:experiment.off}];
 return <main className="cog009">
  <nav><a href="/world/lab/009">Lab 009</a> · <a href="/world">World</a></nav>
  <h1>Nimo 011 · Consolidated Memory Fork</h1>
  <p>Compare two Nimos continuing from an identical step-60 snapshot. Both retain episodic observations,
   discovered effects, interests and consolidated lessons; only the memory-on branch retrieves lessons for planning and model calls.
   This lab does not write to the production Worker or D1.</p>
  <div className="cog009-controls">
   <label>Seed <input type="number" value={seed} disabled={busy} onChange={e=>setSeed(Number(e.target.value)||9009)}/></label>
   <label>Run mode <select disabled={busy} value={mode} onChange={e=>setMode(e.target.value as "hybrid"|"local")}>
    <option value="hybrid">Hybrid: local actions + Luna projects (billable)</option>
    <option value="local">Local only (free, no model creative outputs)</option>
   </select></label>
   {mode==="hybrid"&&<label>Lab owner token <input type="password" disabled={busy} value={token} onChange={e=>setToken(e.target.value)}/></label>}
  </div>
  <div className="cog009-actions">
   <button disabled={busy} onClick={()=>void run()}>Run matched 120-decision fork</button>
   <button disabled={!busy} onClick={()=>controller.current?.abort()}>Stop</button>
   <button disabled={busy} onClick={reset}>Reset</button>
   <button onClick={exportResults}>Export JSON comparison</button>
  </div>
  <p role="status">{status}</p>{error&&<p role="alert" className="cog009-error">{error}</p>}
  <p className="cog009-note">Shared decisions 1–60 · consolidate at 20, 40 and 60 ·
   fork and continue both branches through step 120 · consolidate at 80, 100 and 120.
   Total actions executed: 180, representing two trajectories of 120 each.</p>
  <div className="cog009-layout">
   {summaries.map(({name,branch})=><section className="cog009-card" key={name}>
    <h2>{name}</h2>
    {branch?<>
     <p>Decision {branch.state.step}/120</p>
     <p>Mood {branch.state.mood.toFixed(1)}% · Energy {branch.state.energy.toFixed(1)}%</p>
     <p>Lessons {branch.lessons.length} · Checkpoints {branch.checkpoints.length}</p>
     <p>Projects {branch.state.completedProjects.length} · Interests {branch.state.interests.length}</p>
     <p>Model calls {branch.modelCalls}</p>
     <p>Retrieved decisions {actionMetrics011(branch).retrievalDecisions}</p>
     <p>Scored by memory {actionMetrics011(branch).influencedDecisions}</p>
     <p><strong>Different local choice after memory:</strong> {actionMetrics011(branch).changedDecisions}</p>
     <details><summary>Consolidated lessons</summary>{branch.lessons.length===0?<p>None yet.</p>:
      branch.lessons.map(l=><p key={l.id}><strong>{l.id}</strong>: {l.text} Evidence: steps {l.evidence.join(", ")}</p>)}</details>
     <details><summary>Recent decisions</summary>
      {branch.decisions.slice(-12).map(d=><p key={d.step}>#{d.step} {actionKey009(d.action)}
       {d.differentFromBaseline?" (changed from "+actionKey009(d.baselineAction)+")":""}
       {" "}· recalled {d.retrieved.length} · action effects {d.influences.length}</p>)}</details>
    </>:<p>Begins after step 60.</p>}
   </section>)}
  </div>
  {experiment.on&&experiment.off&&<section className="cog009-card">
   <h2>Matched-state comparison</h2>
   <table><thead><tr><th>Metric</th><th>Memory ON</th><th>Memory OFF</th></tr></thead>
    <tbody>{([
     ["Final step",experiment.on.state.step,experiment.off.state.step],
     ["Final mood",experiment.on.state.mood,experiment.off.state.mood],
     ["Wait decisions after fork",experiment.on.decisions.filter(d=>d.step>60&&d.action.type==="wait").length,
      experiment.off.decisions.filter(d=>d.step>60&&d.action.type==="wait").length],
     ["Completed projects",experiment.on.state.completedProjects.length,experiment.off.state.completedProjects.length],
     ["New lessons",experiment.on.lessons.length,experiment.off.lessons.length],
     ["Retrievals after fork",experiment.on.decisions.filter(d=>d.step>60&&d.retrieved.length>0).length,
      experiment.off.decisions.filter(d=>d.step>60&&d.retrieved.length>0).length],
     ["Actual choice changes after fork",experiment.on.decisions.filter(d=>d.step>60&&d.differentFromBaseline).length,
      experiment.off.decisions.filter(d=>d.step>60&&d.differentFromBaseline).length],
     ] as [string,number,number][]).map(([label,on,off])=><tr key={label}>
      <td>{label}</td><td>{on}</td><td>{off}</td></tr>)}</tbody>
   </table></section>}
  <p className="cog009-note">A retrieved memory is not proof of influence. The export records each scored adjustment
   and whether the memory-weighted planner chose a different action from its memory-free baseline.
   The two branches may also diverge because creative model outputs are stochastic; repeat across seeds
   before attributing aggregate differences to memory.</p>
 </main>;
}
