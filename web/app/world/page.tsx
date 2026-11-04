"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorldEvent, WorldState } from "../../lib/world";
import "./world.css";
import IsometricWorld, { type JourneyView } from "./isometric-world";
import { groupJournalEvents } from "../../lib/world-journal";

type Snapshot = {
  world: { state: WorldState; next_tick: string };
  events: WorldEvent[];
  documents?: { path: string; content: string; revision: number; updated_at: string }[];
  autonomousEnabled?: boolean;
  availableTools?: string[];
  position?: { x: number; y: number };
  journey?: JourneyView;
  environmentMemory?: {
    visited: { x: number; y: number; visit_count: number }[];
    seen: { x: number; y: number }[];
    inspected: { x: number; y: number; kind: string; description: string; inspection_count: number }[];
  };
};

export default function World() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState("");
  const [sending, setSending] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);

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
    const interval = window.setInterval(() => { void refresh(); setClock(Date.now()); }, data?.journey?.status === "travelling" ? 2500 : 10000);
    return () => window.clearInterval(interval);
  }, [refresh, data?.journey?.status]);

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
  const meters = state ? [
    { label: "Energy", value: state.emotions.energy, tone: "energy" },
    { label: "Happiness", value: state.emotions.happiness, tone: "happiness" },
    { label: "Boredom", value: state.emotions.boredom, tone: "boredom" },
  ] : [];
  return (
    <div className="world-page world-dashboard">
      <div className="world-topbar">
        <a className="world-settings-link" href="/world/settings">World settings — Sleep / Wake</a>
      </div>
      {error && <div className="world-warning" role="status">{error}</div>}
      <div className="world-layout">
        <div className="world-main">
      {state && (
        <>
          <section className="world-status-strip" aria-label="Nimo's internal state">
            {meters.map((item) => {
              const value = Math.max(0, Math.min(1, Number.isFinite(item.value) ? item.value : 0));
              return (
                <div className="world-status-item" key={item.label}>
                  <div className="world-status-head">
                    <span className={`world-status-dot ${item.tone}`} aria-hidden="true" />
                    <span>{item.label}</span>
                    <span className="world-status-percent">{Math.round(value * 100)}%</span>
                  </div>
                  <div className="world-status-bar" role="progressbar"
                    aria-label={item.label} aria-valuenow={Math.round(value * 100)}
                    aria-valuemin={0} aria-valuemax={100}>
                    <div className={`world-status-fill ${item.tone}`}
                      style={{ width: `${value * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
          <div className="world-status-meta">
            <div className="world-status-meta-item"><strong>Activity</strong><span>{state.currentActivity}</span></div>
            <div className="world-status-meta-item"><strong>Goal</strong><span>{state.currentGoal || "Not yet formed"}</span></div>
            <div className="world-status-meta-item"><strong>Status</strong>
              <span>{data?.autonomousEnabled === false ? "Sleeping" : "Awake"} · Decision #{state.tickCount}</span>
            </div>
            <div className="world-status-meta-item"><strong>Tools</strong>
              <span>{data?.availableTools ? (data.availableTools.length ? data.availableTools.join(", ") : "None available") : "Checking environment…"}</span>
            </div>
          </div>
        </>
      )}
      <IsometricWorld position={data?.position ?? null} visited={data?.environmentMemory?.visited} seenTiles={data?.environmentMemory?.seen} inspected={data?.environmentMemory?.inspected} journey={data?.journey} />
      <section className="world-card world-workspace">
        <div className="world-journal-head">
          <h2>Workspace</h2>
          <span className="meta">{data?.documents?.length ?? 0} / 12 documents</span>
        </div>
        <p className="meta">Files Nimo actually saved using his write tool. Documents are readable by anyone who can access this World page.</p>
        {data?.documents?.length ? (
          <>
            <div className="world-file-list">
              {data.documents.map(file => (
                <button key={file.path} type="button"
                  aria-pressed={selectedDocument === file.path}
                  onClick={() => setSelectedDocument(prev => prev === file.path ? null : file.path)}>
                  {file.path} <small>v{file.revision}</small>
                </button>
              ))}
            </div>
            {data.documents.filter(file => file.path === selectedDocument).map(file => (
              <div key={file.path} className="world-file-view">
                <div className="world-file-caption">{file.path} · revision {file.revision}</div>
                <pre>{file.content}</pre>
              </div>
            ))}
          </>
        ) : <p className="meta">No documents yet. Nimo can create text files when awake.</p>}
      </section>
      <div className="world-grid">
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
        </div>
      <section className="world-card world-journal">
        <div className="world-journal-head"><h2>Journal</h2><button type="button" onClick={()=>void refresh()}>Refresh</button></div>
        {data?.events.length ? groupJournalEvents(data.events).map(event => (
          <article key={event.id} className="world-event">
            <div><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span>{event.label}</span></div>
            {event.movement && (
              <p className="world-event-route"><strong>From:</strong> {event.movement.from} <span aria-hidden="true">→</span> <strong>To:</strong> {event.movement.to}</p>
            )}
            {event.narration && <p className="world-event-narration"><strong>Nimo:</strong> {event.narration}</p>}
            {event.outcome && <p className="world-event-result"><strong>{event.narration ? "Result:" : "Event:"}</strong> {event.outcome}</p>}
          </article>
        )) : <p className="meta">Nothing has happened yet.</p>}
      </section>
      </div>
    </div>
  );
}
