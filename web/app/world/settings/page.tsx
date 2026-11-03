"use client";

import { useCallback, useEffect, useState } from "react";
import "../world.css";

type WorldSnapshot = {
  autonomousEnabled: boolean;
  world: { state: { tickCount: number; lastTick: string | null } };
};

export default function WorldSettings() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [ownerToken, setOwnerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/world", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to read world state");
      if (typeof data.autonomousEnabled !== "boolean") throw new Error("Worker needs the sleep-toggle update");
      setSnapshot(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load state");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function setAwake(enabled: boolean) {
    if (!ownerToken || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/world/control", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-world-owner-token": ownerToken },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change setting");
      if (typeof data.autonomousEnabled !== "boolean") throw new Error("Invalid Worker response");
      setSnapshot(s => s && ({ ...s, autonomousEnabled: data.autonomousEnabled }));
      setNotice(data.autonomousEnabled ? "Nimo is awake. Decisions will resume on the next eligible minute." :
        "Nimo is sleeping. New AI decisions are paused.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update sleep setting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="world-page">
      <p className="eyebrow">World 001 · owner controls</p>
      <h1>World settings</h1>
      <p className="lead">Temporarily pause autonomous thinking while testing. Nimo keeps his identity, memories, beliefs and journal.</p>
      <div className="world-card">
        <h2>Autonomous loop</h2>
        <p><strong>Current status: </strong>
          {snapshot ? snapshot.autonomousEnabled ? "Awake — enabled" : "Sleeping — paused" : "Loading…"}
        </p>
        <p className="meta">
          Cloudflare still checks every minute, but sleeping skips the OpenAI call.
          A request already in progress may still be billed.
        </p>
        <label htmlFor="world-owner-setting">Owner access token</label>
        <input id="world-owner-setting" type="password" autoComplete="off"
          value={ownerToken} onChange={e => setOwnerToken(e.target.value)}
          placeholder="Same token used to message Nimo" />
        <div className="voice-controls">
          <button type="button" disabled={busy || !snapshot?.autonomousEnabled || !ownerToken}
            onClick={() => void setAwake(false)}>Put Nimo to sleep</button>
          <button type="button" disabled={busy || !snapshot || snapshot.autonomousEnabled || !ownerToken}
            onClick={() => void setAwake(true)}>Wake Nimo up</button>
          <button type="button" onClick={() => void refresh()} disabled={busy}>Refresh status</button>
        </div>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <p><a href="/world">Return to Nimo's world</a></p>
    </div>
  );
}
