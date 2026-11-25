import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from './database.mjs';
import { exportPersonal, restorePersonal } from './backup.mjs';
const [action, path, option] = process.argv.slice(2),
  db = openDatabase();
try {
  if (action === 'export') {
    const output = resolve(
      path || `data/backups/personal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(exportPersonal(db), null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
    console.log(`Saved personal backup: ${output}`);
  } else if (action === 'restore') {
    if (!path || (option && option !== '--dry-run'))
      throw new Error('Provide a backup file; optional --dry-run');
    console.log(
      JSON.stringify(
        restorePersonal(db, JSON.parse(readFileSync(path, 'utf8')), {
          dryRun: option === '--dry-run',
        }),
      ),
    );
  } else
    throw new Error(
      'Usage: personal-cli.mjs export [output.json] | restore <backup.json> [--dry-run]',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
