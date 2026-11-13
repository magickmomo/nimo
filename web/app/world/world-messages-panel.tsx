"use client";

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";

type Message={id:number;created_at:string;kind:string;content:string;action:string|null};

export default function WorldMessagesPanel({onClose}:{onClose:()=>void}){
  const dialogRef=useRef<HTMLDivElement>(null);
  const threadRef=useRef<HTMLDivElement>(null);
  const keepLatestVisible=useRef(true);
  const firstMessagesLoaded=useRef(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [authenticated,setAuthenticated]=useState<boolean|null>(null);
  const [draft,setDraft]=useState("");
  const [sending,setSending]=useState(false);
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
    try{
      const response=await fetch("/api/world/messages",{cache:"no-store"});
      if(response.status===401){
        setAuthenticated(false);setMessages([]);setError("");
        return;
      }
      const data=await response.json() as {messages?:Message[];error?:string};
      if(!response.ok)throw Error(data.error||"Conversation unavailable");
      const thread=threadRef.current;
      // Only follow new messages if already at the bottom. Opening always
      // starts at the newest entry; historical browsing should not jump.
      keepLatestVisible.current=!firstMessagesLoaded.current || !thread ||
        thread.scrollHeight-thread.scrollTop-thread.clientHeight<90;
      firstMessagesLoaded.current=true;
      setMessages(data.messages||[]);
      setAuthenticated(true);setError("");succeeded=true;
    }catch(err){setError(err instanceof Error?err.message:"Conversation unavailable");}
    finally{
      if(manual){
        setRefreshing(false);
        if(succeeded){setRefreshed(true);feedbackTimer.current=setTimeout(()=>setRefreshed(false),1800);}
      }
    }
  },[]);

  useLayoutEffect(()=>{
    if(!keepLatestVisible.current)return;
    const thread=threadRef.current;
    if(thread)thread.scrollTop=thread.scrollHeight;
  },[messages]);

  useEffect(()=>{
    const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialogRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){onClose();return;}
      if(event.key!=="Tab")return;
      const elements=dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      if(!elements?.length){event.preventDefault();dialogRef.current?.focus();return;}
      const first=elements[0],last=elements[elements.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",onKeyDown);
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{
      document.removeEventListener("keydown",onKeyDown);
      document.body.style.overflow=oldOverflow;
      if(feedbackTimer.current)clearTimeout(feedbackTimer.current);
      previouslyFocused?.focus();
    };
  },[onClose]);

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{
      if(document.visibilityState==="visible")void load();
    },15000);
    return()=>window.clearInterval(timer);
  },[load]);

  async function send(event:React.FormEvent){
    event.preventDefault();
    if(!draft.trim()||sending||authenticated!==true)return;
    setSending(true);setError("");
    try{
      const response=await fetch("/api/world/message",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:draft.trim()}),
      });
      const result=await response.json() as {error?:string};
      if(!response.ok)throw Error(result.error||"Message failed");
      setDraft("");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Unable to send");}
    finally{setSending(false);}
  }

  return <div className="world-message-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="world-message-title" className="world-card world-messages-panel">
    <div className="world-journal-head">
      <h2 id="world-message-title">Messages</h2>
      <div className="world-message-header-actions">
        <button type="button" onClick={()=>void load(true)} disabled={sending||refreshing} aria-busy={refreshing}><span className="world-refresh-label">{refreshing&&<span className="world-refresh-spinner" aria-hidden="true"/>}{refreshing?"Refreshing…":refreshed?"Updated":"Refresh"}</span></button>
        <button type="button" onClick={onClose} aria-label="Close messages">Close</button>
      </div>
    </div>
    <p className="meta">Your conversation with Nimo and his capability requests. Replies arrive during his autonomous decisions.</p>
    {error&&<p className="world-warning" role="alert">{error}</p>}
    {authenticated===false ? <p className="meta">
      Messages are private. <a href="/world/settings">Sign in under Settings</a> to view and send them.
    </p> : <>
      <div ref={threadRef} className="world-message-thread" role="log" aria-label="Conversation history" aria-live="polite">
        {messages.length===0?<p className="meta">{authenticated===null?"Loading conversation…":"No messages yet."}</p>:
          messages.map(item=>{
            const isYou=item.kind==="visitor",isRequest=item.action==="REQUEST";
            return <article key={item.id} className={"world-message "+(isYou?"from-owner":isRequest?"is-request":"from-nimo")}>
              <div className="world-message-meta">
                <strong>{isYou?"You":isRequest?"Nimo · Request":"Nimo"}</strong>
                <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
              </div>
              <p>{item.content}</p>
            </article>;
          })}
      </div>
      <form className="world-message-compose" onSubmit={event=>void send(event)}>
        <label htmlFor="nimo-message">Message Nimo</label>
        <textarea id="nimo-message" rows={3} maxLength={1000} value={draft}
          onChange={event=>setDraft(event.target.value)}
          placeholder="Write a message…" disabled={authenticated!==true||sending} required/>
        <div className="world-message-actions">
          <button disabled={!draft.trim()||sending||authenticated!==true} type="submit">
            {sending?"Sending…":"Send message"}
          </button>
        </div>
      </form>
    </>}
    </section>
  </div>;
}
