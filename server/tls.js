// Self-signed local CA plus a leaf certificate for every name the house is reachable by.
// Devices trust the CA once (see README "Install from an iPad"); the leaf is regenerated whenever
// the names or LAN addresses change, so the CA never has to be reinstalled. Needs the openssl CLI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CA_DAYS = 3650;
const LEAF_DAYS = 820;              // iOS rejects TLS certs valid for more than 825 days
const RENEW_BEFORE_MS = 30 * 864e5;
export const CA_NAME = 'Pixel Agents House Local CA';

export function defaultTlsDir() {
  return process.env.PA_TLS_DIR || path.join(os.homedir(), '.pixelagents', 'tls');
}

function openssl(args, cwd) {
  return execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

// iOS Safari only recognizes application/x-x509-ca-cert as an installable profile when the body
// is DER, not PEM; a PEM body with that content type just downloads as a file.
function pemToDer(pemPath, cwd) {
  return execFileSync('openssl', ['x509', '-in', pemPath, '-outform', 'der'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function certNotAfter(certPath) {
  try {
    const out = openssl(['x509', '-noout', '-enddate', '-in', certPath]);
    return Date.parse(out.replace(/^notAfter=/, '').trim());
  } catch { return 0; }
}

function makeCA(dir) {
  const cnf = path.join(dir, 'ca.cnf');
  fs.writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3_ca', 'prompt = no',
    '[dn]', `CN = ${CA_NAME}`, 'O = Pixel Agents House',
    '[v3_ca]', 'basicConstraints = critical, CA:TRUE', 'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    '',
  ].join('\n'));
  openssl(['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', String(CA_DAYS),
    '-config', cnf, '-keyout', 'ca.key', '-out', 'ca.crt'], dir);
  fs.chmodSync(path.join(dir, 'ca.key'), 0o600);
}

function makeLeaf(dir, dns, ips) {
  const cnf = path.join(dir, 'server.cnf');
  const alt = [...dns.map((d, i) => `DNS.${i + 1} = ${d}`), ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`)];
  fs.writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', 'prompt = no',
    '[dn]', `CN = ${dns[0]}`, 'O = Pixel Agents House',
    '[v3_leaf]', 'basicConstraints = CA:FALSE', 'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth', 'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid,issuer',
    'subjectAltName = @alt', '[alt]', ...alt,
    '',
  ].join('\n'));
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-config', cnf,
    '-keyout', 'server.key', '-out', 'server.csr'], dir);
  openssl(['x509', '-req', '-sha256', '-days', String(LEAF_DAYS), '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
    '-CAcreateserial', '-extfile', cnf, '-extensions', 'v3_leaf', '-out', 'server.crt'], dir);
  fs.chmodSync(path.join(dir, 'server.key'), 0o600);
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ dns, ips }, null, 2) + '\n');
}

// Returns { key, cert, ca, caPath } or null when certificates cannot be produced.
export function ensureCerts({ dir = defaultTlsDir(), dns, ips, log = console.log } = {}) {
  try { openssl(['version']); } catch {
    log('[tls] openssl not found; HTTPS disabled');
    return null;
  }
  dns = [...new Set(dns.filter(Boolean))];
  ips = [...new Set(ips.filter(Boolean))];
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caCrt = path.join(dir, 'ca.crt'), caKey = path.join(dir, 'ca.key');
  const crt = path.join(dir, 'server.crt'), key = path.join(dir, 'server.key');
  try {
    if (!fs.existsSync(caCrt) || !fs.existsSync(caKey)) {
      makeCA(dir);
      log(`[tls] created local CA at ${caCrt}`);
      for (const f of [crt, key]) fs.rmSync(f, { force: true });
    }
    let wanted;
    try { wanted = JSON.parse(fs.readFileSync(path.join(dir, 'server.json'), 'utf8')); } catch { wanted = null; }
    const same = wanted && JSON.stringify(wanted.dns) === JSON.stringify(dns) && JSON.stringify(wanted.ips) === JSON.stringify(ips);
    const fresh = fs.existsSync(crt) && fs.existsSync(key) && certNotAfter(crt) - Date.now() > RENEW_BEFORE_MS;
    if (!same || !fresh) {
      makeLeaf(dir, dns, ips);
      log(`[tls] issued certificate for ${[...dns, ...ips].join(', ')}`);
    }
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt), ca: fs.readFileSync(caCrt), caDer: pemToDer(caCrt, dir), caPath: caCrt };
  } catch (e) {
    log(`[tls] certificate setup failed, HTTPS disabled: ${e.stderr || e.message}`);
    return null;
  }
}
