"""Small, source-grounded reading library for Nimo Core.

Book text lives in SQLite, outside the default model context. A chosen reading
segment is exposed on the NEXT decision only; nothing is auto-read or summarized.
"""
from __future__ import annotations

import hashlib
import os
import json
import re
import sqlite3
import urllib.error
import urllib.request
from typing import Callable

CATALOG = (
    {"id": "time_machine", "title": "The Time Machine", "author": "H. G. Wells",
     "subject": "Fiction and imagined futures", "license": "Project Gutenberg public-domain edition",
     "source": "https://www.gutenberg.org/ebooks/35",
     "parts": ("https://gutenberg.pglaf.org/cache/epub/35/pg35.txt",),
     "fallback_parts": ("https://mirror.cs.odu.edu/gutenberg-epub/35/pg35.txt",)},
    {"id": "beagle", "title": "The Voyage of the Beagle", "author": "Charles Darwin",
     "subject": "Natural history and exploration", "license": "Project Gutenberg public-domain edition",
     "source": "https://www.gutenberg.org/ebooks/944",
     "parts": ("https://gutenberg.pglaf.org/cache/epub/944/pg944.txt",),
     "fallback_parts": ("https://mirror.cs.odu.edu/gutenberg-epub/944/pg944.txt",)},
    {"id": "astronomy", "title": "A Short History of Astronomy", "author": "Arthur Berry",
     "subject": "History of science", "license": "Project Gutenberg public-domain edition",
     "source": "https://www.gutenberg.org/ebooks/59212",
     "parts": ("https://gutenberg.pglaf.org/cache/epub/59212/pg59212.txt",),
     "fallback_parts": ("https://mirror.cs.odu.edu/gutenberg-epub/59212/pg59212.txt",)},
    {"id": "programming", "title": "How to Think Like a Computer Scientist: Learning with Python 3",
     "author": "Peter Wentworth and contributors", "subject": "Programming and problem-solving",
     "license": "GNU Free Documentation License 1.3",
     "source": "https://github.com/HowToThink/HowToThink",
     "parts": (tuple(f"https://raw.githubusercontent.com/HowToThink/HowToThink/master/source/PvL_{n:02d}.rst"
                    for n in range(1, 8)) +
              tuple(f"https://raw.githubusercontent.com/HowToThink/HowToThink/master/source/PvL_{letter}.rst"
                    for letter in "ABCDEFGH"))},
)
if os.getenv("NIMO_CORE_SHORT_LIBRARY") == "1":
    CATALOG = ({
        "id": "small_observations", "title": "Small Observations", "author": "Nimo experiment editorial text",
        "subject": "Observation, hypotheses and natural phenomena",
        "license": "Original experiment text", "source": "bundled:small_observations",
        "parts": (), "segments": (
            """A compass needle is a small magnet. When free to rotate, it tends to align with the local magnetic field. Nearby iron or magnets can change that field. A compass that points in an unexpected direction does not by itself reveal the cause. Comparing its reading in different places, or with another compass, could distinguish some explanations. A single observation may be consistent with several hypotheses.""",
            """Plants exchange water with their surroundings. Water moves through roots and stems and evaporates from leaves. A brown leaf tip can have several causes, including dry air, irregular watering, excess dissolved salts or damage. The appearance alone is not a diagnosis. Changes over time, comparisons between leaves, and information about growing conditions can help narrow the possibilities.""",
            """A crack concentrates stress near its tip. In a brittle material such as ceramic, a crack can grow when the material is loaded. Its shape, the material and the direction of force matter. A visible crack does not tell us exactly when a cup will break. A drawing or written record can preserve its appearance for comparison later, without requiring a destructive test."""
        )
    },)
BOOKS = {item["id"]: item for item in CATALOG}
MAX_PART_BYTES = 3_000_000
WORDS_PER_SEGMENT = 1000


def setup(db: sqlite3.Connection) -> None:
    db.executescript("""
        CREATE TABLE IF NOT EXISTS library_books (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
          source TEXT NOT NULL, license TEXT NOT NULL, content_hash TEXT NOT NULL,
          acquired_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS library_segments (
          book_id TEXT NOT NULL REFERENCES library_books(id),
          segment_no INTEGER NOT NULL, content TEXT NOT NULL,
          PRIMARY KEY(book_id,segment_no)
        );
        CREATE TABLE IF NOT EXISTS library_reading (
          book_id TEXT PRIMARY KEY REFERENCES library_books(id),
          next_segment INTEGER NOT NULL DEFAULT 1,
          last_segment INTEGER, active INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS library_events (
          decision_id INTEGER PRIMARY KEY, action TEXT NOT NULL,
          data_json TEXT NOT NULL
        );
    """)
    db.commit()


