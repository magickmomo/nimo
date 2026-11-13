"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Evidence={id:number;created_at:string;kind:string;action:string|null;content:string};
type Memory={id:number;statement:string;category:string;subject:string;confidence:number;status:string;updated_at:string;evidence_count:number;evidence:Evidence[]};
export default function WorldMemoriesPanel({onClose}:{onClose:()=>void}) {
 const root=useRef<HTMLElement>(null);
 const [memories,setMemories]=useState<Memory[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshing,setRefreshing]=useState(false);
 const [refreshed,setRefreshed]=useState(false);
 const feedbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const load=useCallback(async(manual=false)=>{
  if(manual){
   if(feedbackTimer.current)clearTimeout(feedbackTimer.current);
   setRefreshed(false);setRefreshing(true);
  }
  let succeeded=false;
  try{const res=await fetch("/api/world/memories",{cache:"no-store"});
   const data=await res.json() as {memories?:Memory[];error?:string};
   if(!res.ok)throw Error(data.error||"Memory load failed");
   setMemories(data.memories??[]);setError("");succeeded=true;
  }catch(e){setError(e instanceof Error?e.message:"Memory load failed");}
  finally{
   setLoading(false);
   if(manual){
    setRefreshing(false);
    if(succeeded){setRefreshed(true);feedbackTimer.current=setTimeout(()=>setRefreshed(false),1800);}
   }
  }
 },[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  void load();root.current?.focus();
  const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();
   if(e.key!=="Tab")return;
   const elements=root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),summary,[tabindex]:not([tabindex="-1"])');
   if(!elements?.length)return;
   const first=elements[0],last=elements[elements.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  };
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("keydown",onKey);if(feedbackTimer.current)clearTimeout(feedbackTimer.current);previous?.focus();}
 },[load,onClose]);
 return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nimo's consolidated memories" className="world-card world-messages-panel world-memories-panel">
   <div className="world-journal-head"><h2>Consolidated memories ({memories.length}/24)</h2>
    <div className="world-message-header-actions"><button type="button" onClick={()=>void load(true)} disabled={refreshing} aria-busy={refreshing}><span className="world-refresh-label">{refreshing&&<span className="world-refresh-spinner" aria-hidden="true"/>}{refreshing?"Refreshing…":refreshed?"Updated":"Refresh"}</span></button><button type="button" onClick={onClose}>Close</button></div>
   </div>
   <p className="meta">Evidence-backed experiences, discoveries and knowledge. Food lessons live here too. Only current memories are shown.</p>
   {error&&<p role="alert" className="world-warning">{error}</p>}
   <div className="world-message-thread">
    {loading?<p>Loading memories…</p>:memories.length===0?<p className="meta">No consolidated memories yet. Verified discoveries will appear as Nimo learns.</p>:
     memories.map(m=><article className="world-memory-entry" key={m.id}>
      <div className="world-memory-meta"><strong>{m.category}</strong><span>{m.status} · confidence {Math.round(m.confidence*100)}%</span></div>
      <p>{m.statement}</p>
      <details><summary>Evidence ({m.evidence_count})</summary>
       {m.evidence.length?m.evidence.map(e=><p key={e.id} className="world-memory-evidence"><time>{new Date(e.created_at).toLocaleString()}</time> · {e.content}</p>):<p>No linked events</p>}
      </details>
     </article>)
    }
   </div>
  </section>
 </div>;
}
