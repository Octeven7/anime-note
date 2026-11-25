import { openDatabase, transaction } from './database.mjs';
import { BangumiClient } from './bangumi.mjs';
import { storeBundle, upsertSubject } from './catalog.mjs';
import { createReadStream, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2),
  db = openDatabase();
try {
  if (args[0] === 'subject') {
    if (args.length < 2) throw new Error('Provide Bangumi subject IDs');
    const client = new BangumiClient();
    for (const value of args.slice(1)) {
      const bundle = await client.subjectBundle(Number(value));
      const id = storeBundle(db, bundle);
      console.log(
        JSON.stringify({
          id,
          bangumiId: bundle.subject.id,
          name: bundle.subject.name_cn || bundle.subject.name,
          episodes: bundle.episodes.length,
          characters: bundle.characters.length,
          persons: bundle.persons.length,
        }),
      );
    }
  } else if (args[0] === 'archive') {
    const path = args[1];
    if (!path || !existsSync(path))
      throw new Error('Provide an extracted subject.jsonlines file (.gz also supported)');
    const run = randomUUID();
    db.prepare("INSERT INTO import_runs(id,source,started_at) VALUES(?,'bangumi-archive',?)").run(
      run,
      new Date().toISOString(),
    );
    const interrupt = () => {
      db.prepare('UPDATE import_runs SET finished_at=?,error=? WHERE id=?').run(
        new Date().toISOString(),
        '导入被中断，已提交批次保留；可以安全重跑',
        run,
      );
      db.close();
      process.exit(130);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    let processed = 0,
      lines = 0,
      batch = [];
    const flush = () => {
      if (!batch.length) return;
      transaction(db, () => {
        for (const raw of batch) upsertSubject(db, raw);
        db.prepare('UPDATE import_runs SET processed=? WHERE id=?').run(
          processed + batch.length,
          run,
        );
      });
      processed += batch.length;
      batch = [];
    };
    try {
      const stream = path.endsWith('.gz')
        ? createReadStream(path).pipe(createGunzip())
        : createReadStream(path);
      for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
        lines++;
        if (!line.trim()) continue;
        const raw = JSON.parse(line);
        if (raw.type !== 2) continue;
        batch.push(raw);
        if (batch.length >= 500) {
          flush();
          console.log(`Imported ${processed} animation subjects`);
        }
      }
      flush();
      db.prepare('UPDATE import_runs SET finished_at=? WHERE id=?').run(
        new Date().toISOString(),
        run,
      );
      console.log(JSON.stringify({ processed, lines, run }));
    } catch (error) {
      db.prepare('UPDATE import_runs SET finished_at=?,error=? WHERE id=?').run(
        new Date().toISOString(),
        `Line ${lines}: ${error.message}`,
        run,
      );
      throw error;
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  } else
    throw new Error(
      'Usage: node --env-file-if-exists=.env server/import.mjs subject <ids...> | archive <subject.jsonlines>',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
