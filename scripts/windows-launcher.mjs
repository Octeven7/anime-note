import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const launcher = fileURLToPath(import.meta.url);
const projectId = createHash('sha256').update(root.toLowerCase()).digest('hex');
const pipe = `\\\\.\\pipe\\anime-note-${projectId}`;
const log = join(root, '.local', 'service.log');
const timeout = 120_000;

function request(command) {
  return new Promise((resolve, reject) => {
    const message = http.request(
      { socketPath: pipe, method: 'POST', path: `/${command}` },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (part) => (body += part));
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode === 200) resolve(body);
          else reject(new Error(body || `Control request failed (HTTP ${response.statusCode})`));
        });
      },
    );
    message.on('error', reject);
    message.setTimeout(timeout, () =>
      message.destroy(new Error('The service did not respond in time.')),
    );
    message.end();
  });
}

function isOffline(error) {
  return error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
}

async function start() {
  let child;
  let spawnError;
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      console.log(`Ready (HTTP 200 verified): ${await request('open')}`);
      console.log('The service runs in the background. Run stop.cmd to stop it.');
      return;
    } catch (error) {
      if (!isOffline(error)) throw error;
    }

    if (!child) {
      console.log('Starting Paper Screen in the background ...');
      mkdirSync(join(root, '.local'), { recursive: true });
      const output = openSync(log, 'a');
      try {
        child = spawn(process.execPath, [launcher, 'serve'], {
          cwd: root,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', output, output],
        });
        child.once('error', (error) => (spawnError = error));
        child.unref();
      } finally {
        closeSync(output);
      }
    } else if (spawnError) {
      throw spawnError;
    } else if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('The background process exited before it was ready.');
    }

    if (Date.now() >= deadline) throw new Error('Timed out waiting for startup.');
    await delay(200);
  }
}

async function serve() {
  let startup;
  let shutdown;
  const control = http.createServer(async (req, res) => {
    const command = req.url;
    if (req.method !== 'POST' || (command !== '/open' && command !== '/stop')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const app = await startup;
      if (command === '/stop') {
        shutdown ??= app.close();
        await shutdown;
        control.close();
        res.end('The service stopped.');
        return;
      }
      if (shutdown) {
        res.writeHead(503).end('The service is stopping. Run start.cmd again once it has stopped.');
        return;
      }
      try {
        app.openBrowser();
      } catch (error) {
        console.warn(`Could not open the browser: ${error.message}`);
      }
      res.end(app.url);
    } catch (error) {
      res.writeHead(500).end(error.message);
    }
  });

  try {
    await new Promise((resolve, reject) => {
      control.once('error', reject);
      control.listen(pipe, resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') return;
    throw error;
  }

  console.log(`\n[${new Date().toISOString()}] Starting background service (PID ${process.pid})`);
  startup = import('./dev.mjs').then(({ startDev }) => startDev());
  try {
    await startup;
  } catch (error) {
    control.close();
    throw error;
  }
}

try {
  switch (process.argv[2]) {
    case 'start':
      await start();
      break;
    case 'stop':
      try {
        console.log(await request('stop'));
      } catch (error) {
        if (!isOffline(error)) throw error;
        console.log('The background service is not running.');
      }
      break;
    case 'serve':
      await serve();
      break;
    default:
      throw new Error('Use start.cmd or stop.cmd.');
  }
} catch (error) {
  console.error(error.message);
  if (process.argv[2] !== 'serve') console.error(`Service log: ${log}`);
  process.exitCode = 1;
}
