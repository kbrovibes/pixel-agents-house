// DOM chrome: top bar, roster, details card, toasts, keyboard shortcuts.
import { CHORE_LABEL } from './sprites.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  if (s === 'working') return a.info.tool || 'working';
  return s;
}

export function createUI(handlers = {}) {
  const els = {
    dot: $('liveDot'), count: $('agentCount'), clock: $('clock'), floorsSeg: $('floorsSeg'),
    btnLabels: $('btnLabels'), btnFull: $('btnFull'), btnHide: $('btnHide'),
    roster: $('roster'), rosterToggle: $('rosterToggle'), rosterList: $('rosterList'), rosterEmpty: $('rosterEmpty'),
    details: $('details'), toasts: $('toasts'),
  };
  let selected = null;
  let lastSig = '';
  let hidden = false;
  let labels = false;

  els.floorsSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    setFloorsMode(b.dataset.mode);
    handlers.onFloorsMode?.(b.dataset.mode);
  });
  els.btnLabels.addEventListener('click', () => { setLabels(!labels); handlers.onLabels?.(labels); });
  els.btnFull.addEventListener('click', () => handlers.onFullscreen?.());
  els.btnHide.addEventListener('click', () => { setHidden(true); });
  els.rosterToggle.addEventListener('click', () => els.roster.classList.toggle('collapsed'));
  els.rosterList.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) handlers.onSelect?.(row.dataset.id === selected?.id ? null : row.dataset.id);
  });
  els.details.addEventListener('click', (e) => {
    if (e.target.closest('.close')) handlers.onSelect?.(null);
  });

  function setFloorsMode(m) {
    for (const b of els.floorsSeg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
  }
  function setLabels(b) { labels = !!b; els.btnLabels.classList.toggle('on', labels); }
  function setHidden(b) { hidden = !!b; document.body.classList.toggle('ui-hidden', hidden); }
  function setConnected(b) {
    els.dot.classList.toggle('live', !!b);
    els.dot.title = b ? 'Connected' : 'Disconnected';
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    els.toasts.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  function setAgents(agents) {
    const live = agents.filter(a => a.state !== 'gone');
    els.count.textContent = `${live.length} agent${live.length === 1 ? '' : 's'}`;
    els.rosterEmpty.hidden = live.length > 0;
    const sorted = [...live].sort((a, b) => (a.info.isSubagent - b.info.isSubagent) || a.info.name.localeCompare(b.info.name));
    const sig = sorted.map(a => `${a.id}|${a.info.status}|${statusText(a)}|${a.info.name}|${a.id === selected?.id}`).join(';');
    if (sig === lastSig) return;
    lastSig = sig;
    els.rosterList.innerHTML = sorted.map(a => {
      const st = a.info.status === 'gone' ? 'gone' : a.info.status;
      return `<li class="row ${a.id === selected?.id ? 'sel' : ''} ${st === 'gone' ? 'gone' : ''}" data-id="${esc(a.id)}">
        <span class="sw" style="background:${esc(a.palette?.shirt || '#999')}"></span>
        <span class="rt"><div class="nm">${esc(a.info.name)}${a.info.isSubagent ? ' <span class="sub">helper</span>' : ''}</div><div class="pj">${esc(a.info.project || '')}</div></span>
        <span class="pill ${st}">${esc(statusText(a))}</span></li>`;
    }).join('');
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
    const doing = a.pose === 'sleep' ? 'napping' : a.state === 'thinking' ? 'thinking' : a.state === 'walking' || a.state === 'arriving' ? 'walking' : a.state === 'leaving' ? 'heading out' : (CHORE_LABEL[a.chore] || a.chore || 'standing around');
    const counts = Object.entries(i.toolCounts || {}).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const max = counts[0]?.[1] || 1;
    els.details.innerHTML = `
      <div class="head"><span class="sw" style="background:${esc(a.palette?.shirt || '#999')}"></span><h2>${esc(i.name)}</h2>
        <button type="button" class="icon close" aria-label="Close">&times;</button></div>
      ${i.title ? `<p class="title">${esc(i.title)}</p>` : ''}
      <dl>
        <dt>Status</dt><dd><span class="pill ${esc(i.status)}">${esc(i.status)}</span> &nbsp;${esc(where)} · ${esc(doing)}</dd>
        ${i.tool ? `<dt>Tool</dt><dd><code>${esc(i.tool)}</code> ${esc(i.toolDetail || '')}</dd>` : ''}
        <dt>Project</dt><dd>${esc(i.project || '')}${i.gitBranch ? ` <span class="pj">(${esc(i.gitBranch)})</span>` : ''}</dd>
        ${i.cwd ? `<dt>Folder</dt><dd><code>${esc(i.cwd)}</code></dd>` : ''}
        <dt>Turns</dt><dd>${i.turns ?? 0}${i.helpers ? ` · ${i.helpers} helper${i.helpers === 1 ? '' : 's'}` : ''}</dd>
        <dt>Started</dt><dd>${i.startedAt ? ago(now - i.startedAt) + ' ago' : '–'}</dd>
        <dt>Last active</dt><dd>${i.lastActivityAt ? ago(now - i.lastActivityAt) + ' ago' : '–'}</dd>
        ${i.model ? `<dt>Model</dt><dd>${esc(i.model)}</dd>` : ''}
        ${i.isSubagent ? `<dt>Helper of</dt><dd>${esc(i.parentId?.slice(0, 8) || '')}</dd>` : ''}
      </dl>
      ${i.lastPrompt ? `<p class="quote"><b>Last prompt</b>${esc(i.lastPrompt)}</p>` : ''}
      ${i.lastText ? `<p class="quote"><b>Last reply</b>${esc(i.lastText)}</p>` : ''}
      ${counts.length ? `<div class="bars">${counts.map(([k, v]) => `<span class="lbl">${esc(k)}</span><span class="bar"><i style="width:${Math.round(v / max * 100)}%"></i></span><span class="n">${v}</span>`).join('')}</div>` : ''}`;
  }

  function tick(agents) {
    const d = new Date();
    els.clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      case '2': setFloorsMode('both'); handlers.onFloorsMode?.('both'); break;
      case '0': setFloorsMode('auto'); handlers.onFloorsMode?.('auto'); break;
      case 'escape': handlers.onSelect?.(null); break;
      default: return;
    }
  });

  return { setAgents, setSelected, setConnected, toast, setFloorsMode, setLabels, setHidden, tick, get hidden() { return hidden; } };
}
