import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { initWebSocket } from './ws.js';
import { api } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api', api);

// In production, serve the built frontend so the whole app runs on one port.
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-API GET returns index.html.
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  console.log('[server] serving frontend from', distDir);
}

const server = http.createServer(app);
initWebSocket(server);

async function main() {
  await initDb();
  console.log('[db] schema ready');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[warn] ANTHROPIC_API_KEY is not set — runs will fail until it is configured.');
  }

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket on ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
