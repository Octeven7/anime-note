ALTER TABLE overall_ratings ADD COLUMN revision_id TEXT REFERENCES note_revisions(id);
CREATE UNIQUE INDEX rating_revision ON overall_ratings(revision_id) WHERE revision_id IS NOT NULL;
INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
