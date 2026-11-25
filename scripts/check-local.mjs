import http from 'node:http';

// Checks the entry and Vite-transformed modules, not just an open TCP port.
const paths = [
  '/',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/Catalog.tsx',
  '/src/Detail.tsx',
  '/src/DataSettings.tsx',
  '/src/Recorder.tsx',
  '/src/Schedule.tsx',
  '/src/styles.css',
  '/api/health',
  '/api/catalog?limit=1',
  '/api/me/notes?limit=1',
];
let failed = false;
for (const path of paths) {
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:5173${path}`, { timeout: 15000 }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', reject);
    });
    if (
      result.status !== 200 ||
      !result.body.length ||
      (path !== '/' && result.body.includes('<!doctype html>'))
    ) {
      throw new Error(`Unexpected HTTP response (${result.status})`);
    }
    console.log(`PASS ${path} HTTP ${result.status}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
