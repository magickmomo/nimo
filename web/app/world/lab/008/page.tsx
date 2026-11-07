"use client";
import {useRef,useState} from "react";
import {initial008,apply008,view008,actions008,key008,hiddenEffects008,
 type State008,type Action008,type Event008} from "../../../../lib/survival-008";
import {localDecision008} from "../../../../lib/survival-planner-008";
import {evidence008,type EvidenceMode008} from "../../../../lib/survival-learning-008";
import "../lab.css";
import "./survival.css";
type Arm="local"|"llm";
type Trace={step:number;messages:{role:string;content:string}[]};
const label=(a:Action008)=>a.type==="wait"?"Wait "+a.seconds+" seconds":
 a.type==="eat"||a.type==="discard"?a.type+" "+a.fruit:a.type+" "+a.treeId;
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{
 if(signal.aborted)return resolve();const done=()=>{clearTimeout(id);signal.removeEventListener("abort",done);resolve()};
 const id=window.setTimeout(done,ms);signal.addEventListener("abort",done,{once:true});
});
export default function Nimo008(){
 const [seed,setSeed]=useState(48162),[rate,setRate]=useState(1);
 const [evidenceMode,setEvidenceMode]=useState<EvidenceMode008>("evaluation");
 const [states,setStates]=useState<Record<Arm,State008>>({local:initial008(),llm:initial008()});
 const latest=useRef(states),traces=useRef<Record<Arm,Trace[]>>({local:[],llm:[]});
 const [arm,setArm]=useState<Arm>("local"),[token,setToken]=useState("");
 const [busy,setBusy]=useState(false),locked=useRef(false),ctrl=useRef<AbortController|null>(null);
 const [status,setStatus]=useState("Ready — both planners use the same world seed."),[error,setError]=useState("");
 const s=states[arm],v=view008(s);
 function save(a:Arm,next:State008){latest.current={...latest.current,[a]:next};setStates(latest.current)}
 function reset(){if(locked.current)return;const n=Math.floor(Math.random()*1000000);setSeed(n);
  latest.current={local:initial008(n),llm:initial008(n)};setStates(latest.current);
  traces.current={local:[],llm:[]};setStatus("New identical worlds, seed "+n);setError("");}
 function stop(){ctrl.current?.abort();setStatus("Stopping run.")}
 async function decide(current:State008,which:Arm,signal:AbortSignal):Promise<{
  action:Action008;reason:string;messages?:Trace["messages"]}>{
  if(which==="local")return localDecision008(current,rate);
  const response=await fetch("/api/world/lab/008/decide",{method:"POST",signal,
   headers:{"Content-Type":"application/json","x-lab-owner-token":token},
   body:JSON.stringify({view:evidence008(current,rate,evidenceMode),rate,evidenceMode})});
  const data=await response.json() as {action?:Action008;reason?:string;error?:string;modelMessages?:Trace["messages"]};
  if(!response.ok||!data.action||typeof data.reason!=="string"||!Array.isArray(data.modelMessages))
   throw Error(data.error||"Model response invalid");
  if(!actions008(current).some(a=>key008(a)===key008(data.action!)))throw Error("Model chose unavailable action");
  return{action:data.action,reason:data.reason,messages:data.modelMessages};
 }
 async function run(n:number){
  if(locked.current||(arm==="llm"&&!token.trim()))return;
  locked.current=true;setBusy(true);setError("");const controller=new AbortController();ctrl.current=controller;
  const which=arm;let current=latest.current[which];
  try{for(let i=0;i<n&&!controller.signal.aborted;i++){
    if(document.visibilityState==="hidden"){setStatus("Stopped because tab is hidden.");break}
    const chosen=await decide(current,which,controller.signal);if(controller.signal.aborted)break;
    current=apply008(current,chosen.action,rate,which,chosen.reason);save(which,current);
    if(chosen.messages)traces.current[which].push({step:current.events.length,messages:chosen.messages});
    setStatus(which+": "+current.events.length+" decisions, "+current.seconds+" simulated seconds, hunger "+current.hunger+"%");
    if(i<n-1)await sleep(which==="llm"?250:80,controller.signal);
   }}catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:"Decision failed");setStatus("Run stopped; partial history preserved.");}}
  finally{locked.current=false;ctrl.current=null;setBusy(false);}
 }
 function manual(a:Action008){if(locked.current)return;
  try{save(arm,apply008(latest.current[arm],a,rate,"manual","Manual action"));setError("")}
  catch(e){setError(e instanceof Error?e.message:"Invalid action");}
 }
 function exportLog(){
  const state=latest.current[arm],lines=["# Nimo 008 — Survival Planning","","- Seed: "+seed,
   "- Mode: "+arm,"- LLM evidence mode: "+evidenceMode,"- Hunger rate: "+rate,"- Simulated seconds: "+state.seconds,
   "- Decisions: "+state.events.length,"- Final hunger: "+state.hunger,"",
   "## Hidden effects — analysis only","",JSON.stringify(hiddenEffects008(seed),null,2),"",
   "## Learned experience","",JSON.stringify(state.memory,null,2),"","## Decisions",""];
  for(const e of state.events){const trace=traces.current[arm].find(t=>t.step===e.step);
   lines.push("### "+e.step+" — "+label(e.action),"",
    "- Time: "+e.start+" to "+e.end,
    "- Hunger: "+e.before+"% to "+e.after+"%",
    "- Reason: "+e.reason.replace(/[\r\n]+/g," "),
    "- Observation: "+e.observation,
    "- Hidden intrinsic effect (analysis only): "+(e.trueEffect??"none"),"",
    "Model messages:","~~~json",trace?JSON.stringify(trace.messages,null,2):"No LLM request","~~~","");
  }
  const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"}),url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;
  a.download="nimo-008-"+arm+"-"+new Date().toISOString().replace(/[:.]/g,"-")+".md";
  document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const cells=Array.from({length:81},(_,i)=>({x:i%9,y:Math.floor(i/9)}));
 return <main className="nimo-lab nimo-survival">
  <nav className="lab-nav"><a href="/world/lab/007">Back to Nimo 007</a><span>Independent lab · no production D1</span></nav>
  <header className="lab-header"><p className="lab-eyebrow">NIMO 008 · SURVIVAL PLANNING</p>
   <h1>A world where food cannot be taken for granted</h1>
   <p>Five finite-stock fruit trees, uncertain regrowth, three inventory slots and one drive: hunger.
    Compare a free local planner with an LLM using the same seeded environment.</p></header>
  <section className="survival-compare">
   {(["local","llm"] as const).map(which=>{const w=states[which];return <button key={which}
    className={arm===which?"survival-choice active":"survival-choice"} disabled={busy}
    onClick={()=>setArm(which)}>
    <strong>{which==="local"?"Local planner · free":"LLM planner · API"}</strong>
    <span>{w.events.length} decisions · {w.seconds} simulated seconds</span>
    <b>Hunger {w.hunger}%</b><small>Fruit eaten {w.events.filter(e=>e.action.type==="eat").length}</small>
   </button>})}
  </section>
  <section className="lab-grid">
   <div className="lab-panel"><h2>World — {arm}</h2><div className="survival-map" role="img" aria-label="Nimo and fruit trees in a 9 by 9 world">
    {cells.map(c=>{const t=s.trees.find(t=>t.x===c.x&&t.y===c.y),player=s.x===c.x&&s.y===c.y;
     return <div className={"survival-tile"+(t?" tree":"")+(player?" player":"")}
      title={player?"Nimo":t?t.id+" — "+(t.seenFruit||"uninspected"):"Grass"} key={c.x+"-"+c.y}>
      {player?"N":t?t.seenFruit?t.seenFruit[0].toUpperCase():"T":""}</div>})}
   </div><div className="lab-meter-label"><strong>Hunger</strong><strong>{s.hunger}%</strong></div>
    <div className="lab-meter"><div style={{width:s.hunger+"%",background:s.hunger>80?"#c05f52":"#658e71"}}/></div>
    <p className="lab-muted">Time {s.seconds}s · Position ({s.x+1}, {s.y+1}) · Inventory {s.inventory.length}/3: {s.inventory.join(", ")||"empty"}</p>
   </div>
   <div className="lab-panel"><h2>Run experiment</h2>
    <p className="lab-muted">Both worlds share seed {seed}. Their experience memories remain separate.</p>
    {arm==="llm"&&<><label htmlFor="s008token">Owner token</label>
     <input id="s008token" type="password" value={token} disabled={busy} autoComplete="off"
      onChange={e=>setToken(e.target.value)} placeholder="Required for LLM mode"/>
     <p className="lab-muted">LLM decisions cost API tokens, but waiting or travelling several seconds only takes one call.</p>
     <label htmlFor="s008evidence">Experience used by the LLM</label>
     <select id="s008evidence" value={evidenceMode} disabled={busy||states.llm.events.length>0}
      onChange={e=>setEvidenceMode(e.target.value as EvidenceMode008)}>
      <option value="memory">Learned memory + timestamped observations</option>
      <option value="evaluation">Memory + predicted action outcomes (Nimo 006)</option>
     </select>
     <p className="lab-muted">Both modes learn continuously. The evaluation mode also receives predicted hunger after each action, calculated only from previous evidence.</p></>}
    <label htmlFor="s008rate">Hunger increase per simulated second: {rate} points</label>
    <input id="s008rate" type="range" min="0" max="3" step="0.5" value={rate}
     disabled={busy||states.local.events.length>0||states.llm.events.length>0}
     onChange={e=>setRate(Number(e.target.value))}/>
    <div className="lab-actions survival-buttons">
     <button disabled={busy||(arm==="llm"&&!token)} onClick={()=>void run(1)}>One decision</button>
     <button className="lab-primary" disabled={busy||(arm==="llm"&&!token)}
      onClick={()=>void run(30)}>Run 30 decisions</button>
     <button disabled={!busy} onClick={stop}>Stop</button><button disabled={busy} onClick={reset}>New worlds</button>
     <button disabled={!s.events.length} onClick={exportLog}>Download {arm} log</button>
    </div><p className="lab-muted" role="status">{status}</p>{error&&<p role="alert" className="lab-error">{error}</p>}
    <h3>Manual actions</h3><div className="survival-actions">
     {actions008(s).map(a=><button key={key008(a)} disabled={busy} onClick={()=>manual(a)}>{label(a)}</button>)}
    </div>
   </div>
   <div className="lab-panel"><h2>Knowledge and resources</h2>
    <table className="lab-table"><thead><tr><th>Tree</th><th>Fruit</th><th>Last observed stock</th></tr></thead>
     <tbody>{v.trees.map(t=><tr key={t.id}><td>{t.id}</td><td>{t.fruit||"Unknown"}</td>
      <td>{t.lastSeenStock===null?"Not inspected":t.lastSeenStock+" at "+t.seenAt+"s"}</td></tr>)}</tbody></table>
    <h3>Learned effects</h3><table className="lab-table"><thead><tr><th>Fruit</th><th>Trials</th><th>Estimated effect</th></tr></thead>
     <tbody>{(["amber","blue","red"] as const).map(f=><tr key={f}><td>{f}</td>
      <td>{s.memory[f]?.count??0}</td><td>{s.memory[f]?.mean==null?"Unknown":s.memory[f]?.mean+" points"}</td></tr>)}</tbody></table>
    <p className="lab-muted">Nimo cannot see hidden fruit effects, current stock after leaving a tree, or exact regrowth timers. The LLM receives timestamped observations, so it may develop and revise its own hypotheses about regrowth.</p>
   </div>
   <div className="lab-panel"><h2>Recent decisions</h2>
    {s.events.length===0?<p className="lab-muted">No decisions yet.</p>:<ol className="lab-history">
     {s.events.slice(-16).reverse().map((e:Event008)=><li key={e.step}>
      <strong>{e.step}. {label(e.action)} ({e.start}–{e.end}s)</strong>
      <p>{e.reason}</p><p>{e.observation} Hunger {e.before}% → {e.after}%.</p>
     </li>)}</ol>}
    <p className="lab-muted">The sandbox stays in your browser. Export logs before refreshing or resetting.</p>
   </div>
  </section><footer>No production world, Worker, or D1 modifications.</footer>
 </main>;
}
