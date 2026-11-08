"use client";
import {useRef,useState} from "react";
import {initial009,apply009,context009,localDecision009,opportunities009,actionKey009,moodContributors009,projectOpportunity009,startProject009,finishProject009,
 type State009,type Action009,type ProjectProposal009} from "../../../../lib/cognition-009";
import "../lab.css";
import "./cognition.css";
type Mode="local"|"llm"|"hybrid";
type Trace={step:number;context:ReturnType<typeof context009>;messages?:{role:string;content:string}[];reason:string};
type ModelTrace={step:number;phase:"propose"|"create";input:number;output:number;model:string;result:unknown};
const fmt=(a:Action009)=>a.type+(a.target?" "+a.target:"");
export default function Lab009(){
 const [seed,setSeed]=useState(9009),[mode,setMode]=useState<Mode>("local"),[memory,setMemory]=useState(true);
 const [state,setState]=useState<State009>(()=>initial009()),current=useRef<State009>(initial009());
 const [token,setToken]=useState(""),[busy,setBusy]=useState(false),lock=useRef(false),abort=useRef<AbortController|null>(null);
 const [error,setError]=useState(""),[status,setStatus]=useState("Ready — isolated simulation, no production writes.");
 const traces=useRef<Trace[]>([]),modelTraces=useRef<ModelTrace[]>([]);
 const [modelTotals,setModelTotals]=useState({calls:0,input:0,output:0});
 const view=context009(state,memory);
 const save=(next:State009)=>{current.current=next;setState(next)};
 function reset(){if(lock.current)return;save(initial009(seed));traces.current=[];modelTraces.current=[];
  setModelTotals({calls:0,input:0,output:0});setError("");setStatus("Reset to seed "+seed);}
 function act(action:Action009,reason:string,context?:ReturnType<typeof context009>,messages?:Trace["messages"],
  creation?:{title:string;content:string}){
  let next=apply009(current.current,action,reason,memory);
  if(creation)next=finishProject009(next,creation.title,creation.content);
  if(context)traces.current.push({step:next.step,context,messages,reason});
  save(next);setStatus("Step "+next.step+": "+next.episodes[next.episodes.length-1].result+
   (creation?" — completed "+creation.title:""));
 }
 async function projectRequest(phase:"propose"|"create",context:ReturnType<typeof context009>,signal:AbortSignal){
  const response=await fetch("/api/world/lab/009/project",{method:"POST",signal,headers:{
   "Content-Type":"application/json","x-lab-owner-token":token},
   body:JSON.stringify({phase,context,...(phase==="create"?{project:current.current.project}:{})})});
  const data=await response.json() as {result?:Record<string,unknown>;model?:string;
   usage?:{input:number;output:number};error?:string};
  if(!response.ok||!data.result)throw Error(data.error||"Project model request failed");
  const usage={input:data.usage?.input??0,output:data.usage?.output??0};
  modelTraces.current.push({step:current.current.step,phase,...usage,model:data.model??"unknown",result:data.result});
  setModelTotals(p=>({calls:p.calls+1,input:p.input+usage.input,output:p.output+usage.output}));
  return data.result;
 }
 async function step(signal:AbortSignal){
  if(mode==="hybrid"){
   if(projectOpportunity009(current.current)){
    const proposal=await projectRequest("propose",context009(current.current,memory),signal);
    const next=startProject009(current.current,proposal as ProjectProposal009);
    save(next);setStatus("Nimo proposed a project: "+next.project?.title);
   }
   const s=current.current,ctx=context009(s,memory),choice=localDecision009(s,memory);
   if(choice.action.type==="create"&&s.project){
    const result=await projectRequest("create",ctx,signal);
    if(typeof result.title!=="string"||typeof result.content!=="string")throw Error("Incomplete creation");
    act(choice.action,choice.reason,ctx,undefined,{title:result.title,content:result.content});
   }else act(choice.action,choice.reason,ctx);
   return;
  }
  const s=current.current,ctx=context009(s,memory);
  if(mode==="local"){const choice=localDecision009(s,memory);act(choice.action,choice.reason,ctx);return;}
  const response=await fetch("/api/world/lab/009/decide",{method:"POST",signal,
   headers:{"Content-Type":"application/json","x-lab-owner-token":token},
   body:JSON.stringify({context:ctx})});
  const data=await response.json() as {action?:Action009;reason?:string;error?:string;modelMessages?:Trace["messages"]};
  if(!response.ok||!data.action||typeof data.reason!=="string")throw Error(data.error||"Model decision unavailable");
  if(!opportunities009(s).some(a=>actionKey009(a)===actionKey009(data.action!)))throw Error("Invalid or unavailable model action");
  act(data.action,data.reason,ctx,data.modelMessages);
 }
 async function run(count:number){
  if(lock.current||(mode!=="local"&&!token.trim()))return;
  lock.current=true;setBusy(true);setError("");
  const controller=new AbortController();abort.current=controller;
  try{for(let i=0;i<count&&!controller.signal.aborted;i++){
   if(document.visibilityState==="hidden"){setStatus("Stopped: page hidden.");break;}
   await step(controller.signal);
   if(i<count-1)await new Promise<void>(resolve=>window.setTimeout(resolve,mode==="local"?70:300));
  }}catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:"Error");setStatus("Stopped — partial results preserved.");}}
  finally{lock.current=false;setBusy(false);abort.current=null;}
 }
 function exportLog(){
  const lines=["# Nimo 009 — Cognitive Architecture Experiment","","Seed: "+seed,"Mode: "+mode,"Memory: "+memory,
   "Steps: "+state.step,"Final mood: "+state.mood,"Final energy: "+state.energy,"",
   "## Final State","", "```json",JSON.stringify(context009(state,memory),null,2),"```","",
   "## Events",""];
  for(const e of state.episodes){const trace=traces.current.find(t=>t.step===e.step);
   lines.push("### "+e.step+" — "+fmt(e.action),"","Reason: "+e.reason,"Outcome: "+e.result,
    "Before: "+JSON.stringify(e.before),"After: "+JSON.stringify(e.after),
    "Memories retrieved: "+e.retrieved.join(", "),"",
    ...(trace?["Decision context:","```json",JSON.stringify(trace.context,null,2),"```",
      ...(trace.messages?["Model messages:","```json",JSON.stringify(trace.messages,null,2),"```"]:[]),""]:[]));
  }
  lines.push("## Model calls","",JSON.stringify(modelTraces.current,null,2),"",
   "## Creative project outputs","",JSON.stringify(state.creations,null,2),"");
  lines.push("## Discovered knowledge","```json",JSON.stringify(state.discoveries,null,2),"```");
  lines.push("## Stored experimental memories","```json",JSON.stringify(state.memories,null,2),"```");
  const url=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/markdown"}));
  const a=document.createElement("a");a.href=url;a.download="nimo-009-experiment-"+seed+".md";a.click();URL.revokeObjectURL(url);
 }
 const meters=[{label:"Mood",value:state.mood},{label:"Energy",value:state.energy},
  ...Object.entries(state.needs).map(([label,value])=>({label,value}))];
 return <main className="cog009">
  <nav><a href="/world/lab/008">Lab 008</a> · <a href="/world">World</a></nav>
  <h1>Nimo 009 · Cognitive Architecture Lab</h1>
  <p>Experiment with needs, mood, energy, memory retrieval and choice. Runs in this browser only: no production Worker or D1 writes.</p>
  <div className="cog009-controls">
   <label>Seed <input type="number" value={seed} disabled={busy} onChange={e=>setSeed(Number(e.target.value)||9009)}/></label>
   <label>Decision mode <select value={mode} disabled={busy} onChange={e=>setMode(e.target.value as Mode)}><option value="local">Local deterministic baseline (free)</option><option value="llm">LLM every decision (billable)</option><option value="hybrid">Hybrid: local actions + LLM projects (billable)</option></select></label>
   <label><input type="checkbox" checked={memory} disabled={busy} onChange={e=>setMemory(e.target.checked)}/> Memory enabled</label>
   {mode!=="local"&&<label>Lab owner token <input type="password" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>}
  </div>
  <div className="cog009-actions">
   <button disabled={busy} onClick={()=>void run(1)}>Step once</button>
   <button disabled={busy} onClick={()=>void run(30)}>Run 30 decisions</button>
   <button disabled={!busy} onClick={()=>abort.current?.abort()}>Stop</button>
   <button disabled={busy} onClick={reset}>Reset</button>
   <button onClick={exportLog}>Export experiment log</button>
  </div>
  <p role="status">{status}</p>{error&&<p role="alert" className="cog009-error">{error}</p>}
  <p className="cog009-note">Model calls: {modelTotals.calls} · Input tokens: {modelTotals.input} · Output tokens: {modelTotals.output}. Hybrid uses the model only to propose grounded projects and write their actual content.</p>
  <div className="cog009-layout">
   <section className="cog009-card"><h2>Internal state</h2>
    {meters.map(m=><div className="cog009-meter" key={m.label}>
      <div><strong>{m.label}</strong><span>{m.value.toFixed(1)}%</span></div>
      <progress value={m.value} max={100}/></div>)}
    <p className="cog009-note">Higher needs mean more unmet pressure. Higher mood and energy are favourable.</p>
    <h3>What affects mood?</h3>{moodContributors009(state).map(c=><p key={c.need}>{c.need}: −{c.impact.toFixed(1)} mood points</p>)}
   </section>
   <section className="cog009-card"><h2>Perception and opportunities</h2>
    <p>Inventory: {state.inventory.join(", ")||"empty"} / {state.inventory.length}/3</p>
    <h3>Discovered knowledge</h3>
    {state.discoveries.effects.length===0&&state.discoveries.facts.length===0?
      <p className="cog009-note">Nothing discovered yet. Verified interactions will populate this section.</p>:null}
    {state.discoveries.facts.map(f=><p key={f.subject+":"+f.property}>
      <strong>{f.subject}</strong> · {f.property}: {f.value} <small>(observed in step {f.evidence.join(", ")})</small>
    </p>)}
    {state.discoveries.effects.map(e=><p key={e.subject+":"+e.interaction+":"+e.attribute}>
      <strong>{e.subject}</strong> · {e.interaction} → {e.attribute}: {e.meanChange===null?"effect magnitude unknown":(e.meanChange>=0?"+":"")+e.meanChange.toFixed(2)}
      {" "}({e.informative}/{e.trials} informative trials)
    </p>)}
    <p>Observed trees: {state.seen.join(", ")||"none"}</p>
    <p>Creations: {state.artifacts.join(", ")||"none"}</p>
    <h3>Available actions (manual)</h3><div className="cog009-actions">
     {opportunities009(state).map(a=><button key={actionKey009(a)} disabled={busy||mode==="hybrid"&&!!state.project} onClick={()=>{try{act(a,"Manual experiment action");setError("")}catch(e){setError(String(e))}}}>{fmt(a)}</button>)}
    </div>
   </section>
   <section className="cog009-card"><h2>Cognition and memory</h2>
    <p>Current goal: {state.workingGoal||"Not set"}</p>
    {state.project&&<div><h3>Active self-proposed project</h3><p><strong>{state.project.title}</strong>: {state.project.intention}</p>
      <p className="cog009-note">Observed sources: {state.project.sourceIds.join(", ")}</p></div>}
    <h3>Completed projects ({state.creations.length})</h3>
    {state.creations.length===0?<p className="cog009-note">None yet. Hybrid mode proposes projects after Nimo observes something.</p>:
      state.creations.map(c=><details key={c.projectId}><summary>{c.title} (step {c.createdStep})</summary>
        <p className="cog009-note">Evidence: {c.sourceIds.join(", ")}</p>
        <pre>{c.content}</pre></details>)}
    <p>Relevant consolidated memories: {view.consolidatedMemories.length}</p>
    {view.consolidatedMemories.map(m=><p key={m.id}><strong>{m.id}</strong>: {m.lesson}</p>)}
    <p>Stored memories: {state.memories.length}. Episodic events: {state.episodes.length}.</p>
    <details><summary>Inspect complete decision context</summary><pre>{JSON.stringify(view,null,2)}</pre></details>
   </section>
  </div>
  <section className="cog009-card"><h2>Decision journal</h2>
   {state.episodes.length===0?<p>No decisions yet.</p>:[...state.episodes].reverse().slice(0,35).map(e=>
    <details key={e.step}><summary>#{e.step} {fmt(e.action)} — {e.result}</summary>
     <p>Reason: {e.reason}</p><p>Mood {e.before.mood} → {e.after.mood}; Energy {e.before.energy} → {e.after.energy}</p>
     <p>Retrieved memories: {e.retrieved.join(", ")||"none"}</p>
    </details>)}
  </section>
  <p className="cog009-note">Hybrid mode creates an evidence-grounded project after observations and asks the LLM to write a complete artefact when the local planner chooses to create. The project and written output are experimental; there is no production persistence. Local mode is a baseline, not emergent cognition. LLM mode selects actions using only its observed state and retrieved evidence; hidden effects are not included in prompts. The lab's deterministic consolidation is deliberately limited to two example patterns.</p>
 </main>;
}
