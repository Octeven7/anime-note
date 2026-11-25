ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN published_revision_id TEXT REFERENCES note_revisions(id);
UPDATE notes SET updated_at=created_at;
CREATE TABLE note_drafts (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),body TEXT NOT NULL DEFAULT '',
 feeling TEXT CHECK(feeling IN ('awful','weak','fair','good','masterpiece')),
 scenes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scenes)),
 is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),updated_at TEXT NOT NULL
);
CREATE TABLE episode_progress (
 user_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT NOT NULL REFERENCES subjects(id),
 episode_id TEXT NOT NULL,watched INTEGER NOT NULL CHECK(watched IN (0,1)),updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,episode_id),FOREIGN KEY(episode_id,subject_id) REFERENCES episodes(id,subject_id)
);
CREATE TABLE idempotency_keys (
 user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,request_hash TEXT NOT NULL,
 resource_id TEXT NOT NULL REFERENCES notes(id),PRIMARY KEY(user_id,key)
);
CREATE INDEX notes_owner_subject ON notes(user_id,subject_id,deleted_at,updated_at DESC);
CREATE INDEX revisions_note ON note_revisions(note_id,version DESC);
CREATE INDEX watches_owner ON watch_events(user_id,subject_id,watched_at DESC);
INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
