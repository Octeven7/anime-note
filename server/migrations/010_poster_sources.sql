CREATE TABLE poster_sources(subject_id TEXT PRIMARY KEY REFERENCES subjects(id), checked_at TEXT NOT NULL,status TEXT NOT NULL,retry_at INTEGER);
INSERT INTO schema_migrations VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
