"use client";

import {useRef,useState} from "react";
import {availableLabActions,createLab,labDecisionContext,nextTrial,performLabAction,
  type LabAction,type LabState} from "../../../lib/learning-lab";
import "./lab.css";

const LABEL:Record<LabAction,string>={
  inspect_tree:"Inspect tree",pick_fruit:"Pick mava",eat_fruit:"Eat mava",wait:"Wait",
};

export default function LearningLab(){
  const [state,setState]=useState<LabState>(()=>createLab(0.65));
  const [memoryEnabled,setMemoryEnabled]=useState(true);
  const [ownerToken,setOwnerToken]=useState("");
  const [busy,setBusy]=useState(false);
  const trialGeneration=useRef(0);
  const requestInFlight=useRef(false);
  const runController=useRef<AbortController|null>(null);
  const currentState=useRef(state);
  const [runnerProgress,setRunnerProgress]=useState<{completed:number;total:number;status:string}|null>(null);
  const [error,setError]=useState("");
  const [decision,setDecision]=useState<{action:string;reason:string}|null>(null);
  const [runLog,setRunLog]=useState<{step:number;action:LabAction;reason:string;mode:string;source:string;context:ReturnType<typeof labDecisionContext>}[]>([]);
  const available=availableLabActions(state);

  function applyDecision(
    action:LabAction,reason:string,source:string,
    context:ReturnType<typeof labDecisionContext>,generation=trialGeneration.current
  ){
    if(generation!==trialGeneration.current)return false;
    const before=currentState.current;
    if(!availableLabActions(before).includes(action))return false;
    const after=performLabAction(before,action,memoryEnabled);
    currentState.current=after;
    setState(after);
    setDecision({action,reason});
    setRunLog(current=>[...current,{step:after.step,action,reason,mode:memoryEnabled?"memory":"control",source,context}].slice(-80));
    return true;
  }
  function act(action:LabAction,reason="Selected manually",source="manual",context=labDecisionContext(currentState.current,memoryEnabled)){
    if(requestInFlight.current)return;
    setError("");
    try{
      if(!applyDecision(action,reason,source,context))throw new Error("Action unavailable in this lab state");
    }catch(e){setError(e instanceof Error?e.message:"Could not execute action");}
  }
  function stopRun(){
    // Abort the current fetch and cancel the next iteration; preserve completed steps.
    runController.current?.abort();
    if(runController.current)setRunnerProgress(p=>p&&({...p,status:"Stopping…"}));
  }
  async function requestDecision(context:ReturnType<typeof labDecisionContext>,signal:AbortSignal){
    const res=await fetch("/api/world/lab/decide",{
      method:"POST",headers:{"Content-Type":"application/json","x-lab-owner-token":ownerToken},
      body:JSON.stringify({context,memoryEnabled}),signal,
    });
    const body=await res.json() as {error?:string;action?:LabAction;reason?:string};
    if(!res.ok||!body.action||!body.reason)throw new Error(body.error||"No valid lab action");
    if(!context.availableActions.includes(body.action))throw new Error("Model chose an unavailable action");
    return {action:body.action,reason:body.reason};
  }
  async function runDecisions(total:number){
    if(requestInFlight.current||!ownerToken)return;
    requestInFlight.current=true;
    const controller=new AbortController();
    runController.current=controller;
    const generation=trialGeneration.current;
    setBusy(true);setError("");
    setRunnerProgress({completed:0,total,status:"Running"});
    let completed=0;
    try{
      for(let i=0;i<total;i++){
        if(controller.signal.aborted||generation!==trialGeneration.current)break;
        const context=labDecisionContext(currentState.current,memoryEnabled);
        const result=await requestDecision(context,controller.signal);
        if(controller.signal.aborted||generation!==trialGeneration.current)break;
        if(!applyDecision(result.action,result.reason,"llm",context,generation))
          throw new Error("Decision no longer available");
        completed++;
        setRunnerProgress({completed,total,status:completed===total?"Completed":"Running"});
        if(completed<total){
          await new Promise<void>(resolve=>{
            const timeout=window.setTimeout(()=>{controller.signal.removeEventListener("abort",onAbort);resolve();},900);
            function onAbort(){window.clearTimeout(timeout);resolve();}
            controller.signal.addEventListener("abort",onAbort,{once:true});
          });
        }
      }
      if(controller.signal.aborted)setRunnerProgress({completed,total,status:"Stopped"});
    }catch(e){
      if(controller.signal.aborted)setRunnerProgress({completed,total,status:"Stopped"});
      else{
        setError(e instanceof Error?e.message:"Experiment failed");
        setRunnerProgress({completed,total,status:"Failed"});
      }
    }finally{
      runController.current=null;
      requestInFlight.current=false;
      setBusy(false);
    }
  }
  function resetTrial(retainMemory:boolean){
    if(requestInFlight.current)return;
    trialGeneration.current++;
    const next=nextTrial(currentState.current,0.65,retainMemory&&memoryEnabled);
    currentState.current=next;
    setState(next);
    setRunnerProgress(null);
    setDecision(null);
    setError("");
    setRunLog([]);
  }
  function toggleMemory(enabled:boolean){
    if(requestInFlight.current)return;
    trialGeneration.current++;
    setMemoryEnabled(enabled);
    const next=createLab(0.65);
    currentState.current=next;
    setState(next);
    setRunnerProgress(null);
    setDecision(null);
    setRunLog([]);
    setError("");
  }
  function downloadLog(){
    const timestamp=new Date().toISOString();
    const lines=[
      "# Nimo 004 — Learning Laboratory", "",
      "## Trial configuration", "",
      "- Initial hunger: 65%",
      "- Experience memory: "+(memoryEnabled?"enabled":"disabled (control)"),
      "- Exported: "+timestamp,
      "- Completed steps: "+state.step,
      "- Final hunger: "+Math.round(state.hunger*100)+"%",
      "- Fruit remaining: "+state.treeFruit,
      "- Fruit in inventory: "+state.inventory,
      "", "## Learned consequences", ""
    ];
    const knowledge=Object.entries(state.knowledge);
    if(!memoryEnabled || knowledge.length===0)lines.push("No learned consequences recorded.");
    else for(const [action,info] of knowledge){
      if(info)lines.push("- "+action+": "+info.count+" observations; mean hunger change "+Math.round(info.meanHungerDelta*100)+" percentage points");
    }
    lines.push("","## Chronological action log","");
    if(state.events.length===0)lines.push("No actions yet.");
    for(const event of state.events){
      const log=runLog.find(item=>item.step===event.step);
      lines.push("### Step "+event.step+" — "+event.action,"",
        "- Source: "+(log?.source??"unknown"),
        "- Condition: "+(log?.mode??(memoryEnabled?"memory":"control")),
        "- Reason: "+(log?.reason??"not recorded").replace(/[\r\n]+/g," "),
        "- Hunger before: "+Math.round(event.beforeHunger*100)+"%",
        "- Hunger after: "+Math.round(event.afterHunger*100)+"%",
        "- Observed change: "+Math.round(event.hungerDelta*100)+" percentage points",
        "- Predicted change: "+(event.predictedHungerDelta===null?"unknown":Math.round(event.predictedHungerDelta*100)+" percentage points"),
        "- Verified result: "+event.result.replace(/[\r\n]+/g," "),
        "");
      if(log){lines.push("Context supplied before decision:","", "~~~json",JSON.stringify(log.context,null,2),"~~~","");}
    }
    lines.push("## Analysis note","",
      "This log records observed consequences and the model\u2019s stated reasons. A single successful action does not establish learning; compare memory-enabled and control trials.","");
    const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="nimo-learning-lab-"+timestamp.replace(/[:.]/g,"-")+".md";
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function askModel(){await runDecisions(1);}
  const last=state.events.at(-1);
  return <main className="nimo-lab">
    <nav className="lab-nav"><a href="/world">Nimo's world</a><span>Independent experiment · No production writes</span></nav>
    <header className="lab-header">
      <p className="lab-eyebrow">NIMO 004 · LEARNING LABORATORY</p>
      <h1>Can experience change Nimo's choices?</h1>
      <p>One unfamiliar fruit, one need, and a tiny consequence learner. This laboratory has no connection to the live world, Worker, journal, or D1 database.</p>
    </header>
    <section className="lab-grid">
      <div className="lab-panel">
        <h2>Environment</h2>
        <div className="lab-scene" role="img" aria-label="An isolated tree with three fictional mava fruits">
          <div className="lab-canopy">◉ ◉ ◉</div><div className="lab-trunk"/>
          <div className="lab-ground">Mava tree · {state.treeFruit} fruit remaining</div>
        </div>
        <div className="lab-meter-label"><strong>Hunger</strong><strong>{Math.round(state.hunger*100)}%</strong></div>
        <div className="lab-meter"><div style={{width:(state.hunger*100)+"%"}}/></div>
        <p className="lab-muted">Inventory: {state.inventory} mava · Step {state.step}</p>
        <p className="lab-muted">{state.treeInspected?"Tree inspected; fruit picking discovered.":"Tree not yet inspected. Its effects are unknown."}</p>
        <h3>Available actions</h3>
        <div className="lab-actions">
          {available.map(a=><button key={a} type="button" disabled={busy} onClick={()=>act(a)}>{LABEL[a]}</button>)}
        </div>
      </div>
      <div className="lab-panel">
        <h2>Experiment controls</h2>
        <label className="lab-toggle"><input type="checkbox" checked={memoryEnabled} disabled={busy} onChange={e=>toggleMemory(e.target.checked)}/> Experience memory enabled</label>
        <p className="lab-muted">Switching conditions resets the trial. All runs begin at 65% hunger, with three fruit and no remembered outcomes.</p>
        <div className="lab-actions">
          <button onClick={()=>resetTrial(true)} type="button" disabled={busy}>New trial · retain learning</button>
          <button onClick={()=>resetTrial(false)} type="button" disabled={busy}>Fresh start · clear learning</button>
        </div>
        <hr/>
        <h3>Ask Nimo to choose one action</h3>
        <p className="lab-muted">Run 20 sequential LLM decisions with a short delay, or step through one at a time. Stop preserves completed actions. Each decision is a separate model request; no background scheduler runs.</p>
        <label htmlFor="lab-token">Owner token</label>
        <input id="lab-token" type="password" autoComplete="off" placeholder="World owner token"
          value={ownerToken} onChange={e=>setOwnerToken(e.target.value)}/>
        <div className="lab-actions">
          <button className="lab-primary" type="button" disabled={!ownerToken||busy} onClick={()=>void runDecisions(20)}>
            Run experiment · 20 decisions
          </button>
          <button type="button" disabled={!ownerToken||busy} onClick={()=>void askModel()}>
            Ask Nimo · one decision
          </button>
          <button type="button" disabled={!busy||!runController.current} onClick={stopRun}>
            Stop
          </button>
        </div>
        {runnerProgress&&<div className="lab-result" role="status">
          <strong>{runnerProgress.status}: {runnerProgress.completed} / {runnerProgress.total} decisions</strong>
          <p>Completed actions are retained and included in the downloadable log.</p>
        </div>
        <p className="lab-muted">Each automatic run makes up to 20 billable LLM calls. The lab requires LAB_OPENAI_API_KEY and your existing WORLD_OWNER_TOKEN. Closing or refreshing the page stops the browser-run sequence; completed steps must be downloaded before refreshing.</p>
        {error&&<p className="lab-error" role="alert">{error}</p>}
        {decision&&<div className="lab-result"><strong>Last choice: {LABEL[decision.action as LabAction]}</strong><p>{decision.reason}</p></div>}
      </div>
      <div className="lab-panel">
        <h2>What Nimo has learned</h2>
        <p className="lab-muted">Only verified changes are learned. These predictions are provided to the model only when memory is enabled.</p>
        {Object.keys(state.knowledge).length===0?<p>No learned consequences yet.</p>:
          <table className="lab-table"><thead><tr><th>Action</th><th>Observations</th><th>Expected hunger change</th></tr></thead>
            <tbody>{Object.entries(state.knowledge).map(([action,v])=>
              <tr key={action}><td>{LABEL[action as LabAction]}</td><td>{v?.count}</td><td>{Math.round((v?.meanHungerDelta??0)*100)} points</td></tr>)}</tbody>
          </table>}
        {last&&<div className="lab-result">
          <strong>Last verified outcome</strong><p>{last.result}</p>
          <p className="lab-muted">Prior predicted hunger change: {last.predictedHungerDelta===null?"Unknown":Math.round(last.predictedHungerDelta*100)+" points"}</p>
        </div>}
      </div>
      <div className="lab-panel">
        <h2>Action history</h2>
        <button type="button" onClick={downloadLog} disabled={state.events.length===0}>Download experiment log (.md)</button>
        <p className="lab-muted">Save the trial settings, LLM decisions, decision contexts, predictions and verified outcomes before resetting or refreshing.</p>
        <p className="lab-muted">Lab-only outcomes; no production logs are read or written.</p>
        {state.events.length===0?<p>No actions yet.</p>:
          <ol className="lab-history">{[...state.events].reverse().slice(0,16).map(e=>
            <li key={e.step}><strong>{e.step}. {LABEL[e.action]}</strong> · {Math.round(e.hungerDelta*100)} hunger points
              <p>{e.result}</p></li>)}</ol>}
        <h3>LLM decision trace</h3>
        {runLog.length===0?<p className="lab-muted">No choices yet.</p>:
          <ol className="lab-history">{[...runLog].reverse().slice(0,8).map((e,i)=>
            <li key={i}><strong>{LABEL[e.action]}</strong> · {e.mode}<p>{e.reason}</p></li>)}</ol>}
      </div>
    </section>
    <footer>Lab data lives in this page's memory and disappears on refresh. To compare conditions fairly, repeat trials under both modes rather than relying on a single decision.</footer>
  </main>;
}
