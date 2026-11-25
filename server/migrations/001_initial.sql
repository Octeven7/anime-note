CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO users VALUES ('local-user', '我', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE subjects (
 id TEXT PRIMARY KEY, bangumi_id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, name_cn TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '', air_date TEXT, platform TEXT NOT NULL DEFAULT '', score REAL,
 rating_count INTEGER, rank INTEGER, nsfw INTEGER NOT NULL DEFAULT 0 CHECK(nsfw IN (0,1)),
 image_url TEXT, search_text TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX subjects_date ON subjects(air_date);
CREATE INDEX subjects_score ON subjects(score DESC, rating_count DESC);
CREATE TABLE subject_aliases(subject_id TEXT REFERENCES subjects(id), name TEXT NOT NULL, PRIMARY KEY(subject_id,name));
CREATE TABLE subject_tags(subject_id TEXT REFERENCES subjects(id), tag TEXT NOT NULL, PRIMARY KEY(subject_id,tag));
CREATE INDEX tags_lookup ON subject_tags(tag,subject_id);
CREATE VIRTUAL TABLE subject_search USING fts5(subject_id UNINDEXED, text, tokenize='trigram');

CREATE TABLE source_records (
 subject_id TEXT PRIMARY KEY REFERENCES subjects(id), source TEXT NOT NULL CHECK(source='bangumi'),
 payload TEXT NOT NULL CHECK(json_valid(payload)), fetched_at TEXT NOT NULL, detail_complete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE episodes (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), bangumi_id INTEGER NOT NULL UNIQUE,
 sort REAL NOT NULL, type INTEGER NOT NULL, name TEXT NOT NULL, name_cn TEXT NOT NULL DEFAULT '', air_date TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(id,subject_id)
);
CREATE INDEX episodes_subject ON episodes(subject_id,type,sort);
CREATE TABLE characters(id TEXT PRIMARY KEY,bangumi_id INTEGER NOT NULL UNIQUE,name TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE persons(id TEXT PRIMARY KEY,bangumi_id INTEGER NOT NULL UNIQUE,name TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE subject_characters(subject_id TEXT REFERENCES subjects(id),character_id TEXT REFERENCES characters(id),relation TEXT,PRIMARY KEY(subject_id,character_id));
CREATE TABLE subject_staff(subject_id TEXT REFERENCES subjects(id),person_id TEXT REFERENCES persons(id),relation TEXT NOT NULL,PRIMARY KEY(subject_id,person_id,relation));
CREATE TABLE character_voices(subject_id TEXT REFERENCES subjects(id),character_id TEXT REFERENCES characters(id),person_id TEXT REFERENCES persons(id),PRIMARY KEY(subject_id,character_id,person_id));

CREATE TABLE collections(user_id TEXT REFERENCES users(id),subject_id TEXT REFERENCES subjects(id),status TEXT NOT NULL CHECK(status IN ('wish','doing','done','hold','dropped')),updated_at TEXT NOT NULL,PRIMARY KEY(user_id,subject_id));
CREATE TABLE watch_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT NOT NULL REFERENCES subjects(id),episode_id TEXT NOT NULL,watched_at TEXT NOT NULL,FOREIGN KEY(episode_id,subject_id) REFERENCES episodes(id,subject_id));
CREATE TABLE notes (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT NOT NULL REFERENCES subjects(id),episode_id TEXT,
 scope TEXT NOT NULL CHECK(scope IN ('episode','overall')),created_at TEXT NOT NULL,deleted_at TEXT,
 CHECK((scope='episode' AND episode_id IS NOT NULL) OR (scope='overall' AND episode_id IS NULL)),
 FOREIGN KEY(episode_id,subject_id) REFERENCES episodes(id,subject_id)
);
CREATE TABLE note_revisions (
 id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id),version INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','published')),body TEXT NOT NULL DEFAULT '',
 feeling TEXT CHECK(feeling IN ('awful','weak','fair','good','masterpiece')),
 scenes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scenes)),is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
 spoiler INTEGER CHECK(spoiler IN (0,1)),created_at TEXT NOT NULL,
 CHECK(state='draft' OR is_public=0 OR spoiler IS NOT NULL),UNIQUE(note_id,version)
);
CREATE TABLE overall_ratings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT NOT NULL REFERENCES subjects(id),score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),rated_at TEXT NOT NULL);
CREATE INDEX ratings_latest ON overall_ratings(user_id,subject_id,rated_at DESC);
CREATE TABLE import_runs(id TEXT PRIMARY KEY,source TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,processed INTEGER NOT NULL DEFAULT 0,error TEXT);
INSERT INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
