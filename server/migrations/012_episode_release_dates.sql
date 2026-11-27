CREATE INDEX episodes_release_dates ON episodes(air_date, subject_id) WHERE type=0 AND sort>0;

INSERT INTO schema_migrations VALUES(12,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
