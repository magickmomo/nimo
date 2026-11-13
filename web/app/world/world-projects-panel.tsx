"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Project={id:number;title:string;objective:string;next_step:string;progress_note:string;status:string;created_at:string;updated_at:string};
export default function WorldProjectsPanel({onClose}:{onClose:()=>void}){
 const root=useRef<HTMLElement>(null);
 const [projects,setProjects]=useState<Project[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/world/projects",{cache:"no-store"});
   const data=await r.json() as {projects?:Project[];error?:string};
   if(!r.ok)throw Error(data.error??"Unable to load projects");
   setProjects(data.projects??[]);setError("");
  }catch(e){setError(e instanceof Error?e.message:"Unable to load projects");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  root.current?.focus();void load();
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
  document.addEventListener("keydown",key);
  return()=>{document.removeEventListener("keydown",key);previous?.focus();};
 },[load,onClose]);
 return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="world-card world-messages-panel world-projects-panel" role="dialog" aria-modal="true" aria-label="Nimo's projects" ref={root} tabIndex={-1}>
   <div className="world-journal-head"><h2>Nimo's projects</h2>
    <div className="world-message-header-actions"><button type="button" onClick={()=>void load()}>Refresh</button><button type="button" onClick={onClose}>Close</button></div>
   </div>
   <p className="meta">Nimo creates and manages his own longer-term projects. A reported milestone is his record, not independent proof of completion.</p>
   {error&&<p className="world-warning" role="alert">{error}</p>}
   <div className="world-message-thread">
    {loading?<p className="meta">Loading projects…</p>:!projects.length?<p className="meta">Nimo hasn't created a project yet.</p>:
     projects.map(p=><article className="nimo-request-entry" key={p.id}>
       <div className="nimo-request-meta"><strong>{p.title}</strong><span>{p.status}</span></div>
       <p><strong>Objective:</strong> {p.objective}</p>
       <p><strong>Next step:</strong> {p.next_step}</p>
       {p.progress_note&&<p><strong>Progress:</strong> {p.progress_note}</p>}
       <small className="meta">Updated {new Date(p.updated_at).toLocaleString()}</small>
     </article>)
    }
   </div>
  </section>
 </div>;
}
