import { openDatabase } from './database.mjs';
import { BangumiClient } from './bangumi.mjs';
import { createApp } from './app.mjs';
const port = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API_PORT');
const db = openDatabase();
const server = createApp({ db, client: new BangumiClient(), port });
server.on('error', (error) => {
  console.error(`API startup failed: ${error.message}`);
  db.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`API ready: http://127.0.0.1:${port}/api/health`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
