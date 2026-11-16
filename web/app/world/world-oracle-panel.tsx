"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Source={title:string;url:string};
type Query={id:number;question:string;status:string;asked_at:string;answered_at:string|null;answer:string|null;sources:Source[];memory_id:number|null;error:string|null};
export default function WorldOraclePanel({onClose}:{onClose:()=>void}){
  const root=useRef<HTMLElement>(null);
  const [queries,setQueries]=useState<Query[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    try{
      const r=await fetch("/api/world/oracle",{cache:"no-store"});
      const data=await r.json() as {queries?:Query[];error?:string};
      if(!r.ok)throw Error(data.error??"Oracle history unavailable");
      setQueries(data.queries??[]);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Oracle history unavailable");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    const prior=document.activeElement instanceof HTMLElement?document.activeElement:null;
    root.current?.focus();void load();
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);prior?.focus();};
  },[load,onClose]);
  return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={root} tabIndex={-1} className="world-card world-messages-panel" role="dialog" aria-modal="true" aria-label="Oracle research history">
      <div className="world-journal-head"><h2>Oracle</h2><div className="world-message-header-actions">
        <button type="button" onClick={()=>void load()}>Refresh</button><button type="button" onClick={onClose}>Close</button>
      </div></div>
      <p className="meta">Each question costs 10 coins from Nimo's balance; failed research is refunded. Sourced answers are integrated into his existing memories; unsourced answers are retained as unverified research, not knowledge.</p>
      {error&&<p className="world-warning" role="alert">{error}</p>}
      <div className="world-message-thread">
        {loading?<p className="meta">Loading Oracle history…</p>:!queries.length?<p className="meta">Nimo hasn't asked the Oracle anything yet.</p>:
          queries.map(q=><article key={q.id} className="nimo-request-entry">
            <div className="nimo-request-meta"><strong>{q.question}</strong><span>{q.status}</span></div>
            {q.answer&&<p style={{whiteSpace:"pre-wrap"}}>{q.answer}</p>}
            {q.sources.length>0&&<ul>{q.sources.map(src=><li key={src.url}><a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a></li>)}</ul>}
            {q.memory_id&&<p className="meta">Consolidated memory #{q.memory_id}</p>}
            {q.error&&<p className="meta">Research error: {q.error}</p>}
            <small className="meta">Asked {new Date(q.asked_at).toLocaleString()}</small>
          </article>)
        }
      </div>
    </section>
  </div>;
}
