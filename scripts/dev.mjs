import http from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/database.mjs';
import { createApp } from '../server/app.mjs';
import { BangumiClient } from '../server/bangumi.mjs';
import { configureNetworkProxy } from '../server/network-proxy.mjs';

// Explicit port: never silently move the page to a different URL.
export async function startDev() {
  let server;
  let api;
  let db;
  let restoreProxy;
  let step = 'loading local settings';

  async function close() {
    try {
      if (server) await server.close();
    } finally {
      if (api?.listening) {
        api.closeAllConnections();
        await new Promise((resolve) => api.close(resolve));
      }
      try {
        if (db) db.close();
      } finally {
        restoreProxy?.();
      }
    }
  }

  try {
    if (existsSync('.env')) loadEnvFile('.env');
    restoreProxy = configureNetworkProxy();
    const port = Number(process.env.API_PORT || 3001);
    const webPort = Number(process.env.WEB_PORT || 5173);
    if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
      throw new Error('Invalid WEB_PORT');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API_PORT');
    if (port === webPort) throw new Error('WEB_PORT and API_PORT must be different');
    const url = `http://127.0.0.1:${webPort}/`;
    console.log(`Starting Paper Screen at ${url} ...`);
    step = 'opening the SQLite database';
    db = openDatabase();
    step = `starting the API on 127.0.0.1:${port}`;
    api = createApp({
      db, client: new BangumiClient(), port, backupDirectory: process.env.PERSONAL_BACKUP_DIR,
    });
    await new Promise((resolve, reject) => {
      api.once('error', reject);
      api.listen(port, '127.0.0.1', resolve);
    });
    step = `starting the web server on 127.0.0.1:${webPort}`;
    const { createServer } = await import('vite');
    server = await createServer({
      server: { host: '127.0.0.1', port: webPort, strictPort: true },
    });
    await server.listen();
    for (const path of ['', 'src/main.tsx', 'api/health']) {
      step = `checking ${url}${path}`;
      await new Promise((resolve, reject) => {
        const request = http.get(url + path, { timeout: 15000 }, (response) => {
          response.resume();
          response.on('error', reject);
          response.on('end', () =>
            response.statusCode === 200
              ? resolve(undefined)
              : reject(new Error(`HTTP ${response.statusCode}`)),
          );
        });
        request.on('timeout', () => request.destroy(new Error('HTTP check timed out')));
        request.on('error', reject);
      });
    }
    console.log(`\nReady (HTTP 200 verified): ${url}`);
    console.log(`API: http://127.0.0.1:${port}/api/health`);
    return { url, close, openBrowser: () => server.openBrowser() };
  } catch (error) {
    console.error(`\nStartup failed while ${step}: ${error.message}`);
    if (error.code === 'EADDRINUSE' || /Port \d+ is already in use/i.test(error.message)) {
      console.error('Close the program using the reported port and try again.');
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      if (step.startsWith('checking ')) {
        console.error(
          'Loopback access was denied. Run start.cmd from Windows Explorer or a local terminal.',
        );
      } else if (step.startsWith('starting ')) {
        console.error('Windows or the current environment blocked access to the reported port.');
      }
    }
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await startDev();
    console.log('Keep this terminal open. Ctrl+C stops the server.');
    let shutdown;
    const stop = () => (shutdown ??= app.close());
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () =>
        stop().then(
          () => process.exit(0),
          () => process.exit(1),
        ),
      );
    }
    if (process.argv.includes('--open')) {
      try {
        app.openBrowser();
      } catch (error) {
        console.warn(`Could not open the browser: ${error.message}. Open the Ready URL manually.`);
      }
    }
  } catch (error) {
    process.exitCode = 1;
  }
}
