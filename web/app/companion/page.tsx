"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechErrorEvent = { error: string };
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionConstructor = new () => BrowserRecognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export default function Companion() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [error, setError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [recognitionAvailable, setRecognitionAvailable] = useState(false);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const voiceEnabledRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setRecognitionAvailable(Boolean(recognitionConstructor()));
    return () => {
      mountedRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  const sendText = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const next: Message[] = [...messagesRef.current, { role: "user", content: value }];
    messagesRef.current = next;
    setMessages(next);
    setDraft("");
    window.speechSynthesis?.cancel();
    try {
      const res = await fetch("/api/companion/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Request failed");
      if (typeof body.reply !== "string") throw new Error("Invalid reply");
      const updated: Message[] = [...next, { role: "assistant", content: body.reply }];
      messagesRef.current = updated;
      if (!mountedRef.current) return;
      setMessages(updated);
      if (voiceEnabledRef.current && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(body.reply);
        utterance.lang = "en-GB";
        utterance.rate = 1;
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  function startListening() {
    if (listening || busyRef.current) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setVoiceError("Speech recognition isn't supported in this browser. You can still type to Nimo.");
      return;
    }
    window.speechSynthesis?.cancel();
    setVoiceError("");
    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setDraft(transcript);
        void sendText(transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        setVoiceError(`Microphone error: ${event.error}. Check microphone permission or try typing.`);
      }
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setVoiceError("Couldn't start the microphone. Check browser permissions.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleVoice() {
    const next = !voiceEnabledRef.current;
    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    if (!next) window.speechSynthesis?.cancel();
  }

  return (
    <>
      <p className="eyebrow">Companion · voice experiment</p>
      <h1>Talk to Nimo</h1>
      <p className="lead">Talk through your laptop's microphone or type a message. Nimo can speak his answers using your browser's available voices.</p>
      <div className="chat">
        <div className="messages" aria-live="polite">
          {messages.length === 0 ? <p className="meta">Say hello to begin.</p> : messages.map((m, i) =>
            <div className={"bubble " + m.role} key={i}><strong>{m.role === "user" ? "You" : "Nimo"}</strong><div>{m.content}</div></div>
          )}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void sendText(draft); }}>
          <label htmlFor="message">Your message</label>
          <input id="message" maxLength={1200} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Hello Nimo" />
          <div className="voice-controls">
            <button type="submit" disabled={busy || !draft.trim()}> {busy ? "Thinking…" : "Send"} </button>
            <button type="button" onClick={listening ? stopListening : startListening} disabled={busy || !recognitionAvailable} aria-pressed={listening}>
              {listening ? "Stop listening" : "Speak to Nimo"}
            </button>
            <button type="button" onClick={toggleVoice} aria-pressed={voiceEnabled}>
              Voice replies: {voiceEnabled ? "On" : "Off"}
            </button>
            <button type="button" onClick={() => window.speechSynthesis?.cancel()}>Stop speaking</button>
          </div>
        </form>
        {listening && <p className="meta" role="status">Listening… speak now.</p>}
        {!recognitionAvailable && <p className="meta">Speech recognition isn't available here. Try Chrome or Edge, or use the text field.</p>}
        {voiceError && <p className="error" role="alert">{voiceError}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="meta">Your browser may use an external service for speech recognition. Voice input requires microphone permission and HTTPS (or localhost). Chat history is not stored permanently. Nimo's physical OLED isn't connected to this chat yet.</p>
      </div>
    </>
  );
}
