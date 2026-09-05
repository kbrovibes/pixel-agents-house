import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import chokidar from 'chokidar';
import { nameFor } from '../public/js/sim/names.js';

const SEED_TAIL_BYTES = 512 * 1024;
const TOOL_RESULT_DEBOUNCE_MS = 3000;
const THINKING_STALE_MS = 10 * 60 * 1000;
const SUBAGENT_GONE_MS = 5 * 60 * 1000;
const ERROR_MS = 20 * 1000;
const BROADCAST_MS = 250;
const TICK_MS = 1000;
const MAX_TEXT = 140;
const MAX_DETAIL = 60;
const MAX_TITLE = 80;

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'TodoRead', 'Skill', 'ListMcpResources', 'ReadMcpResource']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite']);
const BASH_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Monitor']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

export function toolActivity(name) {
  if (!name) return 'think';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (BASH_TOOLS.has(name)) return 'bash';
  if (WEB_TOOLS.has(name) || name.startsWith('mcp__claude-in-chrome__') || /fetch|browser|search/i.test(name) && name.startsWith('mcp__')) return 'web';
  if (AGENT_TOOLS.has(name)) return 'agent';
  if (READ_TOOLS.has(name)) return 'read';
  return 'read';
}

function clip(text, max) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function toolDetail(name, input) {
  if (!input || typeof input !== 'object') return '';
  const p = input.file_path || input.notebook_path || input.path;
  if (p) return clip(path.basename(String(p)), MAX_DETAIL);
  if (input.command) return clip(String(input.command).split('\n')[0], MAX_DETAIL);
  if (input.pattern) return clip(input.pattern, MAX_DETAIL);
  if (input.query) return clip(input.query, MAX_DETAIL);
  if (input.url) return clip(input.url, MAX_DETAIL);
  if (input.description) return clip(input.description, MAX_DETAIL);
  if (input.prompt) return clip(input.prompt, MAX_DETAIL);
  if (input.skill) return clip(input.skill, MAX_DETAIL);
  const firstString = Object.values(input).find(v => typeof v === 'string');
  return firstString ? clip(firstString, MAX_DETAIL) : '';
}

function parseFilePath(projectsDir, file) {
  const rel = path.relative(projectsDir, file).split(path.sep);
  if (rel.length === 2 && rel[1].endsWith('.jsonl')) {
    return { sessionId: rel[1].slice(0, -6), agentId: null };
  }
  if (rel.length === 4 && rel[2] === 'subagents' && rel[3].endsWith('.jsonl')) {
    const m = rel[3].match(/^agent-(.+)\.jsonl$/);
    return { sessionId: rel[1], agentId: m ? m[1] : rel[3].slice(0, -6) };
  }
  return null;
}

function newSession(file, sessionId, agentId) {
  return {
    file, sessionId, agentId,
    id: agentId ? `${sessionId}/${agentId}` : sessionId,
    parentId: agentId ? sessionId : null,
    offset: 0, partial: '',
    cwd: null, gitBranch: null, model: null, version: null, permissionMode: null, title: null,
    firstPrompt: null, lastPrompt: '', lastText: '',
    startedAt: null, lastActivityAt: null, lastLineAt: Date.now(),
    turns: 0, toolCounts: {},
    pending: null, lastTool: null, lastDetail: '', lastKind: null,
    errorUntil: 0, goneAt: 0, name: null, entrypoint: null,
  };
}

function isPromptText(text) {
  const t = String(text).trim();
  return t.length > 0 && !t.startsWith('<');
}

function firstTextBlock(content) {
  if (typeof content === 'string') return isPromptText(content) ? content : null;
  if (!Array.isArray(content)) return null;
  for (const b of content) {
    if (b && b.type === 'text' && typeof b.text === 'string' && isPromptText(b.text)) return b.text;
  }
  return null;
}

