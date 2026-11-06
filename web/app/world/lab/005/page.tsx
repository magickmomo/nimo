"use client";

import {useRef,useState} from "react";
import {
  OBJECTS,initial005,mappingFromSeed005,application005,context005,
  apply005,metrics005,type State005,type Mapping005,type Action005,
  type Condition005,type DecisionContext005
} from "../../../../lib/learning-lab-005";
import "../lab.css";

type Stage = "discovery" | "memory" | "control";
type DecisionRecord={phase:Stage;step:number;action:Action005;reason:string;context:DecisionContext005};
type Session={
  seed:number;mapping:Mapping005;discovery:State005;memory:State005;control:State005;
  records:DecisionRecord[];finished:boolean;
};
const makeSession=(seed:number):Session=>({
  seed,mapping:mappingFromSeed005(seed),discovery:initial005(),
  memory:initial005(),control:initial005(),records:[],finished:false,
});
const pretty=(n:number|null)=>n===null?"—":Math.round(n*100)+"%";
const stageTitle=(stage:Stage)=>stage==="discovery"?"Discovery":"Application · "+(stage==="memory"?"memory enabled":"control");
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{
  if(signal.aborted){resolve();return;}
  const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};
  const timer=window.setTimeout(done,ms);
  signal.addEventListener("abort",done,{once:true});
});

