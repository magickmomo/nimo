"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorldEvent, WorldState } from "../../lib/world";
import "./world.css";
import IsometricWorld, { type JourneyView } from "./isometric-world";
import WorldInventory from "./world-inventory";
import WorldMessagesPanel from "./world-messages-panel";
import WorldMemoriesPanel from "./world-memories-panel";
import WorldRequestsPanel from "./world-requests-panel";
import WorldProjectsPanel from "./world-projects-panel";
import WorldOraclePanel from "./world-oracle-panel";
import WorldNotesPanel from "./world-notes-panel";
import "./world-artworks.css";
import { groupJournalEvents } from "../../lib/world-journal";

const WORLD_004 = process.env.NEXT_PUBLIC_WORLD_004 === "true";
type ExperimentStatus = {
  start:string;stop:string;enabled:boolean;maxDecisions:number;decisions:number;
  traceCounts:Record<string,number>;
  usage:{calls:number;inputTokens:number;cachedInputTokens:number;outputTokens:number};
  tracesTruncated:boolean;
};

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
type JournalWindow = "1h"|"6h"|"24h"|"all";
type JournalResult={events:WorldEvent[];hasMore:boolean;nextCursor:number|null;until:string;window:JournalWindow};

type Snapshot = {
  offline?:boolean;
  cachedAt?:string;
  objects?: ObjectRecord[];
  actionTrace?: TraceRecord[];
  world: { state: WorldState; next_tick: string };
  events: WorldEvent[];
  documents?: { path: string; content: string; revision: number; updated_at: string }[];
  autonomousEnabled?: boolean;
  scheduledAsleep?:boolean;
  availableTools?: string[];
  hungerRate?:number;
  vending?:{machineId:string;coins:number;inspected:boolean;items:{id:string;label:string;price:number;available:boolean;description:string}[]};
  garden?:{coins:number;inventoryUsed:number;capacity:number;inventory:{id:number;kind:string;water_units:number}[];plots:{id:string;x:number;y:number;stage:string;ready:boolean}[]};
  wildflowers?:{patches:{id:string;x:number;y:number;blooms:number}[];inventory:{id:number;kind:"wildflower"|"flower_seed"}[]};
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
  const [isOwner, setIsOwner] = useState(false);
  const [initialLoading,setInitialLoading]=useState(true);
  const [messagesOpen,setMessagesOpen]=useState(false);
  const [memoriesOpen,setMemoriesOpen]=useState(false);
  const [notesOpen,setNotesOpen]=useState(false);
  const [requestsOpen,setRequestsOpen]=useState(false);
  const [projectsOpen,setProjectsOpen]=useState(false);
  const [oracleOpen,setOracleOpen]=useState(false);
  const [oracleQuota,setOracleQuota]=useState<{remaining:number;limit:number}|null>(null);
  const [sidebarVisible,setSidebarVisible]=useState(true);
  const [mobilePanelOpen,setMobilePanelOpen]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [pendingRequests,setPendingRequests]=useState(0);
  // Stable across the once-per-second clock renders: the dialog must not refocus.
  const closeMessages=useCallback(()=>setMessagesOpen(false),[]);
  const closeMemories=useCallback(()=>setMemoriesOpen(false),[]);
  const closeNotes=useCallback(()=>setNotesOpen(false),[]);
  const closeRequests=useCallback(()=>setRequestsOpen(false),[]);
  const closeProjects=useCallback(()=>setProjectsOpen(false),[]);
  const closeOracle=useCallback(()=>setOracleOpen(false),[]);
  const refreshOracleQuota=useCallback(async()=>{
    if(document.visibilityState!=="visible")return;
    try{
      const response=await fetch("/api/world/oracle/quota",{cache:"no-store"});
      if(!response.ok)throw Error("Quota unavailable");
      const body=await response.json() as {remaining:number;limit:number};
      if(!Number.isFinite(body.remaining)||body.limit!==3)throw Error("Invalid quota");
      setOracleQuota({remaining:Math.max(0,Math.min(3,body.remaining)),limit:3});
    }catch{setOracleQuota(null);}
  },[]);
  useEffect(()=>{
    void refreshOracleQuota();
    const timer=window.setInterval(()=>{void refreshOracleQuota();},5*60_000);
    const onVisible=()=>{if(document.visibilityState==="visible")void refreshOracleQuota();};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);};
  },[refreshOracleQuota]);
  const refreshRequestCount=useCallback(async()=>{
    try{const response=await fetch("/api/world/requests",{cache:"no-store"});
      if(!response.ok)return;
      const data=await response.json() as {pending?:number};
      setPendingRequests(Math.max(0,Number(data.pending)||0));
    }catch{/* Notification is best effort; inbox displays fetch errors. */}
  },[]);
  const [error, setError] = useState("");
  const [settingRate,setSettingRate]=useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportLoginRequired,setExportLoginRequired]=useState(false);
  const [exportToken,setExportToken]=useState("");
  const [exportError,setExportError]=useState("");
  const [archiveDate,setArchiveDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [pendingExportPath,setPendingExportPath]=useState("/api/world/export");
  const [clock, setClock] = useState(Date.now());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [journalWindow,setJournalWindow]=useState<JournalWindow>("1h");
  const [journalEvents,setJournalEvents]=useState<WorldEvent[]>([]);
  const [journalCursor,setJournalCursor]=useState<number|null>(null);
  const [journalUntil,setJournalUntil]=useState<string|null>(null);
  const [journalHasMore,setJournalHasMore]=useState(false);
  const [journalLoading,setJournalLoading]=useState(false);
  const [journalError,setJournalError]=useState("");
  const [experiment,setExperiment]=useState<ExperimentStatus|null>(null);
  const [experimentError,setExperimentError]=useState("");
  const journalRequest=useRef(0);


  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/world", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Cannot load world");
      setData(body);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
    }finally{
      setInitialLoading(false);
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
    // Owner-only controls are merely hidden here; mutation and data APIs
    // independently enforce authentication on the server.
    void fetch("/api/world/session", { cache: "no-store" })
      .then(async response => {
        const body = await response.json() as { authenticated?: boolean };
        setIsOwner(Boolean(body.authenticated));
        if(body.authenticated)void refreshRequestCount();
      }).catch(() => setIsOwner(false))
      .finally(() => { void refresh(); });
    const refreshOwnerSession = () => {
      void fetch("/api/world/session", { cache: "no-store" })
        .then(async response => {
          const body = await response.json() as { authenticated?: boolean };
          setIsOwner(Boolean(body.authenticated));
          if (body.authenticated) void refreshRequestCount();
        }).catch(() => setIsOwner(false));
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        refreshOwnerSession();
        void refresh();
      }
    };
    const refreshOnFocus = () => refreshOwnerSession();
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("focus", refreshOnFocus);
    const liveInterval = window.setInterval(() => { void refreshLive(); }, 10000);
    const requestInterval=window.setInterval(()=>{
      if(document.visibilityState==="visible")void refreshRequestCount();
    },30000);
    const fullInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    // Clock-only updates don't touch Cloudflare at all.
    const clockInterval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("focus", refreshOnFocus);
      window.clearInterval(liveInterval);
      window.clearInterval(fullInterval);
      window.clearInterval(requestInterval);
      window.clearInterval(clockInterval);
    };
  }, [refresh, refreshLive, refreshRequestCount]);

  async function loadJournal(range:JournalWindow,older=false) {
    if(older && (journalLoading || !journalHasMore || journalCursor===null || journalUntil===null))return;
    const requestId=++journalRequest.current;
    setJournalLoading(true);
    setJournalError("");
    const params=new URLSearchParams({window:range});
    if(older&&journalCursor!==null&&journalUntil){
      params.set("before",String(journalCursor));
      params.set("until",journalUntil);
    }
    try{
      const response=await fetch("/api/world/journal?"+params.toString(),{cache:"no-store"});
      const body=await response.json() as Partial<JournalResult>&{error?:string};
      if(!response.ok)throw Error(body.error||"Could not load journal");
      if(requestId!==journalRequest.current)return;
      const entries=body.events??[];
      setJournalEvents(previous=>older?[...previous,...entries.filter(item=>!previous.some(p=>p.id===item.id))]:entries);
      setJournalCursor(body.nextCursor??null);
      setJournalUntil(body.until??null);
      setJournalHasMore(Boolean(body.hasMore));
    }catch(err){
      if(requestId===journalRequest.current)setJournalError(err instanceof Error?err.message:"Could not load journal");
    }finally{
      if(requestId===journalRequest.current)setJournalLoading(false);
    }
  }

  useEffect(()=>{
    // On-demand history is independent of the lightweight dashboard refresh.
    void loadJournal(journalWindow);
    // A new range starts a fresh anchored pagination session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[journalWindow]);

  // World 004: refresh visible journal entries without repeatedly fetching the
  // expensive full snapshot. Older pages remain accessible by cursor.
  useEffect(()=>{
    if(!WORLD_004)return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState==="visible")void loadJournal(journalWindow);
    },20000);
    return()=>window.clearInterval(timer);
    // The loader uses the latest render's range; do not restart for every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[journalWindow]);

  useEffect(()=>{
    if(!WORLD_004 || !isOwner)return;
    let active=true;
    async function poll(){
      if(document.visibilityState!=="visible")return;
      try{
        const response=await fetch("/api/world/experiment",{cache:"no-store"});
        const body=await response.json() as ExperimentStatus & {error?:string};
        if(!response.ok)throw Error(body.error||"Experiment status unavailable");
        if(active){setExperiment(body);setExperimentError("");}
      }catch(error){if(active)setExperimentError(error instanceof Error?error.message:"Experiment status unavailable");}
    }
    void poll();
    const timer=window.setInterval(()=>{void poll();},60000);
    return()=>{active=false;window.clearInterval(timer);};
  },[isOwner]);

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

  async function exportWorld(path="/api/world/export") {
    if(exporting)return;
    setExporting(true);
    setExportError("");
    setPendingExportPath(path);
    try{
      const response=await fetch(path,{cache:"no-store"});
      if(response.status===401){
        setExportLoginRequired(true);
        setExportError("Please sign in once with your owner token to download the world log.");
        return;
      }
      if(!response.ok){
        const body=await response.json().catch(()=>({})) as {error?:string};
        throw Error(body.error||`Export failed (HTTP ${response.status})`);
      }
      const blob=await response.blob();
      if(!blob.size)throw Error("The export returned an empty file.");
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;
      link.download=path.includes("/archive/day?date=")?"nimo-"+archiveDate+".json":(path.includes("/archive/")?"nimo-latest-completed-24h-":"nimo-world-")+new Date().toISOString().replace(/[:.]/g,"-")+".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setExportLoginRequired(false);
    }catch(err){
      setExportError(err instanceof Error?err.message:"World export failed");
    }finally{
      setExporting(false);
    }
  }

  async function signInForExport(event:React.FormEvent) {
    event.preventDefault();
    if(!exportToken.trim()||exporting)return;
    setExporting(true);
    setExportError("");
    try{
      const response=await fetch("/api/world/session",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:exportToken}),
      });
      const body=await response.json() as {error?:string};
      if(!response.ok)throw Error(body.error||"Owner sign-in failed");
      setExportToken("");
      setExportLoginRequired(false);
    }catch(err){
      setExportError(err instanceof Error?err.message:"Owner sign-in failed");
      setExporting(false);
      return;
    }
    setExporting(false);
    // The session cookie is set in the completed sign-in response.
    await exportWorld(pendingExportPath);
  }

  const state = data?.world.state;
  const fruitItems=data?.food?.inventory??[];
  const supplyItems=data?.garden?.inventory??[];
  const flowerItems=data?.wildflowers?.inventory??[];
  const totalInventory=fruitItems.length+supplyItems.length+flowerItems.length;
  const inventoryCapacity=data?.garden?.capacity??data?.food?.capacity??9;
  const coins=data?.garden?.coins??data?.vending?.coins;
  const selectedObject = data?.objects?.find(o=>o.id===selectedObjectId);
  const selectedFood = data?.food?.trees.find(t=>t.id===selectedObjectId);
  // Journal thoughts describe actual selected actions, unlike the technical trace,
  // which is dominated by internal model-decision steps.
  const recentActionToasts = (data?.events ?? [])
    .filter(event => event.kind === "thought" && ["ACT","THINK","OBSERVE","REMEMBER"].includes(event.action ?? ""))
    .slice(0,4)
    .map(event => ({
      id:event.id,started_at:event.created_at,kind:event.action ?? "ACT",
      status:"completed",detail:event.content,result:null,
    }));
  const seconds = data && !data.offline ? Math.max(0, Math.ceil((Date.parse(data.world.next_tick) - clock) / 1000)) : 0;
  const visibleJournal = data?.offline && !journalEvents.length ? (data.events ?? []) : journalEvents;
  const meters = state ? [
    { label: "Fullness", value: 1 - (state.emotions.hunger ?? 0.15), tone: "fullness", inactive:false },
    { label: "Curiosity", value: state.emotions.curiosity ?? 0.35, tone: "curiosity", inactive:false },
  ] : [];
  return (
    <div className="world-page world-dashboard">
      <div className="world-topbar">
        {isOwner && <button type="button" className="world-messages-link" onClick={()=>setMemoriesOpen(true)}>Memories</button>}
        {isOwner && <button type="button" className="world-messages-link" onClick={()=>{setNotesOpen(true);void refresh();}}>Notes</button>}
        {isOwner && <button type="button" className="world-messages-link" onClick={()=>setMessagesOpen(true)}>Messages</button>}
        {isOwner && <button type="button" className="world-messages-link" onClick={()=>setRequestsOpen(true)}>Requests {pendingRequests>0&&<span className="nimo-unread-count" aria-label={pendingRequests+" pending requests"}>{pendingRequests}</span>}</button>}
        <button type="button" className="world-messages-link" onClick={()=>setProjectsOpen(true)}>Projects</button>
         <a className="world-messages-link" href="/artworks">Artworks</a>
        <button type="button" className="world-messages-link" onClick={()=>{void refreshOracleQuota();setOracleOpen(true);}}>Oracle</button>
        {oracleQuota && <span className="world-oracle-quota" title={`Oracle consultations remaining today: ${oracleQuota.remaining} of ${oracleQuota.limit}. Resets at midnight UTC.`} aria-label={`Oracle consultations remaining today: ${oracleQuota.remaining} of ${oracleQuota.limit}`}>{oracleQuota.remaining}/{oracleQuota.limit}</span>}
        <button type="button" className="world-messages-link world-details-toggle" onClick={()=>setDetailsOpen(value=>!value)} aria-expanded={detailsOpen}>Details</button>
        <button type="button" className="world-messages-link world-sidebar-toggle" onClick={()=>setSidebarVisible(value=>!value)} aria-expanded={sidebarVisible}>{sidebarVisible?"Hide journal":"Show journal"}</button>
        <button type="button" className="world-messages-link world-mobile-panel-toggle" onClick={()=>setMobilePanelOpen(value=>!value)} aria-expanded={mobilePanelOpen}>{mobilePanelOpen?"Close journal":"Journal & status"}</button>
      </div>
      {error && <div className="world-warning" role="status">{error}</div>}
      {data?.offline && <div className="world-warning world-offline-warning" role="status">
        <strong>Offline snapshot.</strong> Nimo's database is unavailable. You're viewing his last saved world
        {data.cachedAt ? " from "+new Date(data.cachedAt).toLocaleString() : ""}.
        His position, meters and actions aren't updating. Live updates resume when the database recovers.
      </div>}
      {isOwner && messagesOpen && <WorldMessagesPanel onClose={closeMessages}/>}
      {isOwner && memoriesOpen && <WorldMemoriesPanel onClose={closeMemories}/>}
      {isOwner && notesOpen && <WorldNotesPanel notes={data?.documents} offline={Boolean(data?.offline)} onClose={closeNotes} onRefresh={refresh}/>}
      {isOwner && requestsOpen && <WorldRequestsPanel onClose={closeRequests} onUpdated={refreshRequestCount}/>}
      {projectsOpen && <WorldProjectsPanel onClose={closeProjects}/>}
      {oracleOpen && <WorldOraclePanel onClose={closeOracle}/>}
      {initialLoading && !data ? <section className="world-loading" role="status" aria-live="polite">
        <span className="world-loading-spinner" aria-hidden="true"/>
        <strong>Loading Nimo’s current world…</strong>
        <p className="meta">Fetching his latest position and state.</p>
      </section> : !data ? <section className="world-card" role="status">Unable to load Nimo’s world. <button type="button" onClick={()=>{setInitialLoading(true);void refresh();}}>Retry</button></section> : <div className={`world-layout${sidebarVisible?"":" is-sidebar-collapsed"}`}>
        <div className="world-main">
        {state && <section className="world-status-strip world-floating-meters" aria-label="Nimo's internal state">
              {meters.map((item) => {
                const value = Math.max(0, Math.min(1, Number.isFinite(item.value) ? item.value : 0));
                return (
                  <div className={`world-status-item${item.inactive?" is-inactive":""}`} key={item.label}>
                    <div className="world-status-head">
                      <span className={`world-status-dot ${item.tone}`} aria-hidden="true" />
                      <span className="world-meter-label">{item.label}{item.inactive?" · Paused":""}</span>
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
        </section>}
      <div className="nimo-game-stage">
        <div className="nimo-coin-counter" role="status" aria-label={coins===undefined?"Coin balance unavailable":`Nimo has ${coins} coins`}>
          <span className="nimo-coin-symbol" aria-hidden="true" />
          <span className="nimo-coin-amount">{coins===undefined?"—":coins.toLocaleString()}</span>
          <span className="nimo-coin-label">coins</span>
        </div>
        <WorldInventory fruits={fruitItems} supplies={supplyItems} flowers={flowerItems} capacity={inventoryCapacity}/>
        <IsometricWorld position={data?.position ?? null} visited={data?.environmentMemory?.visited} seenTiles={data?.environmentMemory?.seen} inspected={data?.environmentMemory?.inspected} journey={data?.offline ? undefined : data?.journey} plots={data?.garden?.plots} flowers={data?.wildflowers?.patches} lastRestedAt={data?.world?.state?.lastRestedAt} sleeping={data?.autonomousEnabled===false}
          actionTrace={isOwner ? recentActionToasts : []} showActionToasts={isOwner} selectedObjectId={selectedObjectId} onSelectObject={id=>{setSelectedObjectId(id);setDetailsOpen(true);}} />
      </div>
      {detailsOpen && <aside className="world-detail-drawer" aria-label="World details">
        <div className="world-detail-drawer-heading"><strong>World details</strong><button type="button" onClick={()=>setDetailsOpen(false)}>Close</button></div>
      <details className="world-card world-object-memory world-secondary-panel" open={Boolean(selectedObjectId)} key={selectedObjectId ?? "no-selection"}>
        <summary>Object details {selectedObject ? `· ${selectedObject.label || selectedObject.id}` : "· select an object on the map"}</summary>
        {selectedObject ? <>
          <h3>{selectedObject.label || selectedObject.kind} <small>({selectedObject.x+1}, {selectedObject.y+1})</small></h3>
          <p className="meta">Environment ID: <code>{selectedObject.id}</code> · {selectedObject.inspectionCount} recorded observations</p>
          {selectedObject.id === data?.vending?.machineId && data.vending.inspected && <div className="world-vending-items">
            <p><strong>Machine balance:</strong> {data.vending.coins} coins</p>
            <ul>{data.vending.items.map(item=><li key={item.id}>{item.label} · {item.price} coins · {item.available?"Available":"Coming soon"} · {item.description}</li>)}</ul>
          </div>}
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
      </details>
      {isOwner && <details className="world-card world-secondary-panel world-operator-settings">
        <summary>Diagnostics &amp; controls</summary>
        <p className="meta">Technical history remains in the owner export.</p>
        <div className="world-hunger-rate">
          <label htmlFor="hunger-rate">Fullness decrease (percentage points per second)</label>
          <select id="hunger-rate" value={String(data?.hungerRate??1/60)}
            disabled={settingRate||!data||data.offline} onChange={e=>void changeRate(Number(e.target.value))}>
            <option value={String(1/60)}>1% per minute</option>
            {Array.from({length:26},(_,i)=>i/10).map(rate=><option key={rate} value={String(rate)}>{rate.toFixed(1)}% per second</option>)}
          </select>
        </div>

        <p className="meta">Available tools: {data?.availableTools?.join(", ") || "Checking…"}</p>
        <p className="meta">Decision #{state?.tickCount ?? "—"} · {data?.offline ? "Next decision unavailable while offline" : `Next decision in ${seconds}s`}</p>
      </details>}
      </aside>}
      </div>
      <aside className={`world-sidebar${mobilePanelOpen?" is-mobile-open":""}`} aria-label="World status and journal">
        <div className="world-sidebar-mobile-head"><strong>Nimo\u2019s status & journal</strong><button type="button" onClick={()=>setMobilePanelOpen(false)}>Close</button></div>
      {state && <div className="world-status-meta">
            <div className="world-status-meta-item"><strong>Activity</strong><span>{state.currentActivity}</span></div>
            <div className="world-status-meta-item"><strong>Goal</strong><span>{state.currentGoal || "Not yet formed"}</span></div>
            <div className="world-status-meta-item"><strong>Status</strong>
              <span>{data?.offline ? "Offline" : data?.autonomousEnabled === false ? "Sleeping" : "Awake"} · Decision #{state.tickCount}</span>
            </div>
      </div>}

      {WORLD_004 && isOwner && <section className="world-card" aria-label="World 004 experiment diagnostics">
        <h2>World 004 experiment</h2>
        {experiment ? <>
          <p><strong>{experiment.decisions} / {experiment.maxDecisions} decisions</strong> · {new Date(experiment.start).toLocaleString()}–{new Date(experiment.stop).toLocaleTimeString()}</p>
          <p className="meta">Model calls: {experiment.usage.calls} · Input: {experiment.usage.inputTokens.toLocaleString()} tokens · Output: {experiment.usage.outputTokens.toLocaleString()} tokens · Failed traces: {Object.entries(experiment.traceCounts).filter(([name])=>name.endsWith(":failed")).reduce((total,[,count])=>total+count,0)}{experiment.tracesTruncated?" (trace summary truncated)":""}</p>
          <button type="button" disabled={exporting} onClick={()=>void exportWorld("/api/world/experiment/export")}>Download experiment JSON</button>
        </> : <p className="meta">Loading experiment status…</p>}
        {experimentError && <p role="alert" className="world-warning">{experimentError}</p>}
      </section>}
      <section className="world-card world-journal">
        <div className="world-journal-head">
          <h2>Journal</h2>
          <div className="world-journal-controls">
            <div className="world-journal-filter">
              <label htmlFor="world-journal-window">History</label>
              <select id="world-journal-window" value={journalWindow} onChange={event=>setJournalWindow(event.target.value as JournalWindow)}>
                <option value="1h">Last hour</option><option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option><option value="all">All history</option>
              </select>
            </div>
            <div className="world-journal-buttons">
              <button type="button" disabled={journalLoading} onClick={()=>{void refresh();void loadJournal(journalWindow);}}>Refresh</button>
              {isOwner && <button type="button" title="Export complete world log" disabled={exporting} onClick={()=>void exportWorld()}>{exporting ? "Exporting…" : "Export log"}</button>}
              {isOwner && <label htmlFor="world-archive-date">Archive date
                <input id="world-archive-date" type="date" value={archiveDate}
                  max={new Date().toISOString().slice(0,10)}
                  onChange={event=>setArchiveDate(event.target.value)} />
              </label>}
              {isOwner && <button type="button" title="Download selected UK calendar day, recovering from D1 if the archive is missing" disabled={exporting||!archiveDate}
                onClick={()=>void exportWorld("/api/world/archive/day?date="+encodeURIComponent(archiveDate))}>
                {exporting ? "Downloading…" : "Download day"}
              </button>}
            </div>
          </div>
        </div>
        <p className="meta">Browse historic journal entries by time, then load older pages as needed. Private messages stay in Messages; creator requests are in Requests. The complete export requires owner access.</p>
        {exportError&&<p className="world-warning" role="alert">{exportError}</p>}
        {isOwner && exportLoginRequired&&<form className="world-journal-export-login" onSubmit={event=>void signInForExport(event)}>
          <label htmlFor="world-export-token">Owner access token</label>
          <input id="world-export-token" type="password" value={exportToken}
            autoComplete="off" onChange={event=>setExportToken(event.target.value)}
            placeholder="Enter your token once" required />
          <button disabled={!exportToken.trim()||exporting} type="submit">{exporting?"Signing in…":"Sign in and export"}</button>
        </form>}
        {journalError&&!data?.offline&&<p className="world-warning" role="alert">{journalError}</p>}
        {data?.offline&&<p className="meta">Showing journal entries saved with the offline snapshot. Date-range filtering and older pages require D1.</p>}
        {visibleJournal.length ? groupJournalEvents(visibleJournal).map(event => (
          <article key={event.id} className="world-event">
            <div><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span>{event.label}</span></div>
            {event.movement && (
              <p className="world-event-route"><strong>From:</strong> {event.movement.from} <span aria-hidden="true">→</span> <strong>To:</strong> {event.movement.to}</p>
            )}
            {event.narration && <p className="world-event-narration"><strong>Nimo:</strong> {event.narration}</p>}
            {event.outcome && <p className="world-event-result"><strong>{event.narration ? "Result:" : "Event:"}</strong> {event.outcome}</p>}
          </article>
        )) : <p className="meta">{journalLoading?"Loading journal…":"No journal events in this time range."}</p>}
        {journalHasMore&&!data?.offline&&<button type="button" className="world-journal-more" disabled={journalLoading}
          onClick={()=>void loadJournal(journalWindow,true)}>{journalLoading?"Loading…":"Load earlier events"}</button>}
      </section>
      </aside>
      </div>}
    </div>
  );
}
