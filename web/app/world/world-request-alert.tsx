"use client";

import {useCallback,useEffect,useState} from "react";

type RequestMessage={id:number;created_at:string;kind:string;action:string|null;content:string};
const STORAGE_KEY="nimo-world-last-seen-request-v1";

export default function WorldRequestAlert({onOpen}:{onOpen:()=>void}){
  const [requests,setRequests]=useState<RequestMessage[]>([]);
  const [lastSeen,setLastSeen]=useState<number|null>(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/world/messages",{cache:"no-store"});
      if(!response.ok){setRequests([]);return;} // Owner session required; never show private requests to visitors.
      const body=await response.json() as {messages?:RequestMessage[]};
      setRequests((body.messages??[]).filter(item=>item.action==="REQUEST"||item.kind==="request"));
    }catch{
      // Preserve any already displayed request on transient connection failures.
    }
  },[]);

  useEffect(()=>{
    try{
      const stored=Number(window.localStorage.getItem(STORAGE_KEY)??"0");
      setLastSeen(Number.isSafeInteger(stored)&&stored>=0?stored:0);
    }catch{setLastSeen(0);}
    void load();
    const interval=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},20000);
    const onVisible=()=>{if(document.visibilityState==="visible")void load();};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{window.clearInterval(interval);document.removeEventListener("visibilitychange",onVisible);};
  },[load]);

  const unread=requests.filter(item=>lastSeen!==null&&item.id>lastSeen);
  const latest=unread.at(-1);

  function openRequests(){
    const newest=requests.at(-1)?.id;
    if(newest!==undefined){
      setLastSeen(newest);
      try{window.localStorage.setItem(STORAGE_KEY,String(newest));}catch{/* Local acknowledgement is optional. */}
    }
    onOpen();
  }

  return <>
    <button type="button" className="world-request-button"
      onClick={openRequests} aria-label={unread.length?`Nimo has ${unread.length} new request${unread.length===1?"":"s"}. Open messages`:"View Nimo's requests"}>
      Requests{unread.length>0?` (${unread.length})`:""}
    </button>
    {latest&&<aside className="world-request-notification" role="status" aria-live="polite">
      <strong>New request from Nimo</strong>
      <p>{latest.content}</p>
      <button type="button" onClick={openRequests}>Read in Messages</button>
    </aside>}
  </>;
}