export default function Lab005(){
  const [session,setSession]=useState<Session|null>(null);
  const latest=useRef<Session|null>(null);
  const [stage,setStage]=useState<Stage>("discovery");
  const [running,setRunning]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState("Ready to start");
  const [error,setError]=useState("");
  const [token,setToken]=useState("");
  const controller=useRef<AbortController|null>(null);
  const locked=useRef(false);
  const generation=useRef(0);

  function save(next:Session){
    latest.current=next;
    setSession(next);
  }
  function stop(){
    controller.current?.abort();
    if(controller.current)setStatus("Stopping after the current request");
  }
  async function modelDecision(context:DecisionContext005,condition:Condition005,signal:AbortSignal){
    const res=await fetch("/api/world/lab/005/decide",{
      method:"POST",headers:{"Content-Type":"application/json","x-lab-owner-token":token},
      body:JSON.stringify({context,condition}),signal,
    });
    const data=await res.json() as {error?:string;action?:Action005;reason?:string};
    if(!res.ok||!data.action||typeof data.reason!=="string")
      throw new Error(data.error||"No valid model decision");
    if(!context.availableActions.includes(data.action))throw new Error("Unavailable decision returned");
    return {action:data.action,reason:data.reason};
  }
  async function run(){
    if(locked.current||!token)return;
    locked.current=true;
    generation.current++;
    const thisGeneration=generation.current;
    const ctrl=new AbortController();
    controller.current=ctrl;
    setRunning(true);setError("");setStatus("Running discovery");setProgress(0);
    const seed=Math.floor(Math.random()*1000000);
    let current=makeSession(seed);
    save(current);
    let count=0;
    try{
      const phases:Stage[]=["discovery","memory","control"];
      for(const phase of phases){
        if(ctrl.signal.aborted)break;
        setStage(phase);setStatus("Running "+stageTitle(phase));
        if(phase!=="discovery"){
          const initial=application005(current.discovery.learned,phase==="memory");
          current={...current,[phase]:initial};
          save(current);
        }
        for(let i=0;i<20;i++){
          if(ctrl.signal.aborted||generation.current!==thisGeneration)break;
          const before=current[phase];
          const context=context005(before,phase!=="control");
          const choice=await modelDecision(context,phase,ctrl.signal);
          if(ctrl.signal.aborted||generation.current!==thisGeneration)break;
          const after=apply005(before,choice.action,current.mapping,choice.reason,phase);
          const record:DecisionRecord={phase,step:after.step,action:choice.action,
            reason:choice.reason,context};
          current={...current,[phase]:after,records:[...current.records,record]};
          count++;setProgress(count);save(current);
          if(i<19)await pause(600,ctrl.signal);
        }
      }
      if(!ctrl.signal.aborted && count===60){
        current={...current,finished:true};save(current);
        setStatus("Completed · ready to download");
      }else setStatus("Stopped · partial results retained");
    }catch(e){
      if(ctrl.signal.aborted)setStatus("Stopped · partial results retained");
      else{
        setStatus("Failed · partial results retained");
        setError(e instanceof Error?e.message:"Unexpected error");
      }
    }finally{
      locked.current=false;controller.current=null;setRunning(false);
    }
  }
  function download(){
    const current=latest.current;
    if(!current)return;
    const now=new Date().toISOString();
    const lines=[
      "# Nimo 005 — Discovery and Learning","",
      "## Configuration","",
      "- Exported: "+now,
      "- Discovery: 20 decisions, starting hunger 65%",
      "- Application: 20 decisions per condition, each starting hunger 65%",
      "- Conditions: remembered consequences versus no remembered consequences",
      "- Objects: neutral names, randomised hidden effects, renewable after 3 decisions",
      "- Status: "+(current.finished?"completed":"partial"),
      "- Randomisation seed: "+current.seed,"",
      "## Verified environment mapping (revealed after the run)",""
    ];
    for(const id of OBJECTS)lines.push("- "+id+": "+Math.round(current.mapping[id]*100)+" hunger points per interaction");
    lines.push("","## Results summary","","| Metric | Memory enabled | Control |","| --- | ---: | ---: |");
    const m=metrics005(current.memory),c=metrics005(current.control);
    for(const [title,key] of [
      ["Completed decisions","decisions"],
      ["Mean hunger across application","meanHunger"],
      ["Helpful interactions","useful"],
      ["Harmful interactions","harmful"],
      ["Neutral interactions","neutral"],
      ["Waiting","wait"]
    ] as const){
      const a=m[key],b=c[key];
      const format=(v:number|null)=>v===null?"—":key==="meanHunger"?pretty(v):String(v);
      lines.push("| "+title+" | "+format(a)+" | "+format(b)+" |");
    }
    lines.push("","## Discovered consequences","");
    const learned=current.discovery.learned;
    for(const id of OBJECTS){
      const e=learned[id];
      lines.push("- "+id+": "+(e?e.count+" observations; "+e.uncensoredCount+
        " uncensored; predicted change "+(e.mean===null?"unknown":Math.round(e.mean*100)+" points")+
        "; at least "+Math.round(e.atLeastRelief*100)+" points observed relief":"unobserved"));
    }
    for(const phase of ["discovery","memory","control"] as Stage[]){
      lines.push("","## "+stageTitle(phase),"");
      const trial=current[phase];
      lines.push("- Steps: "+trial.step,"- End hunger: "+pretty(trial.hunger),"");
      for(const event of trial.events){
        lines.push("### Step "+event.step+" — "+event.action,"",
          "- Reason: "+event.reason.replace(/[\r\n]+/g," "),
          "- Hunger: "+pretty(event.before)+" → "+pretty(event.after),
          "- Verified change: "+Math.round(event.delta*100)+" points",
          "- Prior prediction: "+(event.prediction===null?"unknown":Math.round(event.prediction*100)+" points"),
          "- Outcome: "+event.result,"",
          "Decision context:","",
          "~~~json",JSON.stringify(event.context,null,2),"~~~","");
      }
    }
    lines.push("## Interpretation","","A difference between conditions in one run is not proof of learning. Repeat with multiple random mappings. The model has fixed pretrained knowledge; only explicit learned consequence summaries differ between application arms.","");
    const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="nimo-005-"+now.replace(/[:.]/g,"-")+".md";
    document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const active=session?.[stage];
  const memory=session?metrics005(session.memory):null;
  const control=session?metrics005(session.control):null;
  return <main className="nimo-lab">
    <nav className="lab-nav"><a href="/world/lab">Nimo 004 lab</a><span>Independent, browser-run experiment · no D1 or Worker access</span></nav>
    <header className="lab-header">
      <p className="lab-eyebrow">NIMO 005 · CONTROLLED EXPERIMENT</p>
      <h1>Discovery and learning</h1>
      <p>Can Nimo learn unfamiliar consequences and use them later? Three neutral objects, a shared discovery phase and two comparable application conditions.</p>
    </header>
    <section className="lab-grid">
      <div className="lab-panel">
        <h2>Run the experiment</h2>
        <p className="lab-muted">20 discovery steps, then 20 steps with learned memory and 20 without. All stages use the same random assignment of hidden object effects. No other Nimo systems are involved.</p>
        <label htmlFor="lab005token">Owner token</label>
        <input id="lab005token" type="password" autoComplete="off" value={token}
          disabled={running} onChange={e=>setToken(e.target.value)} placeholder="World owner token"/>
        <div className="lab-actions" style={{marginTop:14}}>
          <button type="button" className="lab-primary" disabled={running||!token} onClick={()=>void run()}>
            {running?"Experiment running":"Start 60-decision experiment"}
          </button>
          <button type="button" disabled={!running} onClick={stop}>Stop</button>
          <button type="button" disabled={!session||session.records.length===0} onClick={download}>
            Download log (.md)
          </button>
        </div>
        <p role="status"><strong>{status}</strong> · {progress} / 60 decisions</p>
        <div className="lab-meter"><div style={{width:Math.min(100,progress/60*100)+"%"}}/></div>
        {error&&<p className="lab-error" role="alert">{error}</p>}
        <p className="lab-muted">Each complete run makes 60 billable LLM calls. You can Stop at any point and download partial results. Restarting clears the previous in-browser trial, so download first.</p>
      </div>
      <div className="lab-panel">
        <h2>Current phase</h2>
        <p><strong>{stageTitle(stage)}</strong></p>
        <p className="lab-muted">Neutral interactions: luma, vexa and oru. After each use, the object replenishes after three decisions. All effects are hidden from the LLM.</p>
        <div className="lab-actions">
          {OBJECTS.map(id=><span className="lab-result" key={id}>{id}: {active&&active.step<active.readyAt[id]?"replenishing":"available"}</span>)}
        </div>
        <div className="lab-meter-label"><span>Hunger</span><strong>{pretty(active?.hunger??0.65)}</strong></div>
        <div className="lab-meter"><div style={{width:((active?.hunger??0.65)*100)+"%"}}/></div>
        <p className="lab-muted">Hunger increases by 8 points for waiting. The effect of each object's interaction can depend on the current hunger boundary.</p>
        {active?.events.at(-1)&&<div className="lab-result"><strong>Latest action: {active.events.at(-1)?.action}</strong><p>{active.events.at(-1)?.result}</p></div>}
      </div>
      <div className="lab-panel">
        <h2>Application results</h2>
        <table className="lab-table"><thead><tr><th>Measure</th><th>Memory</th><th>Control</th></tr></thead><tbody>
          <tr><td>Decisions</td><td>{memory?.decisions??0}</td><td>{control?.decisions??0}</td></tr>
          <tr><td>Mean hunger</td><td>{pretty(memory?.meanHunger??null)}</td><td>{pretty(control?.meanHunger??null)}</td></tr>
          <tr><td>Helpful interactions</td><td>{memory?.useful??0}</td><td>{control?.useful??0}</td></tr>
          <tr><td>Harmful interactions</td><td>{memory?.harmful??0}</td><td>{control?.harmful??0}</td></tr>
          <tr><td>Waits</td><td>{memory?.wait??0}</td><td>{control?.wait??0}</td></tr>
        </tbody></table>
        <p className="lab-muted">Lower average hunger is the primary result. Both application conditions reset to identical environment states and only differ in the learned consequence summary supplied to the model.</p>
      </div>
      <div className="lab-panel">
        <h2>What was discovered?</h2>
        {OBJECTS.map(id=>{
          const effect=session?.discovery.learned[id];
          return <div className="lab-result" key={id}>
            <strong>{id}</strong>
            <p>{effect?effect.count+" observations; "+effect.uncensoredCount+" informative": "Not yet tried"}</p>
            <p className="lab-muted">Learned mean hunger change: {effect?.mean===undefined||effect.mean===null?"unknown":Math.round(effect.mean*100)+" points"}</p>
          </div>;
        })}
        <p className="lab-muted">If hunger reaches zero, additional hunger relief is censored, not treated as evidence that an object lost its effect. The export reveals the hidden mapping and includes every decision context.</p>
      </div>
    </section>
    <footer>Experimental state stays in this browser tab, not in production. Save the Markdown report before refreshing, restarting or closing this page.</footer>
  </main>;
}
