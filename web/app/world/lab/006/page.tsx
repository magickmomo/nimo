"use client";

import {useRef,useState} from "react";
import {
  OBJECTS,initial005,mappingFromSeed005,application005,
  apply005,metrics005, type State005,type Mapping005,type Action005,
} from "../../../../lib/learning-lab-005";
import {
  decisionView006,predictions006,type Arm006,type Phase006,type Prediction006,
} from "../../../../lib/learning-lab-006";
import "../lab.css";

type Session006={
  seed:number;mapping:Mapping005;discovery:State005;
  control:State005;memory:State005;evaluation:State005;finished:boolean;
  trace: {phase:Phase006;step:number;action:Action005;reason:string;
    modelMessages:{role:string;content:string}[]}[];
};
const fresh=(seed:number):Session006=>({
  seed,mapping:mappingFromSeed005(seed),discovery:initial005(),control:initial005(),
  memory:initial005(),evaluation:initial005(),trace:[],finished:false,
});
const phases:Phase006[]=["discovery","control","memory","evaluation"];
const phaseName=(p:Phase006)=>({
  discovery:"Discovery",control:"No memory",memory:"Learned memory",
  evaluation:"Memory + predicted outcomes",
})[p];
const pct=(n:number|null)=>n===null?"—":(n*100).toFixed(1)+"%";
const delay=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{
  if(signal.aborted){resolve();return;}
  const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};
  const timer=window.setTimeout(done,ms);
  signal.addEventListener("abort",done,{once:true});
});