def catalogue() -> list[dict]:
    return [{k: v for k, v in book.items() if k not in ("parts", "fallback_parts", "segments")}
            for book in CATALOG]


def context(db: sqlite3.Connection, last_decision: int) -> dict:
    owned = [dict(row) for row in db.execute("""
        SELECT b.id,b.title,r.next_segment,r.last_segment,r.active,
               (SELECT COUNT(*) FROM library_segments s WHERE s.book_id=b.id) AS total_segments
        FROM library_books b JOIN library_reading r ON b.id=r.book_id ORDER BY b.id
    """)]
    browsed = db.execute("SELECT 1 FROM library_events WHERE action='browse_library' LIMIT 1").fetchone() is not None
    result = {"library_available": True, "catalogue_browsed": browsed, "owned_books": owned}
    if browsed:
        result["library_catalogue"] = catalogue()
    event = db.execute("SELECT action,data_json FROM library_events WHERE decision_id=?",
                       (last_decision,)).fetchone()
    if event and event["action"] == "read_book":
        result["last_read_passage"] = json.loads(event["data_json"])
    return result


def actions(db: sqlite3.Connection) -> list[str]:
    result = ["browse_library"]
    browsed = db.execute("SELECT 1 FROM library_events WHERE action='browse_library' LIMIT 1").fetchone()
    if browsed and db.execute("SELECT COUNT(*) FROM library_books").fetchone()[0] < len(CATALOG):
        result.append("acquire_book")
    owned = db.execute("SELECT 1 FROM library_books LIMIT 1").fetchone()
    if owned:
        result.append("read_book")
    if db.execute("SELECT 1 FROM library_reading WHERE active=1 LIMIT 1").fetchone():
        result.append("put_down_book")
    return result


def record(db: sqlite3.Connection, decision_id: int, action: str, data: dict) -> None:
    db.execute("INSERT INTO library_events(decision_id,action,data_json) VALUES(?,?,?)",
               (decision_id,action,json.dumps(data,ensure_ascii=False,sort_keys=True)))


def browse(db: sqlite3.Connection, decision_id: int) -> str:
    record(db,decision_id,"browse_library",{"book_ids":list(BOOKS)})
    return "Browsed library: " + "; ".join(x["title"] for x in CATALOG)


