import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSessionWatcher } from './sessions.js';
import { createDemoWatcher } from '../public/js/sim/demo.js';
import { advertise } from './bonjour.js';
import { ensureCerts } from './tls.js';

let bonjour = null;

// 1M-context models are opted into via a "[1m]" suffix on the model name in ~/.claude/settings.json
function defaultContextWindow() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    return /\[1m\]/i.test(String(cfg.model || '')) ? 1000000 : 200000;
  } catch { return 200000; }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const FLOORPLAN = path.join(ROOT, 'house', 'floorplan.json');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
const NAP_AFTER_MIN = Number(process.env.PA_NAP_AFTER_MIN || 8);
const TLS_PORT = process.env.PA_TLS === '0' ? 0 : Number(process.env.PA_TLS_PORT || (PORT === 80 ? 443 : PORT + 1));
const NAME = (process.env.PA_HOSTNAME || os.hostname()).replace(/\.local$/i, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
let tls = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const watcher = process.env.PA_DEMO ? createDemoWatcher() : createSessionWatcher();

function config() {
  return { idleTimeoutMin: watcher.idleTimeoutMin, napAfterMin: NAP_AFTER_MIN, demo: !!watcher.demo, contextWindow: defaultContextWindow(), detail: process.env.PA_DETAIL || 'task',
    urls: { named: bonjour ? bonjour.url : null, lan: lanUrls().map(u => u.replace(/:80$/, '')), secure: secureUrl(), ca: caUrl() } };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

async function serveStatic(req, res, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let st;
  try { st = await fsp.stat(target); } catch { res.writeHead(404); res.end('Not found'); return; }
  const file = st.isDirectory() ? path.join(target, 'index.html') : target;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).on('error', () => { res.destroy(); }).pipe(res);
}

async function handle(req, res) {
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, uptime: process.uptime(), agents: watcher.getAgents().length, demo: !!watcher.demo });
  if (pathname === '/api/state') return sendJson(res, 200, { type: 'snapshot', ts: Date.now(), agents: watcher.getAgents(), config: config() });
  if (pathname === '/ca.crt') {
    if (!tls) { res.writeHead(404); res.end('HTTPS is not enabled'); return; }
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="pixel-agents-ca.crt"', 'Cache-Control': 'no-cache' });
    res.end(tls.ca);
    return;
  }
  if (pathname === '/api/floorplan' || pathname === '/api/floorplan.json') {
    try {
      const text = await fsp.readFile(FLOORPLAN, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(text);
    } catch (e) {
      sendJson(res, 500, { error: `floorplan unreadable: ${e.message}` });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveStatic(req, res, url);
}

function onRequest(req, res) {
  handle(req, res).catch(e => {
    console.error('[http]', e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
  });
}

const server = http.createServer(onRequest);
const wss = new WebSocketServer({ noServer: true });

function attachWs(srv) {
  srv.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
}
attachWs(server);

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', ws => {
  send(ws, { type: 'hello', serverTime: Date.now(), config: config() });
  send(ws, { type: 'snapshot', ts: Date.now(), agents: watcher.getAgents() });
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg && msg.type === 'ping') send(ws, { type: 'pong', ts: Date.now() });
  });
  ws.on('error', () => {});
});

watcher.on('change', (agents, removed) => {
  const frame = JSON.stringify({ type: 'update', ts: Date.now(), agents, removed });
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(frame);
});

function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }
  return ips;
}
function lanUrls() { return lanIps().map(ip => `http://${ip}:${PORT}`); }
function secureUrl() { return tls ? `https://${NAME}.local${TLS_PORT === 443 ? '' : `:${TLS_PORT}`}` : null; }
function caUrl() { return tls ? `http://${NAME}.local${PORT === 80 ? '' : `:${PORT}`}/ca.crt` : null; }

function banner() {
  const host = os.hostname().replace(/\.local$/, '');
  const lines = [
    '',
    '  🏠  Pixel Agents House',
    '',
    `  Local:     http://localhost:${PORT}`,
    ...lanUrls().map(u => `  Network:   ${u}`),
    `  Bonjour:   http://${host}.local:${PORT}`,
    ...(bonjour ? [`  Named:     ${bonjour.url}`] : []),
    ...(tls ? [`  Secure:    ${secureUrl()}`, `  CA cert:   ${caUrl()}  (install on each device once, see README)`] : []),
    '',
    `  Mode:      ${watcher.demo ? `demo (${process.env.PA_DEMO} fake agents)` : `watching ${watcher.projectsDir}`}`,
    `  Idle:      sessions vanish after ${watcher.idleTimeoutMin} min of silence`,
    '',
  ];
  console.log(lines.join('\n'));
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Pick another with: PORT=4322 npm start\n`);
    process.exit(1);
  }
  console.error('[server]', e);
  process.exit(1);
});

let secureServer = null;
function startTls() {
  if (!TLS_PORT) return;
  const host = os.hostname().replace(/\.local$/i, '');
  tls = ensureCerts({ dns: [`${NAME}.local`, `${host}.local`, 'localhost'], ips: ['127.0.0.1', ...lanIps()] });
  if (!tls) return;
  secureServer = https.createServer({ key: tls.key, cert: tls.cert }, onRequest);
  attachWs(secureServer);
  secureServer.on('error', e => {
    console.error(`[tls] HTTPS on port ${TLS_PORT} failed (${e.code || e.message}); pick another with PA_TLS_PORT=8443 or disable with PA_TLS=0`);
    tls = null; secureServer = null;
  });
  secureServer.listen(TLS_PORT, HOST);
}

server.listen(PORT, HOST, () => {
  if (process.env.PA_HOSTNAME) bonjour = advertise({ hostname: process.env.PA_HOSTNAME, port: PORT });
  startTls();
  banner();
  watcher.start();
});

async function shutdown() {
  await watcher.stop();
  for (const ws of wss.clients) ws.terminate();
  secureServer?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
