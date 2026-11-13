"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Request={id:number;content:string;status:"pending"|"acknowledged"|"accepted"|"rejected"|"implemented";times_asked:number;created_at:string;updated_at:string};
export default function WorldRequestsPanel({onClose,onUpdated}:{onClose:()=>void;onUpdated:()=>void}){
 const root=useRef<HTMLElement>(null);
 const [items,setItems]=useState<Request[]>([]);
 const [busy,setBusy]=useState<number|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/world/requests",{cache:"no-store"});
   const data=await r.json() as {requests?:Request[];error?:string};
   if(!r.ok)throw Error(data.error??"Could not load requests");
   setItems(data.requests??[]);setError("");onUpdated();
  }catch(e){setError(e instanceof Error?e.message:"Could not load requests");}
  finally{setLoading(false);}
 },[onUpdated]);
 useEffect(()=>{
   const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
   root.current?.focus();void load();
   const esc=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
   document.addEventListener("keydown",esc);
   return()=>{document.removeEventListener("keydown",esc);previous?.focus();};
 },[load,onClose]);
 async function change(id:number,status:Request["status"]){
  setBusy(id);setError("");
  try{const r=await fetch("/api/world/requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status})});
   const data=await r.json() as {error?:string};
   if(!r.ok)throw Error(data.error??"Request update failed");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Could not update request");}
  finally{setBusy(null);}
 }
 const pending=items.filter(x=>x.status==="pending").length;
 return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nimo's requests" className="world-card world-messages-panel world-requests-panel">
   <div className="world-journal-head"><h2>Requests {pending>0&&<span className="nimo-unread-count">{pending}</span>}</h2>
    <div className="world-message-header-actions"><button type="button" onClick={()=>void load()}>Refresh</button><button type="button" onClick={onClose}>Close</button></div>
   </div>
   <p className="meta">Requests for capabilities or help. Reviewing a request does not grant Nimo new tools.</p>
   {error&&<p className="world-warning" role="alert">{error}</p>}
   <div className="world-message-thread">
    {loading?<p className="meta">Loading requests…</p>:!items.length?<p className="meta">Nimo hasn't requested anything yet.</p>:
     items.map(item=><article className="nimo-request-entry" key={item.id}>
      <div className="nimo-request-meta"><strong>Request #{item.id} · {item.status}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></div>
      <p>{item.content}</p>
      {item.times_asked>1&&<p className="meta">Mentioned {item.times_asked} times</p>}
      <div className="nimo-request-actions">
       <label htmlFor={"nimo-request-"+item.id}>Status</label>
       <select id={"nimo-request-"+item.id} value={item.status} disabled={busy!==null} onChange={e=>void change(item.id,e.target.value as Request["status"])}>
        <option value="pending">Pending</option><option value="acknowledged">Acknowledged</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="implemented">Implemented</option>
       </select>
      </div>
     </article>)
    }
   </div>
  </section>
 </div>;
}
