import { openDatabase } from './database.mjs';
import { BangumiClient } from './bangumi.mjs';
import { repairCatalog, syncMetadata, syncTag } from './catalog-sync.mjs';
const [mode, ...args] = process.argv.slice(2);
const db = openDatabase(),
  client = new BangumiClient();
try {
  if (mode === 'repair') console.log(JSON.stringify(repairCatalog(db)));
  else if (mode === 'tag') {
    if (!args.length) throw new Error('Provide one or more tags');
    for (const tag of args)
      console.log(
        JSON.stringify(
          await syncTag(db, client, tag, { onProgress: (row) => console.log(JSON.stringify(row)) }),
        ),
      );
  } else if (mode === 'metadata') {
    const number = args.find((value) => value.startsWith('--limit='))?.slice(8);
    const limit = args.includes('--all') ? 100000 : Number(number || 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000)
      throw new Error('limit must be 1–100000');
    const ids = args.filter((value) => !value.startsWith('--')).map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1))
      throw new Error('Invalid subject ID');
    const result = await syncMetadata(db, client, {
      limit,
      ids: ids.length ? ids : undefined,
      force: args.includes('--force'),
      onProgress: (row) => console.log(JSON.stringify(row)),
    });
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } else
    throw new Error(
      'Usage: catalog-sync-cli.mjs repair | tag <tags...> | metadata [IDs...] [--limit=50|--all] [--force]',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
