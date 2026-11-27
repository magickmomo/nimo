CREATE TABLE IF NOT EXISTS structured_thoughts (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  trace_id INTEGER NOT NULL UNIQUE,
  thought_json TEXT NOT NULL CHECK(json_valid(thought_json))
);
