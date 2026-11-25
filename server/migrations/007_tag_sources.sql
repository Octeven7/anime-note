CREATE TABLE subject_tag_sets (
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  source TEXT NOT NULL,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(subject_id,source)
);
CREATE INDEX subject_tag_sets_source ON subject_tag_sets(source,subject_id);
INSERT INTO subject_tag_sets(subject_id,source,tags,fetched_at)
SELECT t.subject_id,CASE WHEN r.detail_complete=1 THEN 'api' ELSE 'archive' END,
       json_group_array(t.tag),COALESCE(r.fetched_at,'')
FROM subject_tags t LEFT JOIN source_records r ON r.subject_id=t.subject_id GROUP BY t.subject_id;
CREATE TABLE subject_metadata_sync (
  subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
  fetched_at TEXT,
  last_attempt_at TEXT NOT NULL,
  last_error TEXT,
  payload TEXT CHECK(payload IS NULL OR json_valid(payload))
);
CREATE TABLE tag_query_sync (
  tag TEXT PRIMARY KEY, fetched_at TEXT, last_attempt_at TEXT NOT NULL,
  last_error TEXT, matched INTEGER
);
INSERT INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
