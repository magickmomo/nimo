"""Offline export of Nimo Core's server-side experiment audit.

Reads the exact run SQLite; never calls a model or mutates the database.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3


def summarise(db_path: str) -> dict:
    db = sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        decisions = []
        for row in db.execute(
            "SELECT id, selected, status, result, context_json FROM decisions ORDER BY id"
        ):
            context = json.loads(row["context_json"])
            decisions.append({
                "id": row["id"],
                "want": context.get("expressed_want"),
                "action": row["selected"],
                "status": row["status"],
                "result": row["result"],
            })
        artifacts = [dict(x) for x in db.execute(
            "SELECT id,decision_id,kind,title,content FROM artifacts ORDER BY decision_id,id"
        )]
        for artifact in artifacts:
            # The standalone HTML audit retains the full artifact body.
            artifact.pop("content")
        thinking = [dict(x) for x in db.execute(
            "SELECT decision_id,purpose,assessment,next_step,evidence_decision_ids_json "
            "FROM think_notes ORDER BY decision_id"
        )]
        for thought in thinking:
            thought["evidence_decision_ids"] = json.loads(thought.pop("evidence_decision_ids_json"))
        memories = [dict(x) for x in db.execute(
            "SELECT cycle_end_decision,objective_summary,reflection,tentative_identity_note,status "
            "FROM memories ORDER BY cycle_end_decision"
        )]
        books = [dict(x) for x in db.execute(
            "SELECT b.id,b.title,b.author,b.source,b.content_hash,"
            "COUNT(s.segment_no) AS total_segments,r.next_segment,r.last_segment "
            "FROM library_books b JOIN library_reading r ON r.book_id=b.id "
            "LEFT JOIN library_segments s ON s.book_id=b.id "
            "GROUP BY b.id ORDER BY b.id"
        )]
        library_events = [dict(x) for x in db.execute(
            "SELECT decision_id,action,data_json FROM library_events ORDER BY decision_id"
        )]
        for event in library_events:
            data = json.loads(event.pop("data_json"))
            if event["action"] == "read_book":
                # The source passage is preserved in SQLite + HTML, not duplicated here.
                event["book_id"] = data.get("book_id")
                event["segment"] = data.get("segment")
                event["word_count"] = len(data.get("text", "").split())
            else:
                event["details"] = data
        calls = [dict(x) for x in db.execute(
            "SELECT id,decision_id,purpose,usage_json,error FROM model_calls ORDER BY id"
        )]
        for call in calls:
            usage = json.loads(call.pop("usage_json") or "{}")
            call["usage"] = usage
        counts = Counter(d["action"] for d in decisions)
        return {
            "decision_count": len(decisions),
            "completed_count": sum(d["status"] == "completed" for d in decisions),
            "failed_count": sum(d["status"] == "failed" for d in decisions),
            "action_counts": dict(sorted(counts.items())),
            "model_call_count": len(calls),
            "model_calls": calls,
            "decisions": decisions,
            "artifacts": artifacts,
            "thinking": thinking,
            "memories": memories,
            "books": books,
            "library_events": library_events,
        }
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Nimo's immutable server experiment evidence")
    parser.add_argument("--db", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    summary = summarise(args.db)
    Path(args.out).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    brief = {
        "decision_count": summary["decision_count"],
        "completed_count": summary["completed_count"],
        "failed_count": summary["failed_count"],
        "action_counts": summary["action_counts"],
        "model_call_count": summary["model_call_count"],
        "book_titles": [book["title"] for book in summary["books"]],
        "read_segments": sum(e["action"] == "read_book" for e in summary["library_events"]),
        "artifact_titles": [a["title"] for a in summary["artifacts"]],
        "thinking_count": len(summary["thinking"]),
    }
    print("NIMO50_SUMMARY=" + json.dumps(brief, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
