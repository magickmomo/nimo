"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Stroke={points:[number,number][];color:string;width:number};
type Sketch={id:number;title:string;intention:string;status:"drawing"|"finished"|"abandoned";strokes:Stroke[];stroke_count:number;created_at:string;updated_at:string};
type Shelf="artworks"|"intentions";
export default function WorldArtworksPanel({onClose}:{onClose:()=>void}){
 const root=useRef<HTMLElement>(null);
 const [shelf,setShelf]=useState<Shelf>("artworks"),[owned,setOwned]=useState(false);
 const [drawings,setDrawings]=useState<Sketch[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=useCallback(async()=>{
  try{const response=await fetch("/api/world/artworks",{cache:"no-store"});
   const body=await response.json() as {owned?:boolean;drawings?:Sketch[];error?:string};
   if(!response.ok)throw Error(body.error||"Cannot load artwork");
   setOwned(Boolean(body.owned));setDrawings(body.drawings??[]);setError("");
  }catch(e){setError(e instanceof Error?e.message:"Could not load artwork");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  root.current?.focus();void load();
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
  document.addEventListener("keydown",key);
  return()=>{document.removeEventListener("keydown",key);previous?.focus();};
 },[load,onClose]);
 const visible=drawings.filter(s=>shelf==="intentions" ? true : s.status!=="drawing");
 return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="world-card world-messages-panel world-artworks-panel" role="dialog" aria-modal="true" aria-label="Nimo's sketchbook" tabIndex={-1} ref={root}>
   <div className="world-journal-head"><h2>Nimo's sketchbook</h2><div className="world-message-header-actions"><button type="button" onClick={()=>void load()}>Refresh</button><button type="button" onClick={onClose}>Close</button></div></div>
   <p className="meta">Every line is drawn from Nimo's own coordinates. No image-generation service creates these pictures.</p>
   <div className="world-artworks-tabs" role="tablist" aria-label="Sketchbook pages">
    <button type="button" role="tab" aria-selected={shelf==="artworks"} onClick={()=>setShelf("artworks")}>Artworks ({drawings.filter(x=>x.status!=="drawing").length})</button>
    <button type="button" role="tab" aria-selected={shelf==="intentions"} onClick={()=>setShelf("intentions")}>What he decided to draw ({drawings.length})</button>
   </div>
   {error&&<p className="world-warning" role="alert">{error}</p>}
   <div className="world-message-thread">
    {loading?<p className="meta">Loading sketchbook…</p>:!owned?<p className="meta">The sketchbook is still in the vending machine. Nimo can buy it for 3 coins once he inspects the machine and earns enough.</p>:!visible.length?<p className="meta">{shelf==="artworks"?"No completed drawings yet. Once Nimo finishes a sketch, it will appear here.":"Nimo hasn't started a drawing yet. His next idea will appear here when he starts one."}</p>:
    <div className="world-artworks-grid">{visible.map(d=><article className="world-artwork-entry" key={d.id}>
     <svg viewBox="0 0 240 180" role="img" aria-label={d.title} className="world-artwork-canvas">
      <rect width="240" height="180" fill="#faf5e9"/>
      {(d.strokes??[]).map((stroke,i)=><polyline key={i} points={stroke.points.map(p=>p.join(",")).join(" ")} fill="none" stroke={/^#[\da-fA-F]{6}$/.test(stroke.color)?stroke.color:"#333333"} strokeWidth={Math.min(8,Math.max(1,stroke.width))} strokeLinecap="round" strokeLinejoin="round"/>)}
     </svg>
     <strong>{d.title}</strong><p><strong>He wanted to draw:</strong> {d.intention}</p>
     <small className="meta">{d.status} · {d.stroke_count} strokes · {new Date(d.updated_at).toLocaleString()}</small>
    </article>)}</div>}
   </div>
  </section>
 </div>;
}
