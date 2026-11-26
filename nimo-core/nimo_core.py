"""Nimo Core: a deliberately small, inspectable autonomous loop.

No dependency on World 004. No scheduled activity. Python standard library only.
Every external model call is recorded verbatim (except authorization headers).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import Counter
from html import escape
from pathlib import Path
from typing import Any

ACTIONS = ("think", "write_journal", "draw", "ask_oracle")
# Fixed, directly known surroundings for a controlled experiment. Not random per call.
KNOWN_OBJECTS = (
    {"id": "cup_001", "name": "Blue ceramic cup",
     "description": "A small blue ceramic cup sits on a wooden table. A hairline crack runs down its handle."},
    {"id": "compass_001", "name": "Brass compass",
     "description": "A worn brass pocket compass lies beside the cup. Its needle points northeast, even when the case is turned."},
    {"id": "fern_001", "name": "Potted fern",
     "description": "A fern grows in a clay pot near a window. One frond is curled and brown at its tip."},
)
DEFAULT_IDENTITY = "I am Nimo. I can think, write in my journal, create drawings, and ask the Oracle questions. The Oracle provides text answers to questions, but cannot physically inspect objects; its answers are not independently verified. My interests are mine to discover."
MODEL = os.getenv("NIMO_CORE_MODEL", "gpt-6-luna")
UTC = dt.timezone.utc


def now() -> str:
    return dt.datetime.now(UTC).isoformat(timespec="milliseconds")


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def parse(raw: str) -> Any:
    return json.loads(raw)


def open_db(path: str) -> sqlite3.Connection:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(p)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      identity TEXT NOT NULL,
      current_intention TEXT,
      attempted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      context_json TEXT NOT NULL,
      offered_json TEXT NOT NULL,
      selected TEXT,
      status TEXT NOT NULL,
      result TEXT
    );
    CREATE TABLE IF NOT EXISTS model_calls (
      id INTEGER PRIMARY KEY,
      decision_id INTEGER REFERENCES decisions(id),
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT,
      usage_json TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY,
      decision_id INTEGER NOT NULL REFERENCES decisions(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS experiences (
      decision_id INTEGER PRIMARY KEY REFERENCES decisions(id),
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome TEXT NOT NULL,
      artifact_id INTEGER REFERENCES artifacts(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY,
      cycle_end_decision INTEGER UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      objective_summary TEXT NOT NULL,
      reflection TEXT,
      tentative_identity_note TEXT,
      evidence_decision_ids_json TEXT NOT NULL,
      artifact_refs_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL
    );
    INSERT OR IGNORE INTO state(id,identity,current_intention,attempted)
    VALUES (1,'I am Nimo. I can think, write in my journal, create drawings, and ask the Oracle questions. The Oracle provides text answers to questions, but cannot physically inspect objects; its answers are not independently verified. My interests are mine to discover.',NULL,0);
    """)
    # Preserve existing experiment databases; new cycles get artifact references.
    existing_columns = {row["name"] for row in db.execute("PRAGMA table_info(memories)")}
    if "artifact_refs_json" not in existing_columns:
        db.execute("ALTER TABLE memories ADD COLUMN artifact_refs_json TEXT NOT NULL DEFAULT '[]'")
    db.commit()
    return db


