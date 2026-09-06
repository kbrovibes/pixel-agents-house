// DOM chrome: top pills, roster, details card, legend with stats and an event ticker, keyboard shortcuts.
import { CHORE_LABEL } from './sprites.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const k = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function statusText(a) {
  const s = a.info.status;
  if (s === 'idle') return a.pose === 'sleep' ? 'napping' : 'idle';
  if (s === 'working') return { read: 'reading', write: 'editing', bash: 'shell', web: 'web', agent: 'delegating', error: 'error' }[a.info.activity] || 'working';
  return s;
}

function doingText(a) {
  if (a.pose === 'sleep') return 'napping';
  if (a.state === 'thinking') return 'thinking';
  if (a.state === 'walking' || a.state === 'arriving') return a.strolling ? 'strolling' : 'walking';
  if (a.state === 'leaving') return 'heading out';
  return CHORE_LABEL[a.chore] || a.chore || 'standing around';
}

export function createUI(handlers = {}) {
  const els = {
    dot: $('liveDot'), count: $('agentCount'), floorsSeg: $('floorsSeg'),
    btnLabels: $('btnLabels'), btnFull: $('btnFull'), btnHide: $('btnHide'),
    roster: $('roster'), rosterToggle: $('rosterToggle'), rosterList: $('rosterList'), rosterEmpty: $('rosterEmpty'),
    details: $('details'), stats: $('stats'), ticker: $('ticker'), addr: $('addr'),
  };
  let selected = null, lastSig = '', hidden = false, labels = false;
  let contextWindow = 200000;
  const events = [];

  els.floorsSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    setFloorsMode(b.dataset.mode);
    handlers.onFloorsMode?.(b.dataset.mode);
  });
  els.btnLabels.addEventListener('click', () => { setLabels(!labels); handlers.onLabels?.(labels); });
  els.btnFull.addEventListener('click', () => handlers.onFullscreen?.());
  els.btnHide.addEventListener('click', () => setHidden(true));
  els.rosterToggle.addEventListener('click', () => els.roster.classList.toggle('collapsed'));
  els.rosterList.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) handlers.onSelect?.(row.dataset.id === selected?.id ? null : row.dataset.id);
  });
  els.details.addEventListener('click', (e) => { if (e.target.closest('.close')) handlers.onSelect?.(null); });

  function setFloorsMode(m) { for (const b of els.floorsSeg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m); }
  function setLabels(b) { labels = !!b; els.btnLabels.classList.toggle('on', labels); }
  function setHidden(b) { hidden = !!b; document.body.classList.toggle('ui-hidden', hidden); }
  function setConnected(b) { els.dot.classList.toggle('live', !!b); els.dot.title = b ? 'Connected' : 'Disconnected'; }
  function setConfig(cfg) {
    if (cfg?.contextWindow) contextWindow = cfg.contextWindow;
    const urls = [cfg?.urls?.named, ...(cfg?.urls?.lan || [])].filter(Boolean);
    els.addr.innerHTML = urls.map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, ''))}</a>`).join('<span class="sep">·</span>');
    els.addr.hidden = urls.length === 0;
  }

  // subtle event log in the legend instead of pop-up toasts
  function event(text) {
    const d = new Date();
    events.unshift({ t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, text });
    events.splice(6);
    els.ticker.innerHTML = events.map(e => `<div class="ev"><span class="t">${e.t}</span>${esc(e.text)}</div>`).join('');
  }

  function setAgents(agents) {
    const live = agents.filter(a => a.state !== 'gone');
    els.count.textContent = `${live.length} agent${live.length === 1 ? '' : 's'}`;
    els.rosterEmpty.hidden = live.length > 0;
    const sorted = [...live].sort((a, b) => (a.info.isSubagent - b.info.isSubagent) || a.info.name.localeCompare(b.info.name));
    const sig = sorted.map(a => `${a.id}|${a.info.status}|${statusText(a)}|${a.info.name}|${a.info.tmux?.session}|${a.id === selected?.id}`).join(';');
    if (sig === lastSig) return;
    lastSig = sig;
    els.rosterList.innerHTML = sorted.map(a => {
      const st = a.info.status;
      const where = a.info.tmux?.session ? `${a.info.tmux.session} · ${a.info.project || ''}` : (a.info.project || '');
      return `<li class="row ${a.id === selected?.id ? 'sel' : ''}" data-id="${esc(a.id)}">
        <span class="sw" style="background:${esc(a.palette?.shirt || '#999')}"></span>
        <span class="rt"><div class="nm">${esc(a.info.name)}${a.info.isSubagent ? ' <span class="sub">helper</span>' : ''}</div><div class="pj">${esc(where)}</div></span>
        <span class="pill ${esc(st)}">${esc(statusText(a))}</span></li>`;
    }).join('');
  }

  function setStats(st) {
    const ctx = st.ctxMax ? `${k(st.ctxAvg)} avg · ${k(st.ctxMax)} max <span class="dim">of ${k(contextWindow)}</span>` : '–';
    els.stats.innerHTML = `
      <div class="st"><b>${st.total}</b><span>agents</span></div>
      <div class="st"><b>${st.working}</b><span>working</span></div>
      <div class="st"><b>${st.thinking}</b><span>thinking</span></div>
      <div class="st"><b>${st.idle}</b><span>idle${st.napping ? ` · ${st.napping} napping` : ''}</span></div>
      <div class="st wide"><b>${ctx}</b><span>context</span></div>
      <div class="st"><b>${st.toolRate}</b><span>tool calls / 5 min</span></div>
      <div class="st"><b>${st.helpers}</b><span>helpers</span></div>
      <div class="st"><b>${st.sessions}</b><span>tmux sessions</span></div>`;
  }

  function setSelected(agent) {
    selected = agent || null;
    lastSig = '';
    if (!agent) { els.details.hidden = true; return; }
    els.details.hidden = false;
    renderDetails(agent);
  }

  function renderDetails(a) {
    const i = a.info;
    const now = Date.now();
    const where = a.room ? `in the ${a.room.name}` : 'outside';
    const counts = Object.entries(i.toolCounts || {}).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const max = counts[0]?.[1] || 1;
    const pct = i.contextTokens ? Math.min(100, Math.round(i.contextTokens / contextWindow * 100)) : 0;
    els.details.innerHTML = `
      <div class="head"><span class="sw" style="background:${esc(a.palette?.shirt || '#999')}"></span><h2>${esc(i.name)}</h2>
        <button type="button" class="icon close" aria-label="Close">&times;</button></div>
      ${i.tmux?.session ? `<p class="title"><b>${esc(i.tmux.session)}</b>${i.tmux.window ? ` · ${esc(i.tmux.window)}` : ''}${i.title ? ` — ${esc(i.title)}` : ''}</p>` : (i.title ? `<p class="title">${esc(i.title)}</p>` : '')}
      <dl>
        <dt>Status</dt><dd><span class="pill ${esc(i.status)}">${esc(i.status)}</span> &nbsp;${esc(where)} · ${esc(doingText(a))}</dd>
        ${i.tool ? `<dt>Tool</dt><dd><code>${esc(i.tool)}</code> ${esc(i.toolDetail || '')}</dd>` : ''}
        <dt>Project</dt><dd>${esc(i.project || '')}${i.gitBranch ? ` <span class="pj">(${esc(i.gitBranch)})</span>` : ''}</dd>
        ${i.contextTokens ? `<dt>Context</dt><dd>≈ ${k(i.contextTokens)} tokens <span class="pj">(${pct}%)</span><span class="bar ctx"><i style="width:${pct}%"></i></span></dd>` : ''}
        <dt>Turns</dt><dd>${i.turns ?? 0}${i.helpers ? ` · ${i.helpers} helper${i.helpers === 1 ? '' : 's'}` : ''}${i.outputTokens ? ` · ${k(i.outputTokens)} tokens written` : ''}</dd>
        <dt>Started</dt><dd>${i.startedAt ? ago(now - i.startedAt) + ' ago' : '–'}</dd>
        <dt>Last active</dt><dd>${i.lastActivityAt ? ago(now - i.lastActivityAt) + ' ago' : '–'}</dd>
        ${i.model ? `<dt>Model</dt><dd>${esc(i.model)}</dd>` : ''}
        ${i.isSubagent ? `<dt>Helper of</dt><dd>${esc(i.parentId?.slice(0, 8) || '')}</dd>` : ''}
      </dl>
      ${i.lastPrompt ? `<p class="quote"><b>Last prompt</b>${esc(i.lastPrompt)}</p>` : ''}
      ${i.lastText ? `<p class="quote"><b>Last reply</b>${esc(i.lastText)}</p>` : ''}
      ${counts.length ? `<div class="bars">${counts.map(([kk, v]) => `<span class="lbl">${esc(kk)}</span><span class="bar"><i style="width:${Math.round(v / max * 100)}%"></i></span><span class="n">${v}</span>`).join('')}</div>` : ''}`;
  }

  function tick(agents) {
    if (selected) {
      const a = agents.find(x => x.id === selected.id);
      if (a) renderDetails(a); else setSelected(null);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    switch (e.key.toLowerCase()) {
      case 'f': handlers.onFullscreen?.(); break;
      case 'h': setHidden(!hidden); break;
      case 'l': setLabels(!labels); handlers.onLabels?.(labels); break;
      case '1': setFloorsMode('main'); handlers.onFloorsMode?.('main'); break;
      case '2': setFloorsMode('split'); handlers.onFloorsMode?.('split'); break;
      case '0': setFloorsMode('auto'); handlers.onFloorsMode?.('auto'); break;
      case 'escape': handlers.onSelect?.(null); break;
      default: return;
    }
  });

  return { setAgents, setSelected, setConnected, setConfig, setStats, event, setFloorsMode, setLabels, setHidden, tick, get hidden() { return hidden; } };
}
