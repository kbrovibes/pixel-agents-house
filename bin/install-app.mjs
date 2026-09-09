#!/usr/bin/env node
// One-command install on macOS: a launchd agent keeps the server running at login on port 80
// and advertises http://<name>.local on the wifi. Usage: npm run install-app [-- --name pixelagents --port 80]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const name = opt('name', 'pixelagents').replace(/\.local$/i, '');
let port = Number(opt('port', 80));
const LABEL = 'com.pixelagents.house';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = path.join(os.homedir(), 'Library', 'Logs', 'pixel-agents-house.log');

if (process.platform !== 'darwin') {
  console.error('install-app sets up a macOS launchd agent. On other systems run `npm start` under systemd/pm2 and see the README.');
  process.exit(1);
}

async function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

const uid = process.getuid();
// stop a previous install first, otherwise its server makes the port look busy
spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const free = await portFree(port);
if (!free) {
  console.log(`Port ${port} is busy or not allowed; falling back to 4321.`);
  port = 4321;
}
const url = `http://${name}.local${port === 80 ? '' : `:${port}`}`;
const secure = `https://${name}.local${port === 80 ? '' : `:${port + 1}`}`;
const pathEnv = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(root, 'server', 'index.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${port}</string>
    <key>HOST</key><string>0.0.0.0</string>
    <key>PA_HOSTNAME</key><string>${name}</string>
    <key>PATH</key><string>${pathEnv}</string>
    <key>HOME</key><string>${os.homedir()}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;

fs.mkdirSync(path.dirname(plistPath), { recursive: true });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(plistPath, plist);
const boot = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { encoding: 'utf8' });
if (boot.status !== 0) {
  console.error('launchctl bootstrap failed:', boot.stderr || boot.stdout);
  process.exit(1);
}

let healthy = false;
for (let i = 0; i < 40 && !healthy; i++) {
  await new Promise(r => setTimeout(r, 250));
  try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
}
const ip = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
console.log(`
  🏠  Pixel Agents House is installed and will start at every login.

  Open:      ${url}
  Any device on the wifi: ${url}${ip ? `  (or http://${ip}${port === 80 ? '' : `:${port}`})` : ''}
  Kiosk:     ${url}/?kiosk=1&labels=1
  Secure:    ${secure}  (trust ${url}/ca.crt on each device first, see README)

  Status:    ${healthy ? 'running' : `not responding yet, check ${logPath}`}
  Logs:      ${logPath}
  Remove:    npm run uninstall-app
`);
if (healthy && !args.includes('--no-open')) {
  try { execFileSync('open', [url]); } catch {}
}