export function createSessionWatcher(opts = {}) {
  const projectsDir = opts.projectsDir || process.env.PA_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
  const idleTimeoutMin = Number(opts.idleTimeoutMin || process.env.PA_IDLE_TIMEOUT_MIN || 20);
  const idleTimeoutMs = idleTimeoutMin * 60 * 1000;
  const includeHeadless = opts.includeHeadless ?? process.env.PA_INCLUDE_HEADLESS === '1';

  const sessions = new Map();
  const lastSent = new Map();
  const listeners = [];
  let watcher = null;
  let tickTimer = null;
  let broadcastTimer = null;
  let pendingChanged = new Map();
  let pendingRemoved = new Set();
  const readQueue = new Map();

  function on(event, fn) {
    if (event === 'change') listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      if (!pendingChanged.size && !pendingRemoved.size) return;
      const agents = [...pendingChanged.values()];
      const removed = [...pendingRemoved];
      pendingChanged = new Map();
      pendingRemoved = new Set();
      for (const fn of listeners) {
        try { fn(agents, removed); } catch (e) { console.error('[sessions] listener error', e); }
      }
    }, BROADCAST_MS);
  }

  function ingestLine(s, line) {
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (!j || typeof j !== 'object') return;
    if (j.isSidechain && !s.agentId) return;
    if (j.cwd) s.cwd = j.cwd;
    if (j.gitBranch) s.gitBranch = j.gitBranch;
    if (j.version) s.version = j.version;
    if (j.entrypoint) s.entrypoint = j.entrypoint;
    if (j.type === 'permission-mode' && j.permissionMode) s.permissionMode = j.permissionMode;
    if (j.type === 'ai-title' && j.aiTitle) { s.title = clip(j.aiTitle, MAX_TITLE); return; }
    if (j.type !== 'assistant' && j.type !== 'user') return;

    const ts = j.timestamp ? Date.parse(j.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
      if (!s.lastActivityAt || ts > s.lastActivityAt) s.lastActivityAt = ts;
    }
    const msg = j.message || {};
    if (msg.model) s.model = msg.model;
    const content = msg.content;

    if (j.type === 'assistant') {
      if (!Array.isArray(content)) return;
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'tool_use') {
          s.pending = { id: b.id, name: b.name, detail: toolDetail(b.name, b.input) };
          s.lastTool = b.name;
          s.lastDetail = s.pending.detail;
          s.toolCounts[b.name] = (s.toolCounts[b.name] || 0) + 1;
          s.lastKind = 'tool_use';
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          s.lastKind = 'thinking';
        } else if (b.type === 'text' && b.text && b.text.trim()) {
          s.lastText = clip(b.text, MAX_TEXT);
          s.lastKind = 'text';
        }
      }
      return;
    }

    if (Array.isArray(content)) {
      let sawResult = false;
      for (const b of content) {
        if (b && b.type === 'tool_result') {
          sawResult = true;
          if (b.is_error) s.errorUntil = Date.now() + ERROR_MS;
        }
      }
      if (sawResult) {
        s.pending = null;
        s.lastKind = 'tool_result';
      }
    }
    const prompt = firstTextBlock(content);
    if (prompt) {
      s.turns += 1;
      s.lastPrompt = clip(prompt, MAX_TEXT);
      if (!s.firstPrompt) s.firstPrompt = clip(prompt, MAX_TITLE);
      s.lastKind = 'prompt';
      s.pending = null;
    }
  }

  async function readNew(s) {
    let st;
    try { st = await fsp.stat(s.file); } catch { return false; }
    if (st.size < s.offset) { s.offset = 0; s.partial = ''; }
    if (st.size === s.offset) return false;
    let fh;
    try {
      fh = await fsp.open(s.file, 'r');
      const len = st.size - s.offset;
      const buf = Buffer.allocUnsafe(len);
      await fh.read(buf, 0, len, s.offset);
      s.offset = st.size;
      const text = s.partial + buf.toString('utf8');
      const lines = text.split('\n');
      s.partial = lines.pop();
      for (const line of lines) if (line.trim()) ingestLine(s, line);
      s.lastLineAt = Math.max(s.lastLineAt, st.mtimeMs, Date.now());
      s.goneAt = 0;
      return true;
    } catch (e) {
      console.error('[sessions] read failed', s.file, e.message);
      return false;
    } finally {
      if (fh) await fh.close().catch(() => {});
    }
  }

  function queueRead(s) {
    const prev = readQueue.get(s.id) || Promise.resolve();
    const next = prev.then(() => readNew(s)).then(changed => { if (changed) emitIfChanged(s); }).catch(() => {});
    readQueue.set(s.id, next);
    return next;
  }

  async function trackFile(file, stats) {
    const parsed = parseFilePath(projectsDir, file);
    if (!parsed) return;
    let s = sessions.get(parsed.agentId ? `${parsed.sessionId}/${parsed.agentId}` : parsed.sessionId);
    if (!s) {
      const st = stats || await fsp.stat(file).catch(() => null);
      if (!st) return;
      if (Date.now() - st.mtimeMs > idleTimeoutMs) return;
      s = newSession(file, parsed.sessionId, parsed.agentId);
      s.lastLineAt = st.mtimeMs;
      if (st.size > SEED_TAIL_BYTES) {
        s.offset = st.size - SEED_TAIL_BYTES;
        s.partial = '';
        s.dropFirstPartial = true;
      }
      sessions.set(s.id, s);
      if (s.dropFirstPartial) {
        await seedTail(s);
        return;
      }
    }
    await queueRead(s);
  }

  async function seedTail(s) {
    let fh;
    try {
      const st = await fsp.stat(s.file);
      fh = await fsp.open(s.file, 'r');
      const len = st.size - s.offset;
      const buf = Buffer.allocUnsafe(len);
      await fh.read(buf, 0, len, s.offset);
      s.offset = st.size;
      const text = buf.toString('utf8');
      const nl = text.indexOf('\n');
      const lines = (nl >= 0 ? text.slice(nl + 1) : '').split('\n');
      s.partial = lines.pop();
      for (const line of lines) if (line.trim()) ingestLine(s, line);
      s.lastLineAt = Math.max(s.lastLineAt, st.mtimeMs);
      delete s.dropFirstPartial;
      emitIfChanged(s);
    } catch (e) {
      console.error('[sessions] seed failed', s.file, e.message);
    } finally {
      if (fh) await fh.close().catch(() => {});
    }
  }

  function untrack(file) {
    const parsed = parseFilePath(projectsDir, file);
    if (!parsed) return;
    const id = parsed.agentId ? `${parsed.sessionId}/${parsed.agentId}` : parsed.sessionId;
    if (sessions.delete(id)) {
      lastSent.delete(id);
      pendingChanged.delete(id);
      pendingRemoved.add(id);
      scheduleBroadcast();
    }
  }

  function hidden(s) {
    if (s.dropFirstPartial) return true;
    if (includeHeadless || !s.entrypoint) return false;
    return s.entrypoint !== 'cli';
  }

  function computeStatus(s, now) {
    const quietMs = now - s.lastLineAt;
    const goneAfter = s.agentId ? SUBAGENT_GONE_MS : idleTimeoutMs;
    if (quietMs > goneAfter) return { status: 'gone', activity: 'idle' };
    if (s.pending) return { status: 'working', activity: toolActivity(s.pending.name) };
    if (!s.agentId && helpersOf(s, now) > 0) return { status: 'working', activity: 'agent' };
    if (s.errorUntil > now) return { status: 'thinking', activity: 'error' };
    if (s.lastKind === 'prompt' || s.lastKind === 'tool_result' || s.lastKind === 'tool_use' || s.lastKind === 'thinking') {
      if (quietMs > THINKING_STALE_MS) return { status: 'idle', activity: 'idle' };
      return { status: 'thinking', activity: 'think' };
    }
    if (s.lastKind === 'text') {
      if (quietMs < TOOL_RESULT_DEBOUNCE_MS) return { status: 'thinking', activity: 'think' };
      return { status: 'idle', activity: 'idle' };
    }
    return { status: 'idle', activity: 'idle' };
  }

  function liveNames() {
    const taken = new Set();
    for (const s of sessions.values()) if (s.name) taken.add(s.name);
    return taken;
  }

  function ensureName(s) {
    if (!s.name) s.name = nameFor(s.id, liveNames());
    return s.name;
  }

  function helpersOf(s, now) {
    if (s.agentId) return 0;
    let n = 0;
    for (const o of sessions.values()) {
      if (o.parentId === s.sessionId && now - o.lastLineAt <= SUBAGENT_GONE_MS) n++;
    }
    return n;
  }

  function buildInfo(s, now = Date.now()) {
    const { status, activity } = computeStatus(s, now);
    const tool = s.pending ? s.pending.name : s.lastTool;
    return {
      id: s.id,
      parentId: s.parentId,
      isSubagent: !!s.agentId,
      name: ensureName(s),
      project: s.cwd ? path.basename(s.cwd) : projectFromFile(s.file),
      cwd: s.cwd,
      gitBranch: s.gitBranch,
      title: s.title || s.firstPrompt || null,
      status,
      activity,
      tool: tool || null,
      toolDetail: s.pending ? s.pending.detail : s.lastDetail,
      lastPrompt: s.lastPrompt,
      lastText: s.lastText,
      startedAt: s.startedAt || s.lastLineAt,
      lastActivityAt: Math.max(s.lastActivityAt || 0, s.lastLineAt),
      turns: s.turns,
      toolCounts: s.toolCounts,
      model: s.model,
      permissionMode: s.permissionMode,
      helpers: helpersOf(s, now),
    };
  }

  function projectFromFile(file) {
    const dir = path.basename(path.dirname(path.relative(projectsDir, file).split(path.sep)[0] || ''));
    const proj = path.relative(projectsDir, file).split(path.sep)[0] || dir;
    const parts = proj.split('-').filter(Boolean);
    return parts[parts.length - 1] || proj;
  }

  function emitIfChanged(s) {
    const now = Date.now();
    if (hidden(s)) return;
    const info = buildInfo(s, now);
    if (info.status === 'gone') {
      if (!s.goneAt) {
        s.goneAt = now;
        pendingChanged.set(s.id, info);
        lastSent.set(s.id, JSON.stringify(info));
        scheduleBroadcast();
      } else if (now - s.goneAt >= TICK_MS) {
        sessions.delete(s.id);
        lastSent.delete(s.id);
        pendingChanged.delete(s.id);
        pendingRemoved.add(s.id);
        scheduleBroadcast();
      }
      return;
    }
    const json = JSON.stringify(info);
    if (lastSent.get(s.id) === json) return;
    lastSent.set(s.id, json);
    pendingChanged.set(s.id, info);
    scheduleBroadcast();
  }

  function tick() {
    for (const s of [...sessions.values()]) emitIfChanged(s);
  }

  function getAgents() {
    const now = Date.now();
    const out = [];
    for (const s of sessions.values()) {
      if (hidden(s)) continue;
      const info = buildInfo(s, now);
      if (info.status !== 'gone') out.push(info);
    }
    return out;
  }

  function start() {
    if (watcher) return;
    console.log(`[sessions] watching ${projectsDir} (idle timeout ${idleTimeoutMin} min)`);
    watcher = chokidar.watch(projectsDir, {
      ignoreInitial: false,
      alwaysStat: true,
      depth: 3,
      ignored: (p, st) => !!st && st.isFile() && !p.endsWith('.jsonl'),
      awaitWriteFinish: false,
    });
    watcher.on('add', (file, st) => trackFile(file, st));
    watcher.on('change', (file, st) => trackFile(file, st));
    watcher.on('unlink', untrack);
    watcher.on('error', e => console.error('[sessions] watcher error', e.message));
    tickTimer = setInterval(tick, TICK_MS);
  }

  async function stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (broadcastTimer) clearTimeout(broadcastTimer);
    tickTimer = broadcastTimer = null;
    if (watcher) await watcher.close();
    watcher = null;
  }

  return { start, stop, getAgents, on, idleTimeoutMin, projectsDir };
}
