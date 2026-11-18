"use client";

import {useEffect,useRef,useState} from "react";

export type NimoNote={path:string;content:string;revision:number;updated_at:string};

export default function WorldNotesPanel({notes,onClose,onRefresh,offline=false}:{
  notes:NimoNote[]|undefined;
  onClose:()=>void;
  onRefresh:()=>Promise<void>;
  offline?:boolean;
}){
  const root=useRef<HTMLElement>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const sorted=[...(notes??[])].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.path.localeCompare(b.path));
  const active=sorted.find(note=>note.path===selected)??sorted[0]??null;

  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    root.current?.focus();
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){onClose();return;}
      if(e.key!=="Tab")return;
      const elements=root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if(!elements?.length){e.preventDefault();root.current?.focus();return;}
      const first=elements[0],last=elements[elements.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);previous?.focus();};
  },[onClose]);

  async function refresh(){
    if(refreshing)return;
    setRefreshing(true);setError("");
    try{await onRefresh();}
    catch(e){setError(e instanceof Error?e.message:"Could not refresh notes");}
    finally{setRefreshing(false);}
  }

  return <div className="world-message-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nimo's saved notes" className="world-card world-messages-panel world-notes-panel">
      <div className="world-journal-head">
        <h2>Notes ({sorted.length})</h2>
        <div className="world-message-header-actions">
          <button type="button" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?"Refreshing…":"Refresh"}</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <p className="meta">Documents Nimo has written and saved in his workspace, separate from his consolidated memories.</p>
      {error&&<p role="alert" className="world-warning">{error}</p>}
      {offline&&<p className="meta">Offline snapshot: the latest saved notes may be unavailable.</p>}
      <div className="world-notes-layout">
        {sorted.length===0?<p className="meta">No saved notes to show. Nimo can write documents using his writing tool.</p>:<>
          <div className="world-notes-list" aria-label="Saved notes">
            {sorted.map(note=><button key={note.path} type="button" className="world-notes-item"
              aria-pressed={active?.path===note.path} onClick={()=>setSelected(note.path)}>
              <strong>{note.path}</strong><small>Revision {note.revision}</small>
            </button>)}
          </div>
          {active&&<article className="world-notes-document" aria-label={active.path}>
            <div className="world-notes-document-head">
              <strong>{active.path}</strong>
              <small>Revision {active.revision} · Updated {new Date(active.updated_at).toLocaleString()}</small>
            </div>
            <pre>{active.content}</pre>
          </article>}
        </>}
      </div>
    </section>
  </div>;
}
