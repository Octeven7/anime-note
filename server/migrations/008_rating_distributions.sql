CREATE TABLE subject_ratings (
 subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
 counts TEXT NOT NULL,
 total INTEGER NOT NULL CHECK(total>=0),
 sum INTEGER NOT NULL CHECK(sum>=0),
 fetched_at TEXT NOT NULL,
 source TEXT NOT NULL,
 last_attempt_at TEXT,
 last_error TEXT
);
INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