export default function Nimo006(){
  const [token,setToken]=useState("");
  const [session,setSession]=useState<Session006|null>(null);
  const latest=useRef<Session006|null>(null);
  const [phase,setPhase]=useState<Phase006>("discovery");
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState("Ready");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const locked=useRef(false);
  const generation=useRef(0);

  function save(s:Session006){latest.current=s;setSession(s);}
  function stop(){controller.current?.abort();if(controller.current)setStatus("Stopping…");}
  async function choose(context:ReturnType<typeof decisionView006>,stage:Phase006,signal:AbortSignal){
    const response=await fetch("/api/world/lab/006/decide",{
      method:"POST",headers:{"Content-Type":"application/json","x-lab-owner-token":token},
      body:JSON.stringify({phase:stage,context}),signal,
    });
    const data=await response.json() as {error?:string;action?:Action005;reason?:string;
      modelMessages?:{role:string;content:string}[]};
    if(!response.ok||!data.action||typeof data.reason!=="string"||
      !Array.isArray(data.modelMessages)||
      data.modelMessages.length!==2||
      !data.modelMessages.every(m=>typeof m.role==="string"&&typeof m.content==="string"))
      throw new Error(data.error||"No valid model choice");
    if(!context.availableActions.includes(data.action))throw new Error("Unavailable action returned");
    return {action:data.action,reason:data.reason,modelMessages:data.modelMessages};
  }
  async function start(){
    if(locked.current||!token)return;
    locked.current=true;
    const runId=++generation.current;
    const ctrl=new AbortController();
    controller.current=ctrl;
    setBusy(true);setProgress(0);setStatus("Starting discovery");setError("");
    let current=fresh(Math.floor(Math.random()*1000000));
    save(current);
    let completed=0;
    try{
      for(const stage of phases){
        if(ctrl.signal.aborted)break;
        setPhase(stage);setStatus("Running "+phaseName(stage));
        if(stage!=="discovery"){
          current={...current,[stage]:application005(current.discovery.learned,stage!=="control")};
          save(current);
        }
        for(let i=0;i<20;i++){
          if(ctrl.signal.aborted||runId!==generation.current)break;
          const prior=current[stage];
          const context=decisionView006(prior,stage);
          const decision=await choose(context,stage,ctrl.signal);
          if(ctrl.signal.aborted||runId!==generation.current)break;
          const after=apply005(prior,decision.action,current.mapping,decision.reason,
            stage==="discovery"?"discovery":stage==="control"?"control":"memory");
          current={...current,[stage]:after,trace:[...current.trace,{
            phase:stage,step:after.step,action:decision.action,
            reason:decision.reason,modelMessages:decision.modelMessages,
          }]};
          completed++;setProgress(completed);save(current);
          if(i<19)await delay(500,ctrl.signal);
        }
      }
      if(!ctrl.signal.aborted&&completed===80){
        save({...current,finished:true});setStatus("Complete — download the experiment log");
      }else setStatus("Stopped — partial results available");
    }catch(e){
      if(ctrl.signal.aborted)setStatus("Stopped — partial results available");
      else{setStatus("Failed — partial results available");
        setError(e instanceof Error?e.message:"Unknown error");}
    }finally{
      locked.current=false;controller.current=null;setBusy(false);
    }
  }
  function download(){
    const s=latest.current;
    if(!s)return;
    const now=new Date().toISOString();
    const lines=[
      "# Nimo 006 — From Memory to Action Evaluation","",
      "## Experiment configuration","",
      "- Timestamp: "+now,
      "- Status: "+(s.finished?"completed":"partial"),
      "- Seed: "+s.seed,
      "- Four stages: 20 discovery decisions + 20 decisions in each of three application arms",
      "- All arms start at hunger 65%, share the same hidden mapping and object cooldown rules",
      "- Every decision increases hunger by 8 points before the object effect",
      "- Control has no learned memory; memory arm sees learned effects; evaluation arm additionally sees state-dependent predicted outcomes",
      "- Application arms do not update their learned model; the discovery state is frozen",
      "- Mean hunger across each application arm is the primary outcome",
      "",
      "## Hidden mapping — revealed for analysis only","",
    ];
    for(const id of OBJECTS)lines.push("- "+id+": "+Math.round(s.mapping[id]*100)+" intrinsic hunger points");
    lines.push("","## Results","","| Metric | No memory | Memory | Memory + evaluation |",
      "|---|---:|---:|---:|");
    const arms:Arm006[]=["control","memory","evaluation"];
    const measures=arms.map(a=>metrics005(s[a]));
    for(const key of ["decisions","meanHunger","useful","harmful","neutral","wait"] as const){
      const title={decisions:"Decisions",meanHunger:"Mean hunger",useful:"Helpful actions",
        harmful:"Harmful actions",neutral:"Neutral actions",wait:"Waits"}[key];
      lines.push("| "+title+" | "+measures.map(m=>key==="meanHunger"?pct(m[key]):String(m[key])).join(" | ")+" |");
    }
    lines.push("","## Discovered consequences","");
    for(const id of OBJECTS){
      const v=s.discovery.learned[id];
      lines.push("- "+id+": "+(v?"count "+v.count+", informative "+v.uncensoredCount+
        ", estimated effect "+(v.mean===null?"unknown":Math.round(v.mean*100)+" points"):"unknown"));
    }
    for(const stage of phases){
      lines.push("","## "+phaseName(stage),"");
      const trial=s[stage];
      lines.push("- Decisions: "+trial.step,"- Final hunger: "+pct(trial.hunger),"");
      for(const event of trial.events){
        const trace=s.trace.find(t=>t.phase===stage&&t.step===event.step);
        lines.push("### Step "+event.step+" — "+event.action,"",
          "- Reason: "+event.reason.replace(/[\r\n]+/g," "),
          "- Hunger before: "+pct(event.before),
          "- Hunger after: "+pct(event.after),
          "- Net hunger change (including time): "+Math.round(event.delta*100)+" points",
          "- Hidden intrinsic effect (not supplied to model): "+Math.round(event.actionEffect*100)+" points",
          "- Prior learned intrinsic effect: "+(event.prediction===null?"unknown":Math.round(event.prediction*100)+" points"),
          "- Verified result: "+event.result,"",
          "Exact messages sent to the model (system and sanitized user prompt):","",
          "~~~json",trace?JSON.stringify(trace.modelMessages,null,2):
            "Not recorded: model prompt unavailable for this step.","~~~","");
      }
    }
    lines.push("## Caveats","",
      "- Only one trial with one randomized mapping. Repeat trials to assess reliability.",
      "- Predicted outcomes come from discovery observations, not the hidden mapping.",
      "- Stated reasons are not reliable proof of internal causal reasoning.",
      "- All three application arms have identical starting state, but their later states depend on their decisions.",
      "");
    const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download="nimo-006-"+now.replace(/[:.]/g,"-")+".md";
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const displayed=session?.[phase];
  const last=displayed?.events.at(-1);
  const outcomes:Prediction006[]=displayed&&phase==="evaluation"?predictions006(displayed):[];
  return <main className="nimo-lab">
    <nav className="lab-nav"><a href="/world/lab/005">Nimo 005</a><span>Independent experiment · no production world access</span></nav>
    <header className="lab-header">
      <p className="lab-eyebrow">NIMO 006 · ACTION EVALUATION</p>
      <h1>Does showing predicted outcomes improve Nimo's choices?</h1>
      <p>One discovery history, three application conditions and the same uniform-time rules. The third condition receives expected hunger after each available action, calculated solely from learned observations.</p>
    </header>
    <section className="lab-grid">
      <div className="lab-panel">
        <h2>Run experiment</h2>
        <p className="lab-muted">20 decisions to discover consequences, then three independent 20-decision application runs. 80 sequential, potentially billable model requests per full experiment.</p>
        <label htmlFor="nimo006token">Owner token</label>
        <input id="nimo006token" type="password" autoComplete="off" placeholder="World owner token"
          disabled={busy} value={token} onChange={e=>setToken(e.target.value)}/>
        <div className="lab-actions" style={{marginTop:12}}>
          <button className="lab-primary" type="button" disabled={!token||busy} onClick={()=>void start()}>
            Start 80-decision experiment
          </button>
          <button type="button" disabled={!busy} onClick={stop}>Stop</button>
          <button type="button" disabled={!session?.trace.length} onClick={download}>Download log (.md)</button>
        </div>
        <p role="status"><strong>{status}</strong> · {progress} / 80 decisions</p>
        <div className="lab-meter"><div style={{width:progress/80*100+"%"}}/></div>
        {error&&<p role="alert" className="lab-error">{error}</p>}
        <p className="lab-muted">Running another experiment replaces in-browser data. Download this trial first. Refreshing closes the experiment without saving anything remotely.</p>
      </div>
      <div className="lab-panel">
        <h2>Current stage: {phaseName(phase)}</h2>
        <p className="lab-muted">Hunger rises by 8 percentage points on every decision, then the selected object's effect is applied. The beneficial and harmful names are randomized.</p>
        <div className="lab-meter-label"><strong>Hunger</strong><strong>{pct(displayed?.hunger??0.65)}</strong></div>
        <div className="lab-meter"><div style={{width:(displayed?.hunger??0.65)*100+"%"}}/></div>
        <p className="lab-muted">Stage step: {displayed?.step??0} / 20</p>
        {last&&<div className="lab-result"><strong>Last action: {last.action}</strong><p>{last.result}</p><p className="lab-muted">{last.reason}</p></div>}
      </div>
      <div className="lab-panel">
        <h2>Comparison</h2>
        <table className="lab-table">
          <thead><tr><th>Measure</th><th>Control</th><th>Memory</th><th>Evaluation</th></tr></thead>
          <tbody>
            {(["decisions","meanHunger","useful","harmful","wait"] as const).map(key=>
              <tr key={key}><td>{({decisions:"Steps",meanHunger:"Avg. hunger",
                useful:"Helpful",harmful:"Harmful",wait:"Waits"})[key]}</td>
                {(["control","memory","evaluation"] as Arm006[]).map(arm=>{
                  const result=session?metrics005(session[arm]):null;
                  return <td key={arm}>{!result?"—":key==="meanHunger"?pct(result[key]):result[key]}</td>;
                })}
              </tr>)}
          </tbody>
        </table>
        <p className="lab-muted">Lower mean hunger is better. Compare learned-memory-only against explicit evaluation to test the value of the predicted-outcome table.</p>
      </div>
      <div className="lab-panel">
        <h2>What Nimo knows</h2>
        {OBJECTS.map(id=>{
          const observation=session?.discovery.learned[id];
          return <div className="lab-result" key={id}>
            <strong>{id}</strong>
            <p className="lab-muted">{observation?
              observation.count+" observations · intrinsic effect "+
              (observation.mean===null?"unknown":Math.round(observation.mean*100)+" points")
              :"Not observed yet"}</p>
          </div>;
        })}
        {outcomes.length>0&&<>
          <h3>Predictions currently shown to Nimo</h3>
          <table className="lab-table"><thead><tr><th>Action</th><th>Predicted hunger after</th></tr></thead>
            <tbody>{outcomes.map(p=><tr key={p.action}><td>{p.action}</td>
              <td>{pct(p.expectedHungerAfter)}</td></tr>)}</tbody>
          </table>
        </>}
        <p className="lab-muted">No hidden effects are supplied to the model. An unknown learned effect remains unknown rather than being guessed.</p>
      </div>
    </section>
    <footer>Only browser memory stores experiment state. Nimo 004, 005, Cloudflare Workers and production D1 are untouched.</footer>
  </main>;
}
