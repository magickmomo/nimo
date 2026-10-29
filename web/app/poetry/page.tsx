"use client";

import { useState } from "react";

type Poem = { id: string; content: string };

export default function Poetry() {
  const [token, setToken] = useState("");
  const [poem, setPoem] = useState<Poem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function createPoem() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/nimo/poems", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate poem");
      setPoem(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Nimo · first autonomous skill</p>
      <h1>Poetry</h1>
      <p className="lead">Create a tiny poem and place it in Nimo's outgoing queue. When his ESP32 polling firmware is ready, he'll collect it and display it on his OLED.</p>
      <section className="panel" style={{ maxWidth: 540 }}>
        <label htmlFor="admin-token">Admin token</label>
        <input id="admin-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="NIMO_ADMIN_TOKEN" />
        <p className="meta">The token is only used for this request; it isn't saved in the browser.</p>
        <button disabled={busy || !token.trim()} onClick={() => void createPoem()}>{busy ? "Writing…" : "Write and queue a poem"}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {poem && <div style={{ marginTop: 24 }}><h2>Queued for Nimo</h2><p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{poem.content}</p><p className="meta">Waiting for the ESP32 to collect and acknowledge this message.</p></div>}
      </section>
    </>
  );
}
