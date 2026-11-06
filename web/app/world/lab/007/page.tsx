"use client";

import {useRef,useState} from "react";
import {
  SIZE007,FRUITS007,effects007,initial007,actions007,view007,
  localDecision007,apply007,key007,type Action007,type State007,type Event007,
} from "../../../../lib/hunger-world-007";
import "../lab.css";
import "./hunger.css";

type Trace007={step:number;modelMessages:{role:string;content:string}[]};
const actionText=(a:Action007)=>a.type==="move"?"Move "+a.direction:
  a.type==="inspect"?"Inspect "+a.treeId:a.type==="pick"?"Pick from "+a.treeId:
  a.type==="eat"?"Eat carried fruit":a.type==="discard"?"Discard carried fruit":"Wait";
const delay=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{
  if(signal.aborted){resolve();return;}
  const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};
  const timer=window.setTimeout(done,ms);
  signal.addEventListener("abort",done,{once:true});
});

export default function Nimo007(){
  const [seed,setSeed]=useState(48162);
  const [world,setWorld]=useState<State007>(initial007);
  const latest=useRef<State007>(world);
  const traceRef=useRef<Trace007[]>([]);
  const [rate,setRate]=useState(2);
  const [mode,setMode]=useState<"local"|"llm">("local");
  const [token,setToken]=useState("");
  const [running,setRunning]=useState(false);
  const busy=useRef(false);
  const controller=useRef<AbortController|null>(null);
  const [status,setStatus]=useState("Ready — choose an action or run the agent.");
  const [error,setError]=useState("");
  const actions=actions007(world);
  function save(next:State007){latest.current=next;setWorld(next);}
  function reset(){
    if(busy.current)return;
    const nextSeed=Math.floor(Math.random()*1_000_000);
    setSeed(nextSeed);save(initial007());traceRef.current=[];
    setStatus("New world. Nimo has no fruit-effect knowledge.");setError("");
  }
  function stop(){controller.current?.abort();setStatus("Stopping after current decision.");}
  async function decide(s:State007,signal:AbortSignal):Promise<{
    action:Action007;reason:string;messages?:Trace007["modelMessages"]}>{
    if(mode==="local")return localDecision007(s,rate);
    const context=view007(s);
    const response=await fetch("/api/world/lab/007/decide",{
      method:"POST",headers:{"Content-Type":"application/json","x-lab-owner-token":token},
      body:JSON.stringify({view:context,rate}),signal,
    });
    const reply=await response.json() as {action?:Action007;reason?:string;error?:string;
      modelMessages?:Trace007["modelMessages"]};
    if(!response.ok||!reply.action||typeof reply.reason!=="string")
      throw Error(reply.error||"Model did not return a decision.");
    if(!actions007(s).some(a=>key007(a)===key007(reply.action!)))throw Error("Model returned unavailable action");
    if(!Array.isArray(reply.modelMessages))throw Error("Model trace missing");
    return {action:reply.action,reason:reply.reason,messages:reply.modelMessages};
  }
  function commit(s:State007,action:Action007,reason:string,source:Event007["source"],
    messages?:Trace007["modelMessages"]){
    const next=apply007(s,action,effects007(seed),rate,source,reason);
    save(next);
    if(messages){
      traceRef.current=[...traceRef.current,{step:next.step,modelMessages:messages}];
    }
    setStatus("Step "+next.step+": "+next.events[next.events.length-1].result);
    return next;
  }
  async function run(single=false){
    if(busy.current||(mode==="llm"&&!token.trim()))return;
    busy.current=true;setRunning(true);setError("");
    const ctrl=new AbortController();controller.current=ctrl;
    let state=latest.current;
    try{
      const limit=single?1:100;
      for(let i=0;i<limit&&!ctrl.signal.aborted;i++){
        if(document.visibilityState==="hidden"){
          setStatus("Paused: browser tab is hidden. Nothing runs in the background.");
          break;
        }
        const decision=await decide(state,ctrl.signal);
        if(ctrl.signal.aborted)break;
        state=commit(state,decision.action,decision.reason,mode,decision.messages);
        if(!single&&i<limit-1)await delay(1000,ctrl.signal);
      }
      if(!ctrl.signal.aborted&&state.step>=1&&single)setStatus("Step "+state.step+" complete.");
      else if(!ctrl.signal.aborted&&document.visibilityState==="visible")
        setStatus("Run complete. Continue or export the log.");
    }catch(e){
      if(!ctrl.signal.aborted){setError(e instanceof Error?e.message:"Decision failed");
        setStatus("Stopped after an error; history is preserved.");}
    }finally{busy.current=false;controller.current=null;setRunning(false);}
  }
  function manual(action:Action007){
    if(busy.current)return;
    try{commit(latest.current,action,"Manual action","manual");setError("");}
    catch(e){setError(e instanceof Error?e.message:"Invalid action");}
  }
  function exportLog(){
    const s=latest.current,lines=[
      "# Nimo 007 — Hunger World sandbox log","",
      "- Generated: "+new Date().toISOString(),
      "- World seed: "+seed,
      "- Simulated seconds: "+s.seconds,
      "- Hunger gained per simulated second: "+rate+" percentage points",
      "- Actions: "+s.step,
      "- Live mode: "+mode,
      "- All data is browser-local; no production database.",
      "","## Hidden fruit effects (revealed for analysis only)","",
    ];
    const effects=effects007(seed);
    for(const fruit of FRUITS007)lines.push("- "+fruit+": "+effects[fruit]+" hunger points");
    lines.push("","## Learned outcomes","");
    for(const fruit of FRUITS007){
      const l=s.learning[fruit];
      lines.push("- "+fruit+": "+(l?JSON.stringify(l):"unknown"));
    }
    lines.push("","## Decisions","");
    for(const e of s.events){
      const modelTrace=traceRef.current.find(t=>t.step===e.step);
      lines.push("### Step "+e.step+" — "+actionText(e.action),"",
        "- Source: "+e.source,
        "- Reason: "+e.reason.replace(/[\r\n]+/g," "),
        "- Hunger: "+e.before+"% to "+e.after+"%",
        "- True fruit effect (hidden from Nimo): "+(e.effect===null?"none":e.effect+" points"),
        "- Outcome: "+e.result,"",
        "Exact model messages (only for LLM decisions):","",
        "~~~json",modelTrace?JSON.stringify(modelTrace.modelMessages,null,2):
          "No LLM request for this decision.","~~~","");
    }
    const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download="nimo-007-"+new Date().toISOString().replace(/[:.]/g,"-")+".md";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const squares=Array.from({length:SIZE007*SIZE007},(_,i)=>({x:i%SIZE007,y:Math.floor(i/SIZE007)}));
  return <main className="nimo-lab nimo-hunger-lab">
    <nav className="lab-nav"><a href="/world/lab/006">Previous lab · 006</a>
      <span>Sandbox 007 · no D1, no live world writes</span></nav>
    <header className="lab-header">
      <p className="lab-eyebrow">NIMO 007 · HUNGER WORLD</p>
      <h1>A small world with one need: hunger</h1>
      <p>Nimo can walk, inspect fruit-bearing trees, pick one fruit at a time and eat.
        Fruit effects are hidden until experienced. His only drive is to keep hunger low.</p>
    </header>
    <section className="lab-grid">
      <div className="lab-panel">
        <h2>Living world</h2>
        <div className="hunger-world-map" role="img" aria-label="Nine by nine grid with Nimo and five fruit trees">
          {squares.map(cell=>{
            const player=cell.x===world.x&&cell.y===world.y;
            const t=world.trees.find(tree=>tree.x===cell.x&&tree.y===cell.y);
            const examined=t&&world.inspected.includes(t.id);
            return <div className={"hunger-tile"+(player?" hunger-player":"")+(t?" hunger-tree":"")}
                key={cell.x+"-"+cell.y}
                title={player?"Nimo":t?t.id+(examined?" · "+t.fruit:" · uninspected"):"Grass"}>
              {player?<span>N</span>:t?<span>{examined?t.fruit.charAt(0).toUpperCase():"T"}</span>:null}
              {t&&t.readyAt>world.seconds&&<span className="hunger-not-ready">·</span>}
            </div>;
          })}
        </div>
        <p className="lab-muted">N = Nimo; T = uninspected tree; letters identify fruit after inspection. Dimmed dot means fruit regrowing. Trees cannot be walked through.</p>
        <div className="lab-meter-label"><strong>Hunger</strong><strong>{world.hunger}%</strong></div>
        <div className="lab-meter"><div style={{width:world.hunger+"%",background:world.hunger>=80?"#c45c52":"#85a46d"}}/></div>
        <p className="lab-muted">Simulated seconds: {world.seconds} · Position: ({world.x+1}, {world.y+1}) · Carrying: {world.inventory||"nothing"}</p>
        <p className="lab-muted">The simulation advances by one second per action, not continuously while paused. This is a deliberately accelerated hunger model. The local agent now saves fruit until it is useful and can wait near a regrowing tree instead of constantly crossing the map.</p>
      </div>
      <div className="lab-panel">
        <h2>Nimo's controls</h2>
        <div className="hunger-control-row">
          <label htmlFor="hunger-mode">Decision maker</label>
          <select id="hunger-mode" disabled={running} value={mode}
            onChange={e=>setMode(e.target.value as "local"|"llm")}>
            <option value="local">Local learning policy · free</option>
            <option value="llm">LLM decides · OpenAI API</option>
          </select>
        </div>
        {mode==="llm"&&<>
          <label htmlFor="hunger-token">Owner token</label>
          <input id="hunger-token" type="password" value={token} disabled={running}
            placeholder="Required for LLM mode" autoComplete="off"
            onChange={e=>setToken(e.target.value)}/>
          <p className="lab-muted">LLM mode makes a potentially billable model call for every action. Up to 100 calls per run. No D1 calls.</p>
        </>}
        <label htmlFor="hunger-rate">Hunger increase per simulated second: {rate} points</label>
        <input id="hunger-rate" type="range" min="0" max="5" step="0.5"
          disabled={running} value={rate} onChange={e=>setRate(Number(e.target.value))}/>
        <div className="lab-actions hunger-button-row">
          <button disabled={running||(mode==="llm"&&!token)} onClick={()=>void run(true)}>One decision</button>
          <button className="lab-primary" disabled={running||(mode==="llm"&&!token)} onClick={()=>void run(false)}>Run up to 100 decisions</button>
          <button disabled={!running} onClick={stop}>Stop</button>
          <button disabled={running} onClick={reset}>New random world</button>
          <button disabled={!world.step} onClick={exportLog}>Export Markdown log</button>
        </div>
        <p role="status" className="lab-muted">{status}</p>
        {error&&<p role="alert" className="lab-error">{error}</p>}
        <h3>Manual actions</h3>
        <div className="hunger-actions">
          {actions.map(action=><button key={key007(action)} disabled={running}
            onClick={()=>manual(action)}>{actionText(action)}</button>)}
        </div>
      </div>
      <div className="lab-panel">
        <h2>Experience memory</h2>
        <p className="lab-muted">The environment applies the fruit effects. Nimo's learned estimates update only after eating. Unknown remains unknown.</p>
        <table className="lab-table">
          <thead><tr><th>Fruit</th><th>Eaten</th><th>Learned effect</th><th>Confidence data</th></tr></thead>
          <tbody>{FRUITS007.map(f=>{
            const learning=world.learning[f];
            return <tr key={f}><td>{f}</td><td>{learning?.count??0}</td>
              <td>{learning?.mean===null||learning?.mean===undefined?"Unknown":learning.mean+" points"}</td>
              <td>{learning?learning.uncensored+" uncensored":"None"}</td></tr>;
          })}</tbody>
        </table>
        <p className="lab-muted">An eating observation at the 0% or 100% boundary is censored; it does not overwrite an established uncensored average.</p>
        <h3>Trees Nimo has identified</h3>
        {world.trees.map(t=><p key={t.id} className="hunger-tree-line">{t.id} ·
          {world.inspected.includes(t.id)?" "+t.fruit+" fruit":" not inspected"} ·
          {t.readyAt<=world.seconds?" fruit available":" regrows at second "+t.readyAt}</p>)}
      </div>
      <div className="lab-panel">
        <h2>Recent actions</h2>
        {world.events.length===0?<p className="lab-muted">Nimo hasn't acted yet.</p>:
          <ol className="lab-history">{world.events.slice(-14).reverse().map(event=>
            <li key={event.step}><strong>{event.step}. {actionText(event.action)}</strong>
              <p>{event.reason}</p>
              <p>{event.result} Hunger {event.before}% → {event.after}%.</p></li>)}</ol>}
        <p className="lab-muted">Run results are stored only in this browser tab. Download before refreshing if you'd like to analyse them later.</p>
      </div>
    </section>
    <footer>Separate from original Nimo. No Cloudflare Worker, D1, journal or reward records are changed.</footer>
  </main>;
}
