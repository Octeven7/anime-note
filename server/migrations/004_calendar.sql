CREATE TABLE calendar_cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload)),fetched_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
