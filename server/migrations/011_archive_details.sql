CREATE TABLE archive_records (
  dataset TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(dataset,record_key)
) WITHOUT ROWID;

CREATE TABLE archive_infoboxes (
  subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
  fields TEXT NOT NULL CHECK(json_valid(fields))
);

INSERT INTO schema_migrations VALUES(11,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
