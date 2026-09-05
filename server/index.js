import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSessionWatcher } from './sessions.js';
import { createDemoWatcher } from '../public/js/sim/demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const FLOORPLAN = path.join(ROOT, 'house', 'floorplan.json');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
const NAP_AFTER_MIN = Number(process.env.PA_NAP_AFTER_MIN || 8);

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
  return { idleTimeoutMin: watcher.idleTimeoutMin, napAfterMin: NAP_AFTER_MIN, demo: !!watcher.demo };
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

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error('[http]', e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

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

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${PORT}`);
    }
  }
  return urls;
}

function banner() {
  const host = os.hostname().replace(/\.local$/, '');
  const lines = [
    '',
    '  🏠  Pixel Agents House',
    '',
    `  Local:     http://localhost:${PORT}`,
    ...lanUrls().map(u => `  Network:   ${u}`),
    `  Bonjour:   http://${host}.local:${PORT}`,
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

server.listen(PORT, HOST, () => {
  banner();
  watcher.start();
});

async function shutdown() {
  await watcher.stop();
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
