ALTER TABLE note_drafts ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE note_revisions ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE note_revisions ADD COLUMN score_snapshot INTEGER CHECK(score_snapshot BETWEEN 1 AND 10);
INSERT INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
