// Browser-origin guard. The API has no auth, so any web page the owner opens
// could otherwise call it (and read the WebSocket) with the owner's browser.
// A request is allowed when it carries no Origin (curl, server-side, same-origin
// GET navigation), is same-origin with this server's Host (prod: the backend
// serves the UI), or comes from a dev/allow-listed origin.
const DEV_PORTS = (process.env.DEV_UI_PORTS || '5173').split(',').map((s) => s.trim()).filter(Boolean);
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

// Extra origins (e.g. a Tailscale hostname serving the Vite UI), comma-separated.
function extraOrigins() {
  return (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (host && url.host === host) return true;
  if (LOOPBACK.includes(url.hostname) && DEV_PORTS.includes(url.port)) return true;
  return extraOrigins().includes(url.origin);
}

// Express middleware: refuse cross-origin callers, grant CORS only to allowed ones.
export function originGuard(req, res, next) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin, req.headers.host)) {
    return res.status(403).json({ error: 'origin not allowed' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type');
      return res.status(204).end();
    }
  }
  next();
}
