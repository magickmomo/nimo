"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Evidence={id:number;created_at:string;kind:string;action:string|null;content:string};
type ReviewProposal={operation:"create"|"update";subject:string;statement:string;category:string;confidence:number;evidenceIds:number[]};
type Review={periodStart:string;periodEnd:string;preview:boolean;scanned:number;reviewSummary?:string;excludedProposalCount?:number;proposals:ReviewProposal[];validationError?:string;invalidEvidenceIds?:unknown[];rejectedProposals?:ReviewProposal[]};
type Memory={id:number;statement:string;category:string;subject:string;confidence:number;status:string;updated_at:string;evidence_count:number;evidence:Evidence[]};
export default function WorldMemoriesPanel({onClose}:{onClose:()=>void}) {
 const root=useRef<HTMLElement>(null);
 const [memories,setMemories]=useState<Memory[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshing,setRefreshing]=useState(false);
 const [refreshed,setRefreshed]=useState(false);
 const [reviewHour,setReviewHour]=useState("2026-11-20T21:00");
 const [reviewLoading,setReviewLoading]=useState(false);
 const [reviewError,setReviewError]=useState("");
 const [review,setReview]=useState<Review|null>(null);
 const preview=useCallback(async()=>{
  setReviewLoading(true);setReviewError("");setReview(null);
  try{
   const start=new Date(reviewHour+":00.000Z").toISOString();
   const res=await fetch("/api/world/memory-review",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({start}),cache:"no-store"
   });
   const data=await res.json() as Review&{error?:string};
   if(!res.ok)throw Error(data.error||"Memory preview failed");
   setReview(data);
  }catch(e){setReviewError(e instanceof Error?e.message:"Memory preview failed");}
  finally{setReviewLoading(false);}
 },[reviewHour]);
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
   <p className="meta">Evidence-backed personal experiences. Oracle research is stored separately. Only active memories are shown.</p>
   {error&&<p role="alert" className="world-warning">{error}</p>}
   <details className="world-memory-preview-control">
    <summary>Test hourly memory consolidation (read-only)</summary>
    <p className="meta">Enter the start of a completed hour in UTC. The LLM reviews that hour and proposes memories without saving them or changing the consolidation cursor.</p>
    <label htmlFor="nimo-memory-hour">Hour start (UTC)</label>{" "}
    <input id="nimo-memory-hour" type="datetime-local" step={3600} value={reviewHour}
      onChange={e=>setReviewHour(e.target.value)}/>
    {" "}<button type="button" onClick={()=>void preview()} disabled={reviewLoading||!reviewHour}
      aria-busy={reviewLoading}>{reviewLoading?"Reviewing…":"Preview memories"}</button>
    {reviewError&&<p role="alert" className="world-warning">{reviewError}</p>}
    {review&&<div aria-live="polite">
      <p className="meta">Reviewed {review.scanned} events from {review.periodStart} to {review.periodEnd}. No changes saved.</p>
      <h3>LLM memory review</h3>
      {review.reviewSummary&&<p>{review.reviewSummary}</p>}
      <p className="meta">{review.validationError
        ? `The LLM returned ${review.rejectedProposals?.length??0} proposed memories; validation rejected the batch. Nothing was saved.`
        : `${review.proposals.length} proposed memor${review.proposals.length===1?"y":"ies"} to create or update. These are previews only.`}</p>
      {!review.validationError&&!!review.excludedProposalCount&&<p className="meta">{review.excludedProposalCount} candidate{review.excludedProposalCount===1?" was":"s were"} not retained because of the three-memory limit or because the evidence came only from Oracle research. Research remains in the Oracle library.</p>
      {review.validationError&&<div role="alert" className="world-warning">
        <strong>The LLM proposals failed validation. Nothing was saved.</strong>
        <p>{review.validationError}</p>
        {review.invalidEvidenceIds?.length?<p>IDs not present in the selected hour: {review.invalidEvidenceIds.join(", ")}</p>:null}
        {review.rejectedProposals?.map((m,i)=><article className="world-memory-entry" key={i}>
          <p><strong>Proposal {i+1}: {m.operation} · {m.category}</strong></p>
          <p>{m.statement}</p>
          <p className="meta">Subject: {m.subject}; confidence: {Math.round(m.confidence*100)}%; proposed evidence IDs: {Array.isArray(m.evidenceIds)?m.evidenceIds.join(", "):"missing"}</p>
        </article>)}
       </div>}
      {!review.validationError&&review.proposals.length===0?<p>No lasting memories proposed for this hour.</p>:review.proposals.map((m,i)=>
       <article className="world-memory-entry" key={i}>
        <div className="world-memory-meta"><strong>{m.operation} · {m.category}</strong>
         <span>Confidence {Math.round(m.confidence*100)}%</span></div>
        <p>{m.statement}</p>
        <p className="meta">Subject: {m.subject}; supporting event IDs: {m.evidenceIds.join(", ")}</p>
       </article>)}
    </div>}
   </details>

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
