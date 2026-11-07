"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorldEvent, WorldState } from "../../lib/world";
import "./world.css";
import IsometricWorld, { type JourneyView } from "./isometric-world";
import { groupJournalEvents } from "../../lib/world-journal";

type ObjectRecord = {
  id:string;kind:string;x:number;y:number;label:string;note:string;
  inspectionCount:number;latestComparison:string|null;
  observations:{id:number;at:string;comparison:string;changedProperties:string[];
    properties:{appearance?:string;blocksMovement?:boolean}}[];
};
type TraceRecord = {
  id:number;started_at:string;finished_at:string|null;kind:string;
  status:string;detail:string;result:string|null;
};
type Snapshot = {
  objects?: ObjectRecord[];
  actionTrace?: TraceRecord[];
  world: { state: WorldState; next_tick: string };
  events: WorldEvent[];
  documents?: { path: string; content: string; revision: number; updated_at: string }[];
  autonomousEnabled?: boolean;
  availableTools?: string[];
  hungerRate?:number;
  food?:{trees:{id:string;seen_fruit:string|null;last_seen_stock:number|null;last_inspected_at:string|null}[];inventory:{id:number;fruit:"amber"|"blue"|"red"}[];capacity:number;knowledge:{fruit:string;count:number;mean:number|null;minimum_relief:number}[]};
  position?: { x: number; y: number };
  journey?: JourneyView;
  environmentMemory?: {
    visited: { x: number; y: number; visit_count: number }[];
    seen: { x: number; y: number }[];
    inspected: { x: number; y: number; kind: string; description: string; inspection_count: number }[];
  };
};

