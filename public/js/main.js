import { buildWorld } from './world.js';
import { createRenderer } from './renderer.js';
import { AgentManager } from './agents.js';
import { createUI } from './ui.js';
import { connect } from './net.js';
import { initPWA } from './pwa.js';

const params = new URLSearchParams(location.search);
const CYCLE = { main: 10000, upper: 5000 };   // camera schedule when both floors are in use

async function boot() {
  initPWA(document.getElementById('btnInstall'));
  const plan = await (await fetch('api/floorplan.json')).json();
  const world = buildWorld(plan);
  const canvas = document.getElementById('world');
  const renderer = createRenderer(canvas, world);
  const manager = new AgentManager(world);

  const state = {
    floorsMode: ['main', 'split', 'auto'].includes(params.get('floors')) ? params.get('floors') : 'auto',
    labels: params.get('labels') === '1', selectedId: null, hoverId: null,
    upperSince: 0, upperVisible: false, phase: 'main', phaseSince: 0,
    toolHistory: [],
  };

  const ui = createUI({
    onSelect: (id) => { state.selectedId = id; ui.setSelected(id ? manager.agents.get(id) : null); },
    onFloorsMode: (m) => { state.floorsMode = m; },
    onLabels: (b) => { state.labels = b; },
    onFullscreen: toggleFullscreen,
  });
  ui.setFloorsMode(state.floorsMode);
  ui.setLabels(state.labels);

  manager.on('arrive', (a) => ui.event(`${a.info.name} arrived · ${a.info.tmux?.session || a.info.project || ''}`));
  manager.on('leave', (a) => ui.event(`${a.info.name} left`));

  if (params.has('demo')) {
    const { createDemoWatcher } = await import('./sim/demo.js');
    const sim = createDemoWatcher({ count: Number(params.get('demo')) || 8, fast: params.get('fast') === '1' });
    sim.on('change', (changed, removed) => manager.applyUpdate(changed, removed));
    sim.start();
    manager.config = { napAfterMin: 8, contextWindow: 200000 };
    ui.setConfig(manager.config);
    manager.applySnapshot(sim.getAgents());
    ui.setConnected(true);
  } else {
    connect({
      onHello: (msg) => { manager.config = msg.config || {}; ui.setConfig(manager.config); },
      onSnapshot: (list) => manager.applySnapshot(list),
      onUpdate: (list, removed) => manager.applyUpdate(list, removed),
      onStatus: (ok) => ui.setConnected(ok),
    });
  }

  let hideTimer = null;
  const kiosk = params.get('kiosk') === '1';
  if (kiosk) ui.setHidden(true);
  function poke() {
    if (!kiosk) return;
    ui.setHidden(false);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => ui.setHidden(true), 4000);
  }
  window.addEventListener('pointermove', poke);
  window.addEventListener('pointerdown', poke);

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
    if (!w) return null;
    return manager.hitTest(w.floorId, w.wx, w.wy, w.pip ? 6 : 3);
  }
  canvas.addEventListener('pointermove', (ev) => {
    const a = pick(ev);
    state.hoverId = a ? a.id : null;
    canvas.classList.toggle('hover', !!a);
  });
  canvas.addEventListener('pointerdown', (ev) => {
    const a = pick(ev);
    state.selectedId = a ? a.id : null;
    ui.setSelected(a || null);
  });
  window.addEventListener('resize', () => renderer.resize());

  function viewMode(now) {
    if (state.floorsMode === 'main') return { primary: 'main', pip: null, split: false };
    if (state.floorsMode === 'split') return { primary: 'main', pip: null, split: true };
    const inUse = manager.floorsInUse().has('upper');
    if (inUse) { state.upperSince = now; state.upperVisible = true; }
    else if (state.upperVisible && now - state.upperSince > 1500) { state.upperVisible = false; state.phase = 'main'; }
    if (!state.upperVisible) return { primary: 'main', pip: null, split: false };
    if (now - state.phaseSince > CYCLE[state.phase]) { state.phase = state.phase === 'main' ? 'upper' : 'main'; state.phaseSince = now; }
    return state.phase === 'main' ? { primary: 'main', pip: 'upper', split: false } : { primary: 'upper', pip: 'main', split: false };
  }

  function isNight(d) {
    const m = d.getHours() * 60 + d.getMinutes();
    return m < 6 * 60 + 30 || m > 19 * 60 + 30;
  }

  function stats(agents, now) {
    const live = agents.filter(a => a.state !== 'gone');
    const calls = live.reduce((n, a) => n + Object.values(a.info.toolCounts || {}).reduce((x, y) => x + y, 0), 0);
    state.toolHistory.push([now, calls]);
    while (state.toolHistory.length > 1 && now - state.toolHistory[0][0] > 300000) state.toolHistory.shift();
    const ctxs = live.map(a => a.info.contextTokens || 0).filter(Boolean);
    const sessions = new Set(live.map(a => a.info.tmux?.session).filter(Boolean));
    return {
      total: live.length,
      working: live.filter(a => a.info.status === 'working').length,
      thinking: live.filter(a => a.info.status === 'thinking').length,
      idle: live.filter(a => a.info.status === 'idle').length,
      napping: live.filter(a => a.pose === 'sleep').length,
      helpers: live.filter(a => a.info.isSubagent).length,
      ctxAvg: ctxs.length ? Math.round(ctxs.reduce((x, y) => x + y, 0) / ctxs.length) : 0,
      ctxMax: ctxs.length ? Math.max(...ctxs) : 0,
      toolRate: Math.max(0, calls - state.toolHistory[0][1]),
      sessions: sessions.size,
    };
  }

  let last = performance.now(), uiAcc = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const now = Date.now();
    manager.update(dt, now);
    const agents = manager.list;
    renderer.render({
      agents, mode: viewMode(now), selectedId: state.selectedId, hoverId: state.hoverId,
      showLabels: state.labels, now, tick: t / 1000, night: params.has('night') ? params.get('night') === '1' : isNight(new Date()),
    });
    uiAcc += dt;
    if (uiAcc > 0.5) { uiAcc = 0; ui.setAgents(agents); ui.setStats(stats(agents, now)); ui.tick(agents); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__pa = { world, manager, renderer, state, ui };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;inset:0;margin:0;padding:24px;color:#b91c1c;background:#fff">Failed to start: ${String(e.message || e)}</pre>`);
});
