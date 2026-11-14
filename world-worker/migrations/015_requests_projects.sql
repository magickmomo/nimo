-- Owner request inbox and self-directed projects. Non-destructive addition.
CREATE TABLE IF NOT EXISTS creator_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 source_event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
 dedupe_key TEXT NOT NULL UNIQUE,
 content TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','accepted','rejected','implemented')),
 times_asked INTEGER NOT NULL DEFAULT 1,
 last_event_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS creator_requests_status ON creator_requests(status,id DESC);
INSERT OR IGNORE INTO creator_requests(source_event_id,dedupe_key,content,last_event_id,created_at,updated_at)
SELECT MIN(id),LOWER(TRIM(SUBSTR(content,1,240))),MAX(content),MAX(id),MIN(created_at),MAX(created_at)
FROM events WHERE kind='request' OR action='REQUEST'
GROUP BY LOWER(TRIM(SUBSTR(content,1,240))) HAVING LENGTH(TRIM(content))>0;
CREATE TABLE IF NOT EXISTS nimo_projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 objective TEXT NOT NULL,
 next_step TEXT NOT NULL,
 progress_note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','abandoned')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS nimo_projects_status ON nimo_projects(status,updated_at DESC);
