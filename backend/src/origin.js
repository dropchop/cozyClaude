// Browser-origin guard. The API has no auth, so any web page the owner opens
// could otherwise call it (and read the WebSocket) with the owner's browser.
// A request is allowed when its Host is a name we serve, and it carries no Origin
// (curl, server-side, same-origin GET), or is same-origin with that Host (prod: the
// backend serves the UI), or comes from a dev/allow-listed origin.
const DEV_PORTS = (process.env.DEV_UI_PORTS || '5173').split(',').map((s) => s.trim()).filter(Boolean);
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

// Extra origins (e.g. a Tailscale hostname serving the Vite UI), comma-separated.
function extraOrigins() {
  return (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function hostnameOf(hostHeader) {
  try { return new URL(`http://${hostHeader}`).hostname; } catch { return null; }
}

// Host names this server answers to: loopback, ALLOWED_HOSTS, and the hostnames
// of ALLOWED_ORIGINS. Checking Host on every request is what stops DNS rebinding:
// a rebound page (http://rebind.evil.test:4000) sends a matching Origin and Host,
// and a same-origin GET sends no Origin at all, so only the Host name tells it apart.
export function isAllowedHost(host) {
  const name = hostnameOf(host || '');
  if (!name) return false;
  if (LOOPBACK.includes(name)) return true;
  const listed = (process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.includes(name)) return true;
  return extraOrigins().some((o) => { try { return new URL(o).hostname === name; } catch { return false; } });
}

export function isAllowedRequest(origin, host) {
  if (!isAllowedHost(host)) return false;
  if (!origin) return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.host === host) return true;
  if (LOOPBACK.includes(url.hostname) && DEV_PORTS.includes(url.port)) return true;
  return extraOrigins().includes(url.origin);
}

const warned = new Set();
function warnOnce(origin, host) {
  const key = `${origin}|${host}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[origin] refused origin=${origin || '(none)'} host=${host}. ` +
    'If this is you (LAN/tailnet name), set ALLOWED_ORIGINS=<your UI origin> in backend/.env.');
}

// Express middleware: refuse cross-origin or foreign-Host callers, grant CORS only to allowed ones.
export function originGuard(req, res, next) {
  const origin = req.headers.origin;
  if (!isAllowedRequest(origin, req.headers.host)) {
    warnOnce(origin, req.headers.host);
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
