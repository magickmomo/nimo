"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorldEvent, WorldState } from "../../lib/world";
import "./world.css";

type Snapshot = {
  world: { state: WorldState; next_tick: string };
  events: WorldEvent[];
};

export default function World() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState("");
  const [sending, setSending] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/world", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Cannot load world");
      setData(body);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); setClock(Date.now()); }, 10000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !token || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/world/message", {
        method: "POST", headers: { "Content-Type": "application/json", "x-world-owner-token": token },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Message failed");
      setDraft("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const state = data?.world.state;
  const seconds = data ? Math.max(0, Math.ceil((Date.parse(data.world.next_tick) - clock) / 1000)) : 0;
  return (
    <div className="world-page">
      <p className="eyebrow">World 001 · seed experiment</p>
      <h1>A beginning, not a body.</h1>
      <p className="lead">A persistent character with a simple identity, changing emotions and the freedom to discover its own goals. No avatar has been chosen.</p>
      {error && <div className="world-warning" role="status">{error}</div>}
      <div className="world-frame">
        <div className="world-frame-top"><span>WORLD 001</span><span>{state ? "IDENTITY ACTIVE" : "WAITING FOR INITIALISATION"}</span></div>
        <div className="world-presence">
          <span className="world-symbol" aria-hidden="true">_</span>
          <p>{state ? state.identity : "No state available."}</p>
          <small>No physical form · No avatar</small>
        </div>
        <div className="world-frame-bottom">
          <span>{state ? `Decision #${state.tickCount}` : "—"}</span>
          <span>Next eligible tick: {seconds}s</span>
        </div>
      </div>
      <div className="world-grid">
        <section className="world-card">
          <h2>Internal state</h2>
          {state ? (
            <>
              {Object.entries(state.emotions).map(([name, value]) => (
                <div className="world-meter" key={name}>
                  <div><span>{name}</span><strong>{Math.round(value * 100)}%</strong></div>
                  <progress max={1} value={value}/>
                </div>
              ))}
              <div className="world-meta"><strong>Activity</strong><span>{state.currentActivity}</span></div>
              <div className="world-meta"><strong>Goal</strong><span>{state.currentGoal || "Not yet formed"}</span></div>
              <div className="world-meta"><strong>Tools</strong><span>{state.tools.length ? state.tools.join(", ") : "None available"}</span></div>
            </>
          ) : <p className="meta">Run the database setup to initialise the character.</p>}
        </section>
        <section className="world-card">
          <h2>Core beliefs</h2>
          {state?.beliefs.length ? (
            <ul className="world-beliefs">{state.beliefs.map((b,i) =>
              <li key={i}><strong>{b.text}</strong><small>Confidence {Math.round(b.confidence * 100)}% · Evidence: {b.evidence}</small></li>
            )}</ul>
          ) : <p className="meta">No beliefs formed from experience yet. The initial identity is deliberately minimal.</p>}
          <h2>Interaction</h2>
          <form onSubmit={send} className="world-form">
            <label htmlFor="world-token">Owner access token</label>
            <input id="world-token" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="Owner token (not stored)" />
            <label htmlFor="world-message">Leave a message in the world</label>
            <textarea id="world-message" rows={3} maxLength={1000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Hello. Is anyone here?" />
            <button disabled={!draft.trim() || !token || sending}>{sending ? "Sending…" : "Leave message"}</button>
          </form>
          <p className="meta">Messages enter the event log and can influence the next AI decision; replies aren't instantaneous.</p>
        </section>
      </div>
      <section className="world-card world-journal">
        <div className="world-journal-head"><h2>Journal</h2><button type="button" onClick={()=>void refresh()}>Refresh</button></div>
        {data?.events.length ? data.events.map(event => (
          <article key={event.id} className="world-event">
            <div><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span>{event.action || event.kind}</span></div>
            <p>{event.content}</p>
          </article>
        )) : <p className="meta">Nothing has happened yet.</p>}
      </section>
    </div>
  );
}
