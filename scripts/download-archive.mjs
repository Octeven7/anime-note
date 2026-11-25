import {
  createWriteStream,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const directory = resolve('data/archive');
mkdirSync(directory, { recursive: true });
try {
  const response = await fetch(
    'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json',
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  const metadata = await response.json();
  if (
    !/^https:\/\/github\.com\/bangumi\/Archive\/releases\/download\//.test(
      metadata.browser_download_url,
    ) ||
    !/^sha256:[a-f0-9]{64}$/.test(metadata.digest) ||
    metadata.size > 1024 ** 3
  )
    throw new Error('Unexpected archive manifest');
  const zip = join(directory, 'bangumi.zip');
  const digest = metadata.digest.slice(7);
  const reusable = existsSync(zip) && (await sha256(zip)) === digest;
  if (!reusable) {
    console.log(`Downloading official archive: ${(metadata.size / 1024 ** 2).toFixed(1)} MiB`);
    const download = await fetch(metadata.browser_download_url, {
      signal: AbortSignal.timeout(600000),
    });
    if (!download.ok) throw new Error(`Archive HTTP ${download.status}`);
    let bytes = 0,
      last = 0;
    const hash = createHash('sha256');
    await pipeline(
      Readable.fromWeb(download.body),
      new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > metadata.size) {
            callback(new Error('Archive exceeds declared size'));
            return;
          }
          hash.update(chunk);
          if (bytes - last > 32 * 1024 ** 2) {
            last = bytes;
            console.log(`Downloaded ${(bytes / 1024 ** 2).toFixed(0)} MiB`);
          }
          callback(null, chunk);
        },
      }),
      createWriteStream(zip + '.partial'),
    );
    if (bytes !== metadata.size || hash.digest('hex') !== digest) {
      unlinkSync(zip + '.partial');
      throw new Error('Archive checksum/size mismatch');
    }
    renameSync(zip + '.partial', zip);
  }
  const names = (await run('tar', ['-tf', zip])).split(/\r?\n/);
  const subject = names.find((name) => /^(?:[a-zA-Z0-9_-]+\/)?subject\.jsonlines$/.test(name));
  if (!subject)
    throw new Error(`No subject.jsonlines found; entries: ${names.slice(0, 15).join(', ')}`);
  const extracted = join(directory, subject);
  if (
    !existsSync(extracted) ||
    !existsSync(join(directory, 'manifest.json')) ||
    JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')).digest !== metadata.digest
  ) {
    console.log('Extracting subject catalog only…');
    await run('tar', ['-xf', zip, '-C', directory, subject]);
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(metadata, null, 2));
  console.log(`Verified subject file: ${extracted}`);
  console.log('Importing animation catalog…');
  const child = spawn(
    process.execPath,
    ['--env-file-if-exists=.env', 'server/import.mjs', 'archive', extracted],
    { stdio: 'inherit', windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Importer exited ${code}`)),
    );
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
