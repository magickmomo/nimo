"use client";

import { useCallback, useEffect, useState } from "react";
import "../world.css";

type WorldSnapshot = {
  autonomousEnabled: boolean;
  journey?: { status: "idle" | "travelling" | "paused"; stepIndex: number; path: {x:number;y:number}[] };
  world: { state: { tickCount: number; lastTick: string | null } };
};

export default function WorldSettings() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [ownerToken, setOwnerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn,setSignedIn]=useState(false);

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

  useEffect(() => { void refresh(); void fetch("/api/world/session",{cache:"no-store"}).then(r=>r.json()).then(d=>setSignedIn(Boolean(d.authenticated))).catch(()=>{}); }, [refresh]);

  async function signIn() {
    if(!ownerToken)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/world/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:ownerToken})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw Error(body.error||"Unable to sign in");
      setSignedIn(true);setNotice("This browser is signed in for Messages, hunger settings and exports. No token is needed when messaging.");
    }catch(err){setError(err instanceof Error?err.message:"Sign-in failed");}
    finally{setBusy(false);}
  }


  async function signOut() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/world/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not sign out");
      setSignedIn(false);
      setOwnerToken("");
      setNotice("Signed out on this device.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign out");
    } finally { setBusy(false); }
  }

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
      setNotice(data.autonomousEnabled ? "Nimo is awake. A paused journey resumes, or a new decision becomes eligible at the next scheduled check." :
        "Nimo is sleeping. Decisions and active travel are paused.");
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
      <p className="lead">Pause both autonomous decisions and ongoing journeys. Nimo keeps his position, identity, memories, beliefs and journal.</p>
      <div className="world-card">
        <h2>Owner sign-in</h2>
        <p>Sign in once on this device to send Nimo messages without entering a token each time, export his history and adjust the hunger rate.</p>
        <p><strong>Status: </strong>{signedIn?"Signed in":"Not signed in"}</p>
        <label htmlFor="world-owner-setting">Owner access token</label>
        <input id="world-owner-setting" type="password" autoComplete="off"
          value={ownerToken} onChange={e => setOwnerToken(e.target.value)}
          placeholder="Same token used to message Nimo" />

        <button type="button" disabled={!ownerToken||busy} onClick={()=>void signIn()}>Sign in on this device</button>
        {signedIn && <button type="button" disabled={busy} onClick={()=>void signOut()}>Sign out on this device</button>}
        <p className="meta">The same token also controls Sleep / Wake below. A signed HttpOnly cookie keeps it out of the chat form.</p>
      </div>
      <div className="world-card">
        <h2>Autonomous loop</h2>
        {snapshot?.journey && snapshot.journey.status !== "idle" && <p className="meta">Journey: {snapshot.journey.status} · {snapshot.journey.stepIndex} of {Math.max(0,snapshot.journey.path.length-1)} steps completed.</p>}
        <p><strong>Current status: </strong>
          {snapshot ? snapshot.autonomousEnabled ? "Awake — enabled" : "Sleeping — paused" : "Loading…"}
        </p>
        <p className="meta">
          Cloudflare uses a minute-level cron with faster checks while awake. Sleep pauses walking and skips new OpenAI calls.
          A request already in progress may still be billed.
        </p>
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
