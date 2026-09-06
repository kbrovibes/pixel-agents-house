// Publishes <name>.local on the LAN through macOS's mDNS responder (dns-sd -P), so every phone,
// tablet and laptop on the wifi can open the house by name instead of by IP. No root needed.
import { spawn } from 'node:child_process';
import os from 'node:os';

const RECHECK_MS = 30000;

export function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

export function advertise({ hostname, port, log = console.log }) {
  const name = String(hostname).replace(/\.local$/i, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const url = `http://${name}.local${Number(port) === 80 ? '' : `:${port}`}`;
  if (process.platform !== 'darwin') {
    log(`[bonjour] ${url} needs macOS (dns-sd); on Linux use avahi-publish -a ${name}.local <ip>`);
    return { url, stop() {} };
  }
  let child = null, ip = null, timer = null;

  function start() {
    ip = lanIPv4();
    if (!ip) return;
    child = spawn('dns-sd', ['-P', name, '_http._tcp', 'local', String(port), `${name}.local`, ip], { stdio: 'ignore' });
    child.on('error', () => { child = null; });
    child.on('exit', () => { child = null; });
  }
  function stop() {
    clearInterval(timer);
    if (child) { child.kill(); child = null; }
  }
  start();
  // DHCP can hand out a new address; re-register when it changes or if dns-sd died
  timer = setInterval(() => {
    const now = lanIPv4();
    if (now !== ip || !child) { if (child) child.kill(); start(); }
  }, RECHECK_MS);
  timer.unref?.();
  process.on('exit', stop);
  return { url, stop };
}
