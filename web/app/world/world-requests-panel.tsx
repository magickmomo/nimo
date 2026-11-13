"use client";
import {useCallback,useEffect,useRef,useState} from "react";

type Status="pending"|"acknowledged"|"accepted"|"rejected"|"implemented";
type Reply={status:Status;message:string;created_at:string};
type Request={id:number;content:string;status:Status;times_asked:number;created_at:string;updated_at:string;responses:Reply[]};
type Draft={status:Status;message:string};

export default function WorldRequestsPanel({onClose,onUpdated}:{onClose:()=>void;onUpdated:()=>void}){
 const root=useRef<HTMLElement>(null);
 const [items,setItems]=useState<Request[]>([]);
 const [drafts,setDrafts]=useState<Record<number,Draft>>({});
 // Keep the same key if a network error occurs after the Worker committed.
 // A retry must not deliver the same explanation twice to Nimo.
 const replyKeys=useRef<Record<number,string>>({});
 const [busy,setBusy]=useState<number|null>(null);
 const [loading,setLoading]=useState(true);
 const [refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  try{
   const r=await fetch("/api/world/requests",{cache:"no-store"});
   const data=await r.json() as {requests?:Request[];error?:string};
   if(!r.ok)throw Error(data.error??"Could not load requests");
   setItems(data.requests??[]);setError("");onUpdated();
  }catch(e){setError(e instanceof Error?e.message:"Could not load requests");}
  finally{setLoading(false);setRefreshing(false);}
 },[onUpdated]);
 useEffect(()=>{
   const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
   root.current?.focus();void load();
   const esc=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
   document.addEventListener("keydown",esc);
   return()=>{document.removeEventListener("keydown",esc);previous?.focus();};
 },[load,onClose]);
 function updateDraft(item:Request,patch:Partial<Draft>){
  setDrafts(old=>({...old,[item.id]:{status:old[item.id]?.status??item.status,
     message:old[item.id]?.message??"",...patch}}));
 }
 async function submit(item:Request,sendMessage:boolean){
  if(busy!==null)return;
  const current=drafts[item.id]??{status:item.status,message:""};
  const message=current.message.trim();
  if(sendMessage&&!message)return;
  setBusy(item.id);setError("");setNotice("");
  const key=sendMessage?(replyKeys.current[item.id]??crypto.randomUUID()):null;
  if(key)replyKeys.current[item.id]=key;
  try{
   const body=sendMessage?{id:item.id,status:current.status,message,idempotencyKey:key}:
     {id:item.id,status:current.status};
   const response=await fetch("/api/world/requests",{
     method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
   });
   const data=await response.json() as {error?:string};
   if(!response.ok)throw Error(data.error??"Request response failed");
   if(sendMessage){
     delete replyKeys.current[item.id];
     setNotice("Your response was saved and sent to Nimo. He can reply in Messages on his next decision after waking.");
   }else setNotice("Request status saved.");
   setDrafts(old=>{const next={...old};delete next[item.id];return next;});
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Could not update request");}
  finally{setBusy(null);}
 }
 const pending=items.filter(x=>x.status==="pending").length;
 return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nimo's requests" className="world-card world-messages-panel world-requests-panel">
   <div className="world-journal-head"><h2>Requests {pending>0&&<span className="nimo-unread-count">{pending}</span>}</h2>
    <div className="world-message-header-actions">
     <button type="button" disabled={refreshing||busy!==null} onClick={()=>{setRefreshing(true);void load();}}>
      {refreshing?"Refreshing…":"Refresh"}</button>
     <button type="button" onClick={onClose}>Close</button>
    </div>
   </div>
   <p className="meta">Review requests, then tell Nimo what you decided. Changing a status does not grant new tools.</p>
   {error&&<p className="world-warning" role="alert">{error}</p>}
   {notice&&<p className="nimo-request-notice" role="status">{notice}</p>}
   <div className="world-message-thread">
    {loading?<p className="meta">Loading requests…</p>:!items.length?<p className="meta">Nimo hasn't requested anything yet.</p>:
     items.map(item=>{
      const draft=drafts[item.id]??{status:item.status,message:""};
      const hasReply=Boolean(draft.message.trim());
      return <article className="nimo-request-entry" key={item.id}>
       <div className="nimo-request-meta"><strong>Request #{item.id} · {item.status}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></div>
       <p>{item.content}</p>
       {item.times_asked>1&&<p className="meta">Mentioned {item.times_asked} times</p>}
       {item.responses?.length>0&&<details className="nimo-request-responses">
        <summary>Previous responses ({item.responses.length})</summary>
        {item.responses.map((reply,index)=><div key={index} className="nimo-request-previous">
          <small>{new Date(reply.created_at).toLocaleString()} · {reply.status}</small>
          <p>{reply.message}</p>
         </div>)}
       </details>}
       <div className="nimo-request-actions">
        <label htmlFor={"nimo-request-"+item.id}>Status</label>
        <select id={"nimo-request-"+item.id} value={draft.status} disabled={busy!==null}
         onChange={e=>updateDraft(item,{status:e.target.value as Status})}>
         <option value="pending">Pending</option><option value="acknowledged">Acknowledged</option>
         <option value="accepted">Accepted</option><option value="rejected">Rejected</option>
         <option value="implemented">Implemented</option>
        </select>
       </div>
       <label className="nimo-request-reply-label" htmlFor={"nimo-request-reply-"+item.id}>Your reply to Nimo</label>
       <textarea id={"nimo-request-reply-"+item.id} rows={3} maxLength={1000}
        placeholder="Explain what you implemented, what changed, or why this request isn't possible yet…"
        value={draft.message} disabled={busy!==null}
        onChange={e=>{delete replyKeys.current[item.id];updateDraft(item,{message:e.target.value});}}/>
       <div className="nimo-request-buttons">
        <button type="button" disabled={busy!==null||draft.status===item.status}
         onClick={()=>void submit(item,false)}>Save status only</button>
        <button type="button" disabled={busy!==null||!hasReply}
         onClick={()=>void submit(item,true)}>{busy===item.id?"Saving…":"Send response to Nimo"}</button>
       </div>
      </article>;
     })
    }
   </div>
  </section>
 </div>;
}