export default function World() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [settingRate,setSettingRate]=useState(false);
  const [exporting, setExporting] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/world", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Cannot load world");
      setData(body);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
    }
  }, []);

  // Historical state changes far less often than the clock and position.
  // Keep the live display responsive with a tiny endpoint, not a full D1
  // history scan every two seconds. Invisible tabs never poll D1.
  const refreshLive = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/world/live", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Cannot refresh live world");
      setData(previous => previous ? { ...previous, ...body } : previous);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
    }
  }, []);

  useEffect(() => {
    if (document.visibilityState === "visible") void refresh();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    const liveInterval = window.setInterval(() => { void refreshLive(); }, 10000);
    const fullInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    // Clock-only updates don't touch Cloudflare at all.
    const clockInterval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.clearInterval(liveInterval);
      window.clearInterval(fullInterval);
      window.clearInterval(clockInterval);
    };
  }, [refresh, refreshLive]);

  async function changeRate(value:number) {
    if(settingRate)return;
    setSettingRate(true);
    try{
      const response=await fetch("/api/world/hunger-rate",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({rate:value}),
      });
      const body=await response.json() as {hungerRate?:number;error?:string};
      if(!response.ok)throw Error(body.error||"Could not update hunger rate");
      setData(old=>old?{...old,hungerRate:body.hungerRate}:old);
      setError("");
    }catch(err){setError(err instanceof Error?err.message:"Unable to update hunger rate");}
    finally{setSettingRate(false);}
  }

  async function exportWorld() {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const response=await fetch("/api/world/export",{
        cache:"no-store",
      });
      if(!response.ok) {
        const body=await response.json() as {error?:string};
        throw new Error(body.error || "Could not export world history");
      }
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;
      link.download="nimo-world-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }catch(err) {
      setError(err instanceof Error?err.message:"World export failed");
    }finally {
      setExporting(false);
    }
  }

  const state = data?.world.state;
  const selectedObject = data?.objects?.find(o=>o.id===selectedObjectId);
  const selectedFood = data?.food?.trees.find(t=>t.id===selectedObjectId);
  const recentActions = data?.actionTrace ?? [];
  const runningActions = recentActions.filter(a=>a.status==="running" && (
    (a.kind==="travel" && (data?.journey?.status==="travelling" || data?.journey?.status==="paused")) ||
    (clock-Date.parse(a.started_at)<90000)
  ));
  const seconds = data ? Math.max(0, Math.ceil((Date.parse(data.world.next_tick) - clock) / 1000)) : 0;
  const meters = state ? [
    { label: "Tiredness", value: 1 - state.emotions.energy, tone: "tiredness", inactive:true },
    { label: "Hunger", value: state.emotions.hunger ?? 0.15, tone: "hunger", inactive:false },
    { label: "Happiness", value: state.emotions.happiness, tone: "happiness", inactive:true },
    { label: "Boredom", value: state.emotions.boredom, tone: "boredom", inactive:true },
  ] : [];
  return (
    <div className="world-page world-dashboard">
      <div className="world-topbar">
        <a className="world-messages-link" href="/world/messages">Messages</a>
        <a className="world-settings-link" href="/world/settings">Settings — Sleep / Wake</a>
      </div>
      {error && <div className="world-warning" role="status">{error}</div>}
      <div className="world-layout">
        <div className="world-main">
      {state && (
        <>
          <section className="world-status-strip" aria-label="Nimo's internal state">
            {meters.map((item) => {
              const value = Math.max(0, Math.min(1, Number.isFinite(item.value) ? item.value : 0));
              return (
                <div className={`world-status-item${item.inactive?" is-inactive":""}`} key={item.label}>
                  <div className="world-status-head">
                    <span className={`world-status-dot ${item.tone}`} aria-hidden="true" />
                    <span>{item.label}{item.inactive?" · Paused":""}</span>
                    <span className="world-status-percent">{Math.round(value * 100)}%</span>
                  </div>
                  <div className="world-status-bar" role="progressbar"
                    aria-label={item.label} aria-valuenow={Math.round(value * 100)}
                    aria-valuemin={0} aria-valuemax={100}>
                    <div className={`world-status-fill ${item.tone}`}
                      style={{ width: `${value * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
          <div className="world-status-meta">
            <div className="world-status-meta-item"><strong>Activity</strong><span>{state.currentActivity}</span></div>
            <div className="world-status-meta-item"><strong>Goal</strong><span>{state.currentGoal || "Not yet formed"}</span></div>
            <div className="world-status-meta-item"><strong>Status</strong>
              <span>{data?.autonomousEnabled === false ? "Sleeping" : "Awake"} · Decision #{state.tickCount}</span>
            </div>
            <div className="world-status-meta-item"><strong>Tools</strong>
              <span>{data?.availableTools ? (data.availableTools.length ? data.availableTools.join(", ") : "None available") : "Checking environment…"}</span>
            </div>
          </div>
        </>
      )}
      <section className="world-card world-food-controls" aria-label="Survival and inventory">
        <div className="world-journal-head"><h2>Survival</h2><span className="meta">Hunger only · other needs paused</span></div>
        <div className="world-hunger-rate">
          <label htmlFor="hunger-rate">Hunger growth (percentage points per second)</label>
          <select id="hunger-rate" value={(data?.hungerRate??0.1).toFixed(1)}
            disabled={settingRate||!data} onChange={e=>void changeRate(Number(e.target.value))}>
            {Array.from({length:26},(_,i)=>i/10).map(rate=><option key={rate} value={rate.toFixed(1)}>{rate.toFixed(1)}</option>)}
          </select>
        </div>
        <div className="world-inventory"><strong>Inventory ({data?.food?.inventory.length??0}/{data?.food?.capacity??3})</strong>
          <div className="world-fruits">
            {data?.food?.inventory.length?data.food.inventory.map(item=><span className={"world-fruit "+item.fruit} key={item.id}>{item.fruit}</span>):
              <span className="meta">Nothing collected yet</span>}
          </div>
        </div>
        <p className="meta">Fruit effects must be learned by eating. Trees regenerate gradually, and Nimo can carry three fruit.</p>
        {!!data?.food?.knowledge.length&&<div className="world-food-knowledge">
          <strong>Learned food effects</strong>
          <ul>{data.food.knowledge.map(entry=><li key={entry.fruit}>
            <span className={"world-fruit "+entry.fruit}>{entry.fruit}</span>
            <span>{entry.mean===null?"Not yet measured clearly":`Average observed change: ${entry.mean>0?"+":""}${entry.mean}%`}</span>
            <small>{entry.count} eaten · {entry.minimum_relief}% minimum observed relief</small>
          </li>)}</ul>
        </div>}
      </section>
      <IsometricWorld position={data?.position ?? null} visited={data?.environmentMemory?.visited} seenTiles={data?.environmentMemory?.seen} inspected={data?.environmentMemory?.inspected} journey={data?.journey}
        selectedObjectId={selectedObjectId} onSelectObject={setSelectedObjectId} />
      <section className="world-card world-action-monitor" aria-label="Live execution monitor">
        <div className="world-journal-head">
          <h2>Active actions</h2>
          <span className="meta">Worker execution · separate from journal</span>
        </div>
        <p className="meta">Actual operations, recorded by the Worker. “Decide” means an LLM request; perception, lookup and comparison are code, not LLM thoughts.</p>
        <div className="world-action-current">
          <strong>{data?.autonomousEnabled===false?"Sleeping":data?.journey?.status==="paused"?"Journey paused":runningActions.length?runningActions[0].detail:"Idle / between actions"}</strong>
          <span>{data?.journey?.status==="travelling"?"Walking along a persisted route":runningActions.length?runningActions[0].kind:"No operation running right now"}</span>
        </div>
        <details className="world-action-details" open>
          <summary>Recent operations ({recentActions.length})</summary>
          <ol className="world-action-list">
            {recentActions.slice(0,10).map(action=>(
              <li key={action.id}>
                <div className="world-action-line">
                  <span className="world-action-kind">{action.kind}</span>
                  <span>{action.status==="running" && !runningActions.some(item=>item.id===action.id) ? "stale / interrupted" : action.status}</span>
                  <time dateTime={action.started_at}>{new Date(action.started_at).toLocaleTimeString()}</time>
                </div>
                <div>{action.detail}</div>
                {action.result && <small>{action.result}</small>}
              </li>
            ))}
          </ol>
          {!recentActions.length && <p className="meta">No operations recorded yet.</p>}
        </details>
      </section>
      <section className="world-card world-object-memory">
        <div className="world-journal-head">
          <h2>Object memory</h2>
          <span className="meta">Select a tree, rock or shrub in the map</span>
        </div>
        {selectedObject ? <>
          <h3>{selectedObject.label || selectedObject.kind} <small>({selectedObject.x+1}, {selectedObject.y+1})</small></h3>
          <p className="meta">Environment ID: <code>{selectedObject.id}</code> · {selectedObject.inspectionCount} recorded observations</p>
          {selectedFood&&<p><strong>Last observed fruit:</strong> {selectedFood.seen_fruit??"Not inspected since fruit was introduced"}
            {selectedFood.seen_fruit&&` · ${selectedFood.last_seen_stock??"?"} fruit last seen`}
            {selectedFood.last_inspected_at&&<small> (observed {new Date(selectedFood.last_inspected_at).toLocaleString()}; stock may have changed)</small>}
          </p>}
          <p><strong>Nimo's label:</strong> {selectedObject.label || "Not named yet"}</p>
          <p><strong>Nimo's note:</strong> {selectedObject.note || "No personal note yet"}</p>
          <p><strong>Last comparison:</strong> {selectedObject.latestComparison || "No post-migration inspection yet"}</p>
          {selectedObject.observations.length ? <ol className="world-observation-list">
            {selectedObject.observations.slice(0,15).map(observation=>(
              <li key={observation.id}>
                <time dateTime={observation.at}>{new Date(observation.at).toLocaleString()}</time>
                <strong>{observation.comparison}</strong>
                {observation.changedProperties.length>0 && <span>Changed: {observation.changedProperties.join(", ")}</span>}
                <p>{observation.properties.appearance}</p>
              </li>
            ))}
          </ol> : <p className="meta">Nimo has not recorded a structured inspection of this object yet.</p>}
          <p className="meta">Environment properties are verified; labels and notes are Nimo's own interpretation.</p>
        </> : <p className="meta">Click an object in Nimo's world to see his saved observations, labels and notes.</p>}
      </section>
      <section className="world-card world-workspace">
        <div className="world-journal-head">
          <h2>Workspace</h2>
          <span className="meta">{data?.documents?.length ?? 0} / 12 documents</span>
        </div>
        <p className="meta">Files Nimo actually saved using his write tool. Documents are readable by anyone who can access this World page.</p>
        {data?.documents?.length ? (
          <>
            <div className="world-file-list">
              {data.documents.map(file => (
                <button key={file.path} type="button"
                  aria-pressed={selectedDocument === file.path}
                  onClick={() => setSelectedDocument(prev => prev === file.path ? null : file.path)}>
                  {file.path} <small>v{file.revision}</small>
                </button>
              ))}
            </div>
            {data.documents.filter(file => file.path === selectedDocument).map(file => (
              <div key={file.path} className="world-file-view">
                <div className="world-file-caption">{file.path} · revision {file.revision}</div>
                <pre>{file.content}</pre>
              </div>
            ))}
          </>
        ) : <p className="meta">No documents yet. Nimo can create text files when awake.</p>}
      </section>
      <div className="world-grid">
        <section className="world-card">
          <h2>Core beliefs</h2>
          {state?.beliefs.length ? (
            <ul className="world-beliefs">{state.beliefs.map((b,i) =>
              <li key={i}><strong>{b.text}</strong><small>Confidence {Math.round(b.confidence * 100)}% · Evidence: {b.evidence}</small></li>
            )}</ul>
          ) : <p className="meta">No beliefs formed from experience yet. The initial identity is deliberately minimal.</p>}
        </section>
      </div>
        </div>
      <section className="world-card world-journal">
        <div className="world-journal-head"><h2>Journal</h2><div className="world-journal-controls"><button type="button" onClick={()=>void refresh()}>Refresh</button><button type="button" disabled={exporting} onClick={()=>void exportWorld()}>{exporting ? "Exporting…" : "Export complete log"}</button></div></div>
        <p className="meta">Download the persisted journal, actions, rewards, object observations, workspace and world state as JSON. Sign in under Settings to export the full history.</p>
        {data?.events.length ? groupJournalEvents(data.events.filter(event=>event.kind!=="visitor"&&event.kind!=="reply"&&event.kind!=="request"&&event.action!=="REQUEST")).map(event => (
          <article key={event.id} className="world-event">
            <div><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span>{event.label}</span></div>
            {event.movement && (
              <p className="world-event-route"><strong>From:</strong> {event.movement.from} <span aria-hidden="true">→</span> <strong>To:</strong> {event.movement.to}</p>
            )}
            {event.narration && <p className="world-event-narration"><strong>Nimo:</strong> {event.narration}</p>}
            {event.outcome && <p className="world-event-result"><strong>{event.narration ? "Result:" : "Event:"}</strong> {event.outcome}</p>}
          </article>
        )) : <p className="meta">Nothing has happened yet.</p>}
      </section>
      </div>
    </div>
  );
}
