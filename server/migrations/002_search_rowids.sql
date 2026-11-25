-- Align FTS rowids with the stable SQLite rowids of subjects.
-- Refreshing an entry can then delete by rowid instead of scanning all FTS rows.
DELETE FROM subject_search;
INSERT INTO subject_search(rowid,subject_id,text) SELECT rowid,id,search_text FROM subjects;
INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
