import { nameFor } from './names.js';

const env = typeof process !== 'undefined' && process.env ? process.env : {};

const PROJECTS = ['pixelagents', 'snobaddy', 'marketmath', 'opencourt', 'portfolio', 'finances', 'doodle-disaster', 'career-ops', 'expenses', 'ios', 'mac', 'profile'];
const TITLES = ['Fix flaky login test', 'Add CSV export', 'Refactor renderer', 'Write README', 'Investigate memory leak', 'Migrate to ESM', 'Design landing page', 'Tune A* pathfinding', 'Ship dark mode', 'Clean up lint errors', 'Spike websocket reconnect', 'Polish onboarding'];
const FILES = ['renderer.js', 'world.js', 'index.html', 'app.css', 'sessions.js', 'package.json', 'README.md', 'agents.js', 'ui.js', 'main.js'];
const COMMANDS = ['npm test', 'git status', 'npm run build', 'ls -la', 'node server/index.js', 'grep -rn TODO src', 'npm install'];
const QUERIES = ['canvas imageSmoothingEnabled', 'chokidar v4 ignored function', 'ws ping pong node', 'fullscreen api safari'];

const CYCLE = [
  { activity: 'read', tool: 'Read' },
  { activity: 'read', tool: 'Grep' },
  { activity: 'write', tool: 'Edit' },
  { activity: 'bash', tool: 'Bash' },
  { activity: 'think', tool: null },
  { activity: 'write', tool: 'Write' },
  { activity: 'bash', tool: 'Bash' },
  { activity: 'idle', tool: null },
];

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function detailFor(tool, rng) {
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': return pick(FILES, rng);
    case 'Grep': return pick(['TODO', 'export function', 'drawFurniture', 'findPath'], rng);
    case 'Bash': return pick(COMMANDS, rng);
    case 'WebSearch': return pick(QUERIES, rng);
    case 'Agent': return 'Explore the codebase for chore stations';
    default: return '';
  }
}

export function createDemoWatcher(opts = {}) {
  const count = Math.max(1, Number(opts.count || env.PA_DEMO || 6));
  const fast = opts.fast ?? env.PA_DEMO_FAST === '1';
  const idleTimeoutMin = Number(env.PA_IDLE_TIMEOUT_MIN || 20);
  const stepMs = fast ? 3000 : 25000;
  const churnMs = fast ? 15000 : 90000;
  const rng = makeRng(42);
  const listeners = [];
  const agents = new Map();
  let seq = 0;
  let timers = [];

  function on(event, fn) { if (event === 'change') listeners.push(fn); return () => {}; }

  function emit(changed, removed = []) {
    for (const fn of listeners) {
      try { fn(changed, removed); } catch (e) { console.error('[demo] listener error', e); }
    }
  }

  function newAgent(longIdle = false) {
    const idx = seq++;
    const id = `demo-${idx.toString(16).padStart(4, '0')}-${Math.floor(rng() * 1e9).toString(16)}`;
    const project = PROJECTS[idx % PROJECTS.length];
    const now = Date.now();
    const a = {
      id, parentId: null, isSubagent: false,
      name: nameFor(id, new Set([...agents.values()].map(x => x.name))),
      project, cwd: `/Users/demo/claude/${project}`, gitBranch: pick(['main', 'dev', 'feature/chores'], rng),
      title: TITLES[idx % TITLES.length],
      status: 'thinking', activity: 'think', tool: null, toolDetail: '',
      lastPrompt: TITLES[idx % TITLES.length], lastText: '',
      startedAt: now - Math.floor(rng() * 3600000), lastActivityAt: now,
      turns: 1 + Math.floor(rng() * 12), toolCounts: {},
      model: 'claude-fable-5-1', permissionMode: 'default', helpers: 0,
      _step: Math.floor(rng() * CYCLE.length), _longIdle: longIdle, _errorAt: 0,
    };
    agents.set(id, a);
    return a;
  }

  function stripPrivate(a) {
    const out = {};
    for (const [k, v] of Object.entries(a)) if (!k.startsWith('_')) out[k] = v;
    return out;
  }

  function advance(a) {
    const now = Date.now();
    if (a._longIdle) {
      a.status = 'idle'; a.activity = 'idle'; a.tool = null; a.toolDetail = '';
      a.lastText = 'Done. Let me know what you want next.';
      if (!a._idleSince) { a._idleSince = now - 9 * 60 * 1000; a.lastActivityAt = a._idleSince; }
      return;
    }
    a._step = (a._step + 1) % CYCLE.length;
    let { activity, tool } = CYCLE[a._step];
    const roll = rng();
    if (roll < 0.08) { activity = 'web'; tool = 'WebSearch'; }
    else if (roll < 0.13) { activity = 'agent'; tool = 'Agent'; }
    else if (roll < 0.18) { activity = 'error'; tool = 'Bash'; }
    a.activity = activity;
    a.tool = tool;
    a.toolDetail = detailFor(tool, rng);
    if (tool) a.toolCounts[tool] = (a.toolCounts[tool] || 0) + 1;
    if (activity === 'idle') {
      a.status = 'idle';
      a.lastText = pick(['Done, tests pass.', 'Pushed the change.', 'Ready for review.', 'All set — anything else?'], rng);
      a.lastActivityAt = now;
    } else if (activity === 'think' || activity === 'error') {
      a.status = 'thinking';
      a.lastActivityAt = now;
    } else {
      a.status = 'working';
      a.lastActivityAt = now;
    }
    if (a.status === 'idle' && rng() < 0.5) a.turns += 1;
  }

  function step() {
    const changed = [];
    for (const a of agents.values()) {
      if (rng() < 0.7 || a._longIdle) { advance(a); changed.push(stripPrivate(a)); }
    }
    if (changed.length) emit(changed);
  }

  function churn() {
    const live = [...agents.values()].filter(a => !a._longIdle);
    if (!live.length) return;
    const leaving = pick(live, rng);
    leaving.status = 'gone';
    emit([stripPrivate(leaving)]);
    setTimeout(() => {
      agents.delete(leaving.id);
      const arrived = newAgent();
      emit([stripPrivate(arrived)], [leaving.id]);
    }, 1500);
  }

  function start() {
    for (let i = 0; i < count; i++) {
      const a = newAgent(i % 4 === 3);
      advance(a);
    }
    console.log(`[demo] ${count} fake agents (${fast ? 'fast' : 'normal'} cycle)`);
    timers.push(setInterval(step, stepMs));
    timers.push(setInterval(churn, churnMs));
  }

  async function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
  }

  function getAgents() {
    return [...agents.values()].filter(a => a.status !== 'gone').map(stripPrivate);
  }

  return { start, stop, getAgents, on, idleTimeoutMin, demo: true };
}
