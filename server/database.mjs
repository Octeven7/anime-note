import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { backfillRatings } from './ratings.mjs';
import { compactCatalog } from './compact.mjs';

export function openDatabase(
  filename = process.env.DATABASE_PATH || resolve('data/anime-note.sqlite'),
) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const initialized = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!initialized) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  let version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  if (version === 1) {
    transaction(db, () =>
      db.exec(readFileSync(new URL('./migrations/002_search_rowids.sql', import.meta.url), 'utf8')),
    );
    version = 2;
  }
  if (version === 2) {
    transaction(db, () =>
      db.exec(readFileSync(new URL('./migrations/003_personal_data.sql', import.meta.url), 'utf8')),
    );
    version = 3;
  }
  if (version === 3) {
    transaction(db, () =>
      db.exec(readFileSync(new URL('./migrations/004_calendar.sql', import.meta.url), 'utf8')),
    );
    version = 4;
  }
  if (version === 4) {
    transaction(db, () =>
      db.exec(
        readFileSync(new URL('./migrations/005_rating_revisions.sql', import.meta.url), 'utf8'),
      ),
    );
    version = 5;
  }
  if (version === 5) {
    transaction(db, () =>
      db.exec(readFileSync(new URL('./migrations/006_note_titles.sql', import.meta.url), 'utf8')),
    );
    version = 6;
  }
  if (version === 6) {
    transaction(db, () =>
      db.exec(readFileSync(new URL('./migrations/007_tag_sources.sql', import.meta.url), 'utf8')),
    );
    version = 7;
  }
  if (version === 7) {
    transaction(db, () => {
      db.exec(
        readFileSync(new URL('./migrations/008_rating_distributions.sql', import.meta.url), 'utf8'),
      );
      backfillRatings(db);
    });
    version = 8;
  }
  if (version === 8) {
    transaction(db, () => {
      compactCatalog(db);
      db.exec(
        readFileSync(new URL('./migrations/009_compact_catalog.sql', import.meta.url), 'utf8'),
      );
    });
    version = 9;
  }
  if (version === 9) {
    transaction(db, () =>
      db.exec(
        readFileSync(new URL('./migrations/010_poster_sources.sql', import.meta.url), 'utf8'),
      ),
    );
    version = 10;
  }
  if (version !== 10) {
    db.close();
    throw new Error(`Unsupported database version: ${version}`);
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
