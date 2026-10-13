import { WebSocketServer } from 'ws';
import { isAllowedRequest } from './origin.js';

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    // Browsers always send Origin on WebSocket handshakes; refuse foreign pages.
    verifyClient: ({ req }, done) => {
      const ok = isAllowedRequest(req.headers.origin, req.headers.host);
      done(ok, 403, 'origin not allowed');
    },
  });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'connected', data: { ts: Date.now() } }));
  });
  return wss;
}

// Push an event to every connected client.
export function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  }
}