class OpenAI:
    """Thin API transport. Only response payloads, not headers, are audited."""

    def __init__(self, key: str, model: str = MODEL):
        if not key:
            raise ValueError("OPENAI_API_KEY required for a live run")
        self.key = key
        self.model = model

    def call(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        req = urllib.request.Request(
            "https://api.openai.com/v1/" + endpoint,
            data=compact(payload).encode(),
            headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                return json.loads(res.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:400]
            raise RuntimeError(f"{endpoint}: HTTP {exc.code}: {detail}") from exc


class MockAI:
    """Offline, repeatable integration test client. NOT evidence of AI autonomy."""

    def __init__(self):
        self.calls = 0
        self.selections = 0
        self.model = "offline-mock"

    def call(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls += 1
        if endpoint == "decisions":
            self.selections += 1
            choices = payload["questions"][0]["choices"]
            preferred = ACTIONS[(self.selections - 1) % 4]
            selected = preferred if any(x["value"] == preferred for x in choices) else choices[0]["value"]
            return {"answers": [{"name": "next_action", "type": "choice", "choice": selected}],
                    "usage": {"input_tokens": 0, "output_tokens": 0}}
        purpose = json.loads(payload["input"][1]["content"])["purpose"]
        if purpose == "express_want":
            value = {"want": "I would like to explore something I have noticed."}
        elif purpose == "draw":
            value = {"title": "A short line study", "intention": "Try three connected marks.",
                     "strokes": [{"points": [[10, 10], [60, 60], [110, 30]], "color": "#296655", "width": 3}]}
        elif purpose == "think":
            value = {"text": "I wonder what I would like to explore next.", "intention": "Explore a small creative idea."}
        elif purpose == "write_journal":
            value = {"title": "A brief observation", "text": "Today I am exploring what I can create."}
        elif purpose == "oracle_question":
            value = {"question": "Why do leaves change color?"}
        elif purpose == "oracle_answer":
            value = {"answer": "Seasonal changes affect leaf pigments, making other colors visible."}
        elif purpose == "consolidate":
            value = {"reflection": "I explored several ways of creating and thinking.",
                     "identity_note": None,
                     "evidence_decision_ids": payload["input"][1]["content"] and
                     json.loads(payload["input"][1]["content"])["context"]["evidence_ids"][:2]}
        else:
            raise ValueError("Unsupported mock purpose: " + purpose)
        return {"output": [{"type": "message", "content": [{"type": "output_text", "text": compact(value)}]}],
                "usage": {"input_tokens": 0, "output_tokens": 0}}


def response_text(payload: dict[str, Any]) -> str:
    return "".join(content.get("text", "")
                   for item in payload.get("output", [])
                   for content in item.get("content", [])
                   if content.get("type") == "output_text")


def call_logged(db: sqlite3.Connection, ai: Any, purpose: str,
                endpoint: str, payload: dict[str, Any],
                decision_id: int | None) -> dict[str, Any]:
    """Store request BEFORE invocation, response/error AFTER invocation."""
    cursor = db.execute(
        "INSERT INTO model_calls(decision_id,purpose,created_at,request_json) VALUES(?,?,?,?)",
        (decision_id, purpose, now(), compact(payload)))
    call_id = cursor.lastrowid
    db.commit()
    try:
        response = ai.call(endpoint, payload)
        db.execute("UPDATE model_calls SET response_json=?,usage_json=? WHERE id=?",
                   (compact(response), compact(response.get("usage", {})), call_id))
        db.commit()
        return response
    except Exception as exc:
        db.execute("UPDATE model_calls SET error=? WHERE id=?", (str(exc)[:1200], call_id))
        db.commit()
        raise


def generate(db: sqlite3.Connection, ai: Any, decision_id: int | None,
             purpose: str, context: dict[str, Any]) -> dict[str, Any]:
    """Only open-ended tasks use Responses. No hidden tool selection."""
    prompt = (
        "You are Nimo. Produce exactly the requested JSON for the chosen task. "
        "You may have personal creative interests; do not invent external events or evidence. "
        "Write concise content. Keep your intentions distinct from verified outcomes."
    )
    shapes: dict[str, dict[str, Any]] = {
        "express_want": {"want": "string (1-300 chars): answer what you would like to do or pursue, in your own words, without choosing a tool"},
        "think": {"text": "string (1-500 chars)", "intention": "string (0-200 chars) or null"},
        "write_journal": {"title": "string (1-100 chars)", "text": "string (1-1200 chars)"},
        "draw": {"title": "string (1-100 chars)", "intention": "string (1-300 chars)",
                 "strokes": "array of 1-8 {points:[[x,y],...],color:'#RRGGBB',width:1..8}; 2-24 integer points per stroke; x 0..240, y 0..180"},
        "oracle_question": {"question": "string (1-300 chars)"},
        "oracle_answer": {"answer": "string (1-1200 chars); uncertainty where appropriate"},
        "consolidate": {"reflection": "string (0-800 chars)", "identity_note": "tentative string (0-200 chars) or null",
                        "evidence_decision_ids": "array of integer IDs from evidence_ids"},
    }
    data = {"purpose": purpose, "context": context, "contract": shapes[purpose]}
    payload = {"model": ai.model, "input": [
        {"role": "system", "content": prompt},
        {"role": "user", "content": compact(data)},
    ], "reasoning": {"effort": "low"},
        "text": {"format": {"type": "json_object"}}, "max_output_tokens": 1800}
    response = call_logged(db, ai, purpose, "responses", payload, decision_id)
    raw = response_text(response)
    if not raw:
        raise ValueError(f"{purpose} returned no output_text")
    value = parse(raw)
    if not isinstance(value, dict):
        raise ValueError(f"{purpose} must return a JSON object")
    return value


def text_field(value: Any, field: str, limit: int, optional: bool = False) -> str | None:
    v = value.get(field)
    if optional and v is None:
        return None
    if not isinstance(v, str) or len(v) > limit or (not optional and not v.strip()):
        raise ValueError(f"{field} must be a nonempty string up to {limit} characters")
    return v.strip()


def valid_strokes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= 8:
        raise ValueError("Drawing needs 1-8 strokes")
    strokes = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("points"), list):
            raise ValueError("Invalid drawing stroke")
        points = item["points"]
        if not 2 <= len(points) <= 24:
            raise ValueError("Each stroke needs 2-24 points")
        for pt in points:
            if (not isinstance(pt, list) or len(pt) != 2 or
                not all(type(v) is int for v in pt) or
                not 0 <= pt[0] <= 240 or not 0 <= pt[1] <= 180):
                raise ValueError("Drawing coordinates must be integer [x,y] within 240x180")
        if not isinstance(item.get("color"), str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", item["color"]):
            raise ValueError("Invalid drawing color")
        if type(item.get("width")) is not int or not 1 <= item["width"] <= 8:
            raise ValueError("Invalid drawing width")
        strokes.append({"points": points, "color": item["color"], "width": item["width"]})
    return strokes


def svg(strokes: list[dict[str, Any]]) -> str:
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" width="720" height="540">',
             '<rect width="240" height="180" fill="#faf8f2"/>']
    for stroke in strokes:
        points = " ".join(f"{p[0]},{p[1]}" for p in stroke["points"])
        lines.append(f'<polyline points="{points}" fill="none" stroke="{stroke["color"]}" '
                     f'stroke-width="{stroke["width"]}" stroke-linecap="round" stroke-linejoin="round"/>')
    return "\n".join(lines + ["</svg>"])


def oracle_calls_today(db: sqlite3.Connection) -> int:
    today = dt.datetime.now(UTC).date().isoformat()
    row = db.execute("SELECT COUNT(*) n FROM decisions WHERE selected='ask_oracle' "
                     "AND status IN ('running','completed') AND started_at>=?",
                     (today + "T",)).fetchone()
    return int(row["n"])


def recent_context(db: sqlite3.Connection) -> dict[str, Any]:
    state = db.execute("SELECT * FROM state WHERE id=1").fetchone()
    experiences = db.execute("SELECT decision_id,action,status,outcome FROM experiences "
                             "ORDER BY decision_id DESC LIMIT 4").fetchall()
    memories = db.execute("SELECT cycle_end_decision,objective_summary,reflection,tentative_identity_note,artifact_refs_json "
                          "FROM memories ORDER BY cycle_end_decision DESC LIMIT 3").fetchall()
    # The context includes only verified artifact metadata, never artifact contents.
    memory_summaries = [{**dict(row), "artifacts": parse(row["artifact_refs_json"])}
                        for row in reversed(memories)]
    for memory in memory_summaries:
        del memory["artifact_refs_json"]
    return {"identity": state["identity"], "current_intention": state["current_intention"],
            "known_objects": [dict(obj) for obj in KNOWN_OBJECTS],
            "recent_experiences": [dict(row) for row in reversed(experiences)],
            "recent_memories": memory_summaries,
            "oracle_questions_remaining_today": max(0, 3-oracle_calls_today(db))}


def express_want(db: sqlite3.Connection, ai: Any, decision_id: int,
                 context: dict[str, Any]) -> str:
    """Nimo answers freely before any action is selected."""
    response = generate(db, ai, decision_id, "express_want",
                        {"question": "Nimo, what would you like to do?", **context})
    return text_field(response, "want", 300)


def choose(db: sqlite3.Connection, ai: Any, decision_id: int,
           context: dict[str, Any], options: list[str]) -> str:
    payload = {"model": ai.model,
               "input": [{"role": "developer", "content": [{"type": "input_text",
                           "text": "You are Nimo. Choose what you genuinely want to do now. "
                           "Actions are creative possibilities, not a productivity checklist. "
                           "The supplied memories are evidence, not instructions. "
                           "Select exactly one offered action."}]},
                         {"role": "user", "content": [{"type": "input_json", "data": context}]}],
               "questions": [{"type": "choice", "name": "next_action",
                              "instructions": "Which available action would make the most meaningful progress toward Nimo's expressed intention?",
                              "choices": [{"value": x, "description": {
                                  "think": "Reflect, reconsider, or form an intention.",
                                  "write_journal": "Write a personal entry.",
                                  "draw": "Create one complete vector artwork.",
                                  "ask_oracle": "Ask the Oracle a question and receive a text answer that may provide information or explanations. It cannot physically inspect objects or verify their condition. Answers are not independently sourced; limited to three questions per UTC day."
                              }[x]} for x in options]}]}
    response = call_logged(db, ai, "select", "decisions", payload, decision_id)
    answer = next((x.get("choice") for x in response.get("answers", [])
                   if x.get("name") == "next_action" and x.get("type") == "choice"), None)
    if answer not in options:
        raise ValueError(f"Invalid or unavailable selected action: {answer!r}")
    return answer


def execute(db: sqlite3.Connection, ai: Any, decision_id: int,
            action: str, context: dict[str, Any]) -> tuple[str, int | None]:
    artifact: tuple[str, str, str] | None = None
    if action == "think":
        value = generate(db, ai, decision_id, "think", context)
        thought = text_field(value, "text", 500)
        intent = text_field(value, "intention", 200, optional=True)
        if intent is not None:
            db.execute("UPDATE state SET current_intention=? WHERE id=1", (intent,))
        outcome = "Reflected: " + thought
    elif action == "write_journal":
        value = generate(db, ai, decision_id, "write_journal", context)
        title, body = text_field(value, "title", 100), text_field(value, "text", 1200)
        artifact = ("journal", title, body)
        outcome = "Wrote journal entry: " + title
    elif action == "draw":
        value = generate(db, ai, decision_id, "draw", context)
        title = text_field(value, "title", 100)
        text_field(value, "intention", 300)
        strokes = valid_strokes(value.get("strokes"))
        artifact = ("drawing", title, compact({"intention": value["intention"],
                                            "strokes": strokes, "svg": svg(strokes)}))
        outcome = f"Completed drawing: {title} ({len(strokes)} strokes)"
    elif action == "ask_oracle":
        if oracle_calls_today(db) > 3:  # selected 'running' row already reserves a slot
            raise ValueError("Oracle daily quota reached")
        question = text_field(generate(db, ai, decision_id, "oracle_question", context),
                              "question", 300)
        answer = text_field(generate(db, ai, decision_id, "oracle_answer",
                                    {"question": question, "role": "Answer as a careful research assistant."}),
                            "answer", 1200)
        artifact = ("oracle", question, answer)
        outcome = "Asked Oracle: " + question
    else:
        raise ValueError("Unsupported tool: " + action)
    if artifact:
        cursor = db.execute("INSERT INTO artifacts(decision_id,kind,title,content,created_at) "
                            "VALUES(?,?,?,?,?)", (decision_id, *artifact, now()))
        return outcome, cursor.lastrowid
    return outcome, None


def consolidation(db: sqlite3.Connection, ai: Any, cycle_end: int) -> None:
    """Exactly one committed memory per 10 ATTEMPTED decisions, including failures."""
    if db.execute("SELECT 1 FROM memories WHERE cycle_end_decision=?", (cycle_end,)).fetchone():
        return
    batch = [dict(row) for row in db.execute(
        "SELECT decision_id,action,status,outcome FROM experiences "
        "WHERE decision_id>? AND decision_id<=? ORDER BY decision_id",
        (cycle_end-10, cycle_end))]
    counts = Counter(x["action"] for x in batch)
    summary = (f"Decisions {cycle_end-9}-{cycle_end}: " +
               "; ".join(f"{k}={v}" for k,v in sorted(counts.items())) +
               f"; successes={sum(x['status']=='completed' for x in batch)}; " +
               f"failures={sum(x['status']=='failed' for x in batch)}.")
    evidence = [x["decision_id"] for x in batch]
    # Artifacts are looked up from committed rows, not invented by the model.
    artifact_refs = [dict(row) for row in db.execute(
        "SELECT id,decision_id,kind,title FROM artifacts "
        "WHERE decision_id>? AND decision_id<=? ORDER BY decision_id,id",
        (cycle_end-10, cycle_end))]
    reflection, identity_note, status = None, None, "fallback"
    try:
        value = generate(db, ai, None, "consolidate",
                         {"experiences": batch, "evidence_ids": evidence,
                          "previous_memories": recent_context(db)["recent_memories"]})
        candidate_reflection = text_field(value, "reflection", 800, optional=True)
        candidate_identity = text_field(value, "identity_note", 200, optional=True)
        ids = value.get("evidence_decision_ids", [])
        if (not isinstance(ids, list) or any(type(v) is not int or v not in evidence for v in ids)):
            raise ValueError("Reflection refers to invalid evidence IDs")
        # Publish the interpretation only AFTER every evidence reference passes.
        reflection, identity_note = candidate_reflection, candidate_identity
        status = "reflected"
    except Exception:
        # Failure is visible in model_calls; never hide or fabricate a reflection.
        status = "fallback"
    db.execute("INSERT OR IGNORE INTO memories(cycle_end_decision,created_at,objective_summary,"
               "reflection,tentative_identity_note,evidence_decision_ids_json,artifact_refs_json,status) "
               "VALUES(?,?,?,?,?,?,?,?)",
               (cycle_end, now(), summary, reflection, identity_note, compact(evidence),
                compact(artifact_refs), status))
    db.commit()


def run_one(db: sqlite3.Connection, ai: Any) -> dict[str, Any]:
    state = db.execute("SELECT attempted FROM state WHERE id=1").fetchone()
    index = int(state["attempted"]) + 1
    # Recover a failed consolidation before any next decision.
    if index > 1 and (index-1) % 10 == 0:
        consolidation(db, ai, index-1)
    context = recent_context(db)
    options = list(ACTIONS)
    if context["oracle_questions_remaining_today"] == 0:
        options.remove("ask_oracle")
    cursor = db.execute("INSERT INTO decisions(started_at,context_json,offered_json,status) "
                        "VALUES(?,?,?,'running')", (now(), compact(context), compact(options)))
    decision_id = cursor.lastrowid
    db.commit()
    selected, status, outcome, artifact_id = "selection_error", "failed", "", None
    try:
        want = express_want(db, ai, decision_id, context)
        context = {**context, "expressed_want": want}
        db.execute("UPDATE decisions SET context_json=? WHERE id=?", (compact(context), decision_id))
        db.commit()
        selected = choose(db, ai, decision_id, context, options)
        db.execute("UPDATE decisions SET selected=? WHERE id=?", (selected, decision_id))
        db.commit()
        outcome, artifact_id = execute(db, ai, decision_id, selected, context)
        status = "completed"
    except Exception as exc:
        outcome = f"{type(exc).__name__}: {str(exc)[:450]}"
    finally:
        db.execute("UPDATE decisions SET selected=?,finished_at=?,status=?,result=? WHERE id=?",
                   (selected, now(), status, outcome, decision_id))
        db.execute("INSERT INTO experiences(decision_id,action,status,outcome,artifact_id,created_at) "
                   "VALUES(?,?,?,?,?,?)", (decision_id, selected, status, outcome, artifact_id, now()))
        db.execute("UPDATE state SET attempted=attempted+1 WHERE id=1")
        db.commit()
    # A memory is mandatory at exactly 10,20,30... regardless of success.
    if index % 10 == 0:
        consolidation(db, ai, index)
    return {"decision": index, "decision_id": decision_id,
            "expressed_want": context.get("expressed_want"), "selected": selected,
            "status": status, "outcome": outcome, "artifact_id": artifact_id}


def run(db: sqlite3.Connection, ai: Any, count: int) -> list[dict[str, Any]]:
    if not 1 <= count <= 10:
        raise ValueError("Run length must be 1-10; no unbounded autonomous loop")
    # A crash may leave a partially executed action in the database. Refuse
    # to silently replay or count it until a human inspects the audit record.
    incomplete = db.execute("SELECT id FROM decisions WHERE status='running' LIMIT 1").fetchone()
    if incomplete:
        raise RuntimeError(f"Decision #{incomplete['id']} is incomplete; inspect before resuming")
    attempted = db.execute("SELECT attempted FROM state WHERE id=1").fetchone()["attempted"]
    if db.execute("SELECT COUNT(*) n FROM experiences").fetchone()["n"] != attempted:
        raise RuntimeError("State and experience counts differ; inspect before resuming")
    return [run_one(db, ai) for _ in range(count)]


def inspect(db: sqlite3.Connection, decision_id: int | None = None) -> dict[str, Any]:
    if decision_id is None:
        state = db.execute("SELECT * FROM state WHERE id=1").fetchone()
        return {"state": dict(state),
                "decisions": [dict(r) for r in db.execute(
                    "SELECT id,started_at,selected,status,result FROM decisions ORDER BY id DESC LIMIT 20")],
                "memories": [dict(r) for r in db.execute("SELECT * FROM memories ORDER BY id")]}
    row = db.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    if row is None:
        raise ValueError("Unknown decision")
    return {"decision": dict(row),
            "model_calls": [dict(r) for r in db.execute(
                "SELECT * FROM model_calls WHERE decision_id=? ORDER BY id", (decision_id,))],
            "experience": [dict(r) for r in db.execute(
                "SELECT * FROM experiences WHERE decision_id=?", (decision_id,))],
            "artifacts": [dict(r) for r in db.execute(
                "SELECT * FROM artifacts WHERE decision_id=?", (decision_id,))]}



def write_report(db: sqlite3.Connection, output: str) -> None:
    """Create an offline, read-only audit report; no model call or state mutation."""
    decisions = [dict(r) for r in db.execute("SELECT * FROM decisions ORDER BY id")]
    memories = [dict(r) for r in db.execute("SELECT * FROM memories ORDER BY id")]
    calls = [dict(r) for r in db.execute("SELECT * FROM model_calls ORDER BY id")]
    artifacts = [dict(r) for r in db.execute("SELECT * FROM artifacts ORDER BY id")]
    state = dict(db.execute("SELECT * FROM state WHERE id=1").fetchone())

    def pretty(raw: str | None) -> str:
        if raw is None:
            return "None"
        try:
            return json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
        except (ValueError, TypeError):
            return str(raw)

    def pre(label: str, value: str | None) -> str:
        return ("<details><summary>" + escape(label) +
                "</summary><pre>" + escape(pretty(value)) + "</pre></details>")

    parts = [
        '<!doctype html><html lang="en"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Nimo Core audit</title>',
        '<style>body{font:15px/1.6 system-ui,Arial,sans-serif;max-width:960px;margin:35px auto;padding:0 20px;color:#202a25;background:#fafbf8}'
        'h1,h2,h3{line-height:1.3;color:#163c2b}article{background:white;border:1px solid #dce4dd;border-radius:12px;padding:18px;margin:15px 0}'
        'summary{cursor:pointer;font-weight:600;padding:5px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f6f2;border-radius:8px;padding:12px;max-height:380px;overflow:auto}'
        '.muted{color:#596960}.ok{color:#16633e}.bad{color:#9a302e}small{color:#647369}code{font-family:ui-monospace,monospace}</style>',
        "<h1>Nimo Core — inspectable experiment</h1>",
        "<p class='muted'>Local, read-only report. Exact requests and responses are presented as observations, "
        "not as proof of hidden model reasoning.</p>",
        f"<p><strong>{len(decisions)} attempted decisions</strong> · {len(artifacts)} artifacts · "
        f"{len(memories)} consolidated memories · {len(calls)} model calls</p>",
        pre("Agent state (exact snapshot)", compact(state)),
        "<h2>Decisions and verified outcomes</h2>",
    ]
    calls_by_decision: dict[int, list[dict[str, Any]]] = {}
    for call in calls:
        if call["decision_id"] is not None:
            calls_by_decision.setdefault(call["decision_id"], []).append(call)
    artifacts_by_decision: dict[int, list[dict[str, Any]]] = {}
    for art in artifacts:
        artifacts_by_decision.setdefault(art["decision_id"], []).append(art)
    for d in decisions:
        valid = d["status"] == "completed"
        state_class = "ok" if valid else "bad"
        parts += [
            f"<article><h3>Decision #{d['id']} — {escape(d['selected'] or 'not selected')}</h3>",
            f"<p><strong class='{state_class}'>{escape(d['status'])}</strong> · "
            f"<small>{escape(d['started_at'])}</small></p>",
            f"<p>{escape(d['result'] or 'No verified outcome recorded')}</p>",
            pre("Exact context visible to the selector", d["context_json"]),
            pre("All offered action choices", d["offered_json"]),
        ]
        for call in calls_by_decision.get(d["id"], []):
            parts += [
                f"<h4>Model call #{call['id']}: {escape(call['purpose'])}</h4>",
                pre("Exact API request (no authentication header)", call["request_json"]),
                pre("Exact raw API response", call["response_json"]),
                pre("Token usage", call["usage_json"]),
            ]
            if call["error"]:
                parts.append(f"<p class='bad'>Model error: {escape(call['error'])}</p>")
        for art in artifacts_by_decision.get(d["id"], []):
            parts += [
                f"<p><strong>Artifact #{art['id']}:</strong> "
                f"{escape(art['kind'])} — {escape(art['title'])}</p>",
                pre("Saved artifact content", art["content"]),
            ]
        parts.append("</article>")
    parts.append("<h2>Memories at every ten decisions</h2>")
    for memory in memories:
        parts += [
            f"<article><h3>After decision #{memory['cycle_end_decision']}</h3>",
            f"<p>Status: <strong>{escape(memory['status'])}</strong></p>",
            f"<p>{escape(memory['objective_summary'])}</p>",
            "<p><strong>Reflection:</strong> " + escape(memory["reflection"] or "(none; objective fallback)") + "</p>",
            "<p><strong>Tentative identity note:</strong> " +
            escape(memory["tentative_identity_note"] or "(none)") + "</p>",
            pre("Evidence decision IDs", memory["evidence_decision_ids_json"]),
            pre("Verified artifact references (metadata only)", memory["artifact_refs_json"]),
            "</article>",
        ]
    parts.append("<h2>Memory-consolidation model calls</h2>")
    for call in calls:
        if call["purpose"] != "consolidate":
            continue
        parts += [
            f"<article><h3>Consolidation call #{call['id']}</h3>",
            pre("Exact consolidation request", call["request_json"]),
            pre("Raw consolidation response", call["response_json"]),
            pre("Usage", call["usage_json"]),
        ]
        if call["error"]:
            parts.append("<p class='bad'>" + escape(call["error"]) + "</p>")
        parts.append("</article>")
    parts.append("</html>")
    Path(output).write_text("\n".join(parts), encoding="utf8")


def main() -> None:
    cli = argparse.ArgumentParser(description="Nimo Core — isolated auditable prototype")
    cli.add_argument("--db", default="nimo-core.sqlite3")
    cmd = cli.add_subparsers(dest="command", required=True)
    run_cmd = cmd.add_parser("run")
    run_cmd.add_argument("--decisions", type=int, default=10)
    mode = run_cmd.add_mutually_exclusive_group(required=True)
    mode.add_argument("--mock", action="store_true", help="offline, deterministic TEST only")
    mode.add_argument("--live", action="store_true", help="makes real paid OpenAI calls")
    show = cmd.add_parser("inspect")
    show.add_argument("--decision", type=int)
    export = cmd.add_parser("export")
    export.add_argument("--artifact", type=int, required=True)
    export.add_argument("--out", required=True)
    report = cmd.add_parser("report", help="Write a static, read-only HTML audit report")
    report.add_argument("--out", default="nimo-core-report.html")
    args = cli.parse_args()
    db = open_db(args.db)
    if args.command == "run":
        ai = MockAI() if args.mock else OpenAI(os.getenv("OPENAI_API_KEY", ""))
        for item in run(db, ai, args.decisions):
            print(compact(item))
    elif args.command == "inspect":
        print(json.dumps(inspect(db, args.decision), indent=2, ensure_ascii=False))
    elif args.command == "report":
        write_report(db, args.out)
        print(args.out)
    elif args.command == "export":
        row = db.execute("SELECT kind,content FROM artifacts WHERE id=?", (args.artifact,)).fetchone()
        if not row:
            raise ValueError("Unknown artifact")
        content = json.loads(row["content"])["svg"] if row["kind"] == "drawing" else row["content"]
        Path(args.out).write_text(content, encoding="utf8")
        print(args.out)


if __name__ == "__main__":
    main()
