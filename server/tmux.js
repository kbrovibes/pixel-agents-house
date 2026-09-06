// Maps a working directory to the tmux session/window that has a `claude` process running in it,
// so agents can be labelled with the session name the user gave in tmux instead of a folder name.
import { execFile } from 'node:child_process';

const REFRESH_MS = 10000;

const SEP = '|||';   // tabs get sanitised to "_" by tmux outside a UTF-8 locale (e.g. under launchd)

function run(cmd, args) {
  const env = { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' };
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, env }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

export function createTmuxIndex() {
  let byCwd = new Map();
  let timer = null;

  async function refresh() {
    const panes = await run('tmux', ['list-panes', '-a', '-F', `#{session_name}${SEP}#{window_name}${SEP}#{pane_pid}${SEP}#{pane_current_path}`]);
    if (!panes) { byCwd = new Map(); return; }
    const ps = await run('ps', ['-axo', 'pid=,ppid=,comm=']);
    const parent = new Map(), comm = new Map();
    for (const line of ps.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (m) { parent.set(Number(m[1]), Number(m[2])); comm.set(Number(m[1]), m[3]); }
    }
    const claudePids = [...comm.entries()].filter(([, c]) => /(^|\/)claude$/.test(c)).map(([pid]) => pid);
    const hasClaude = (panePid) => claudePids.some((pid) => {
      let p = pid, hops = 0;
      while (p && hops++ < 12) { if (p === panePid) return true; p = parent.get(p); }
      return false;
    });
    const next = new Map();
    for (const line of panes.split('\n')) {
      const [session, window, pid, cwd] = line.split(SEP);
      if (!cwd) continue;
      const entry = { session, window, live: hasClaude(Number(pid)) };
      const prev = next.get(cwd);
      if (!prev || (entry.live && !prev.live)) next.set(cwd, entry);
    }
    byCwd = next;
  }

  return {
    start() { refresh().catch(() => {}); timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS); timer.unref?.(); },
    stop() { clearInterval(timer); },
    lookup(cwd) {
      if (!cwd) return null;
      const e = byCwd.get(cwd);
      return e ? { session: e.session, window: e.window } : null;
    },
  };
}