def download_part(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent":"NimoCoreReadingExperiment/1.0"})
    with urllib.request.urlopen(req, timeout=35) as response:
        data = response.read(MAX_PART_BYTES+1)
    if len(data) > MAX_PART_BYTES:
        raise ValueError("Book source exceeds per-part size limit")
    return data.decode("utf-8-sig")


def fetch_book_parts(book: dict, fetch: Callable[[str], str]) -> tuple[list[str], list[str]]:
    """Fetch only after Nimo selects acquire; try fixed, trusted mirrors on failure.

    The mirror URL used is recorded for source provenance. Do not fall back
    to Gutenberg's main web site, which discourages automated downloads.
    """
    fallback_parts = book.get("fallback_parts", ())
    if fallback_parts and len(fallback_parts) != len(book["parts"]):
        raise ValueError("Invalid catalogue fallback configuration")
    contents, used_urls = [], []
    for index, primary_url in enumerate(book["parts"]):
        candidates = [primary_url]
        if fallback_parts:
            candidates.append(fallback_parts[index])
        errors = []
        for url in candidates:
            try:
                text = fetch(url)
                if len(text.strip()) < 400:
                    raise ValueError("Source text too short")
                # Never mistake an HTML error page for an ebook.
                if text.lstrip().lower().startswith(("<!doctype html", "<html")):
                    raise ValueError("Source returned HTML instead of book text")
                contents.append(text)
                used_urls.append(url)
                break
            except (OSError, UnicodeError, ValueError) as exc:
                errors.append(f"{url}: {type(exc).__name__}: {str(exc)[:130]}")
        else:
            raise RuntimeError("Book download failed on every approved source: " +
                               " | ".join(errors))
    return contents, used_urls


def strip_gutenberg_notice(content: str) -> str:
    """Only remove a recognised Gutenberg distribution notice, not book prose."""
    start = re.search(r"(?im)^\*{3} START OF THE PROJECT GUTENBERG EBOOK.*\*{3}\s*$", content)
    end = re.search(r"(?im)^\*{3} END OF THE PROJECT GUTENBERG EBOOK.*\*{3}\s*$", content)
    if start and end and end.start() > start.end():
        return content[start.end():end.start()].strip()
    return content


def split_text(content: str) -> list[str]:
    """Bound passage size without flattening code, indentation or line breaks."""
    blocks = re.split(r"\n[ \t]*\n", content.replace("\r\n", "\n"))
    segments, buffer, count = [], [], 0
    for block in blocks:
        if not block.strip():
            continue
        matches = list(re.finditer(r"\S+", block))
        # Preserve original source bytes within blocks, including code indentation.
        chunks = []
        for i in range(0, len(matches), WORDS_PER_SEGMENT):
            stop = min(i + WORDS_PER_SEGMENT, len(matches))
            start_offset = 0 if i == 0 else matches[i].start()
            end_offset = matches[stop].start() if stop < len(matches) else len(block)
            chunks.append(block[start_offset:end_offset])
        for chunk in chunks:
            n = len(chunk.split())
            if buffer and count + n > WORDS_PER_SEGMENT:
                segments.append("\n\n".join(buffer))
                buffer, count = [], 0
            buffer.append(chunk)
            count += n
    if buffer:
        segments.append("\n\n".join(buffer))
    return segments


def acquire(db: sqlite3.Connection, decision_id: int, book_id: str,
            fetch: Callable[[str],str] = download_part, timestamp: str = "") -> str:
    if book_id not in BOOKS:
        raise ValueError("Unknown catalogue book")
    if db.execute("SELECT 1 FROM library_books WHERE id=?",(book_id,)).fetchone():
        raise ValueError("Book already acquired")
    book = BOOKS[book_id]
    if "segments" in book:
        contents, downloaded_from = list(book["segments"]), [book["source"]]
    else:
        contents, downloaded_from = fetch_book_parts(book, fetch)
    full_text = "\n\n".join(contents)
    if book_id != "programming":
        full_text = strip_gutenberg_notice(full_text)
    if not full_text.strip() or len(full_text) < 400:
        raise ValueError("Book source is empty or unexpectedly short")
    segments = list(book["segments"]) if "segments" in book else split_text(full_text)
    if not segments:
        raise ValueError("Book has no readable segments")
    sha = hashlib.sha256(full_text.encode("utf8")).hexdigest()
    db.execute("INSERT INTO library_books VALUES(?,?,?,?,?,?,?)",
               (book_id,book["title"],book["author"],book["source"],book["license"],sha,timestamp))
    db.executemany("INSERT INTO library_segments VALUES(?,?,?)",
                   [(book_id,i+1,part) for i,part in enumerate(segments)])
    db.execute("INSERT INTO library_reading(book_id) VALUES(?)",(book_id,))
    record(db,decision_id,"acquire_book",{"book_id":book_id,"source":book["source"],
                                       "downloaded_from":downloaded_from,
                                       "content_sha256":sha,"total_segments":len(segments)})
    return f"Acquired {book['title']} ({len(segments)} segments; SHA-256 {sha[:12]})."


def read(db: sqlite3.Connection, decision_id: int, book_id: str, move: str) -> str:
    if move not in ("next","previous","repeat"):
        raise ValueError("Invalid reading movement")
    state = db.execute("SELECT next_segment,last_segment FROM library_reading WHERE book_id=?",
                       (book_id,)).fetchone()
    if not state:
        raise ValueError("Book has not been acquired")
    last = state["last_segment"]
    if move == "next":
        position = state["next_segment"]
    elif move == "previous":
        position = max(1,(last or 1)-1)
    else:
        position = last or 1
    row = db.execute("SELECT content FROM library_segments WHERE book_id=? AND segment_no=?",
                     (book_id,position)).fetchone()
    if not row:
        raise ValueError("No segment at requested position")
    db.execute("UPDATE library_reading SET next_segment=?,last_segment=?,active=1 WHERE book_id=?",
               (position+1,position,book_id))
    title = BOOKS[book_id]["title"]
    record(db,decision_id,"read_book",{"book_id":book_id,"title":title,
                                     "segment":position,"text":row["content"]})
    return f"Read {title}, segment {position} ({len(row['content'].split())} words)."


def put_down(db: sqlite3.Connection, decision_id: int) -> str:
    rows = db.execute("SELECT book_id,last_segment FROM library_reading WHERE active=1").fetchall()
    if not rows:
        raise ValueError("No open book to put down")
    db.execute("UPDATE library_reading SET active=0 WHERE active=1")
    record(db,decision_id,"put_down_book",{"books":[r["book_id"] for r in rows]})
    return "Put down " + ", ".join(BOOKS[r["book_id"]]["title"] for r in rows)
