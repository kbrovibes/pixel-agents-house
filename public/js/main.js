import { buildWorld } from './world.js';
import { createRenderer } from './renderer.js';
import { AgentManager } from './agents.js';
import { createUI } from './ui.js';
import { connect } from './net.js';

const params = new URLSearchParams(location.search);

async function boot() {
  const plan = await (await fetch('api/floorplan.json')).json();
  const world = buildWorld(plan);
  const canvas = document.getElementById('world');
  const renderer = createRenderer(canvas, world);
  const manager = new AgentManager(world);

  const state = { floorsMode: ['main','both','auto'].includes(params.get('floors')) ? params.get('floors') : 'auto', labels: false, selectedId: null, hoverId: null, upperSince: 0, upperVisible: false };

  const ui = createUI({
    onSelect: (id) => { state.selectedId = id; ui.setSelected(id ? manager.agents.get(id) : null); },
    onFloorsMode: (m) => { state.floorsMode = m; },
    onLabels: (b) => { state.labels = b; },
    onFullscreen: toggleFullscreen,
  });

  ui.setFloorsMode(state.floorsMode);
  if (params.get('labels') === '1') { state.labels = true; ui.setLabels(true); }
  manager.on('arrive', (a) => ui.toast(`${a.info.name} arrived (${a.info.project})`));
  manager.on('leave', (a) => ui.toast(`${a.info.name} left`));

  if (params.has('demo')) {
    // in-browser simulation: no server needed (used by the GitHub Pages demo)
    const { createDemoWatcher } = await import('./sim/demo.js');
    const sim = createDemoWatcher({ count: Number(params.get('demo')) || 8, fast: params.get('fast') === '1' });
    sim.on('change', (changed, removed) => manager.applyUpdate(changed, removed));
    sim.start();
    manager.config = { napAfterMin: 8 };
    manager.applySnapshot(sim.getAgents());
    ui.setConnected(true);
  } else {
    connect({
      onHello: (msg) => { manager.config = msg.config || {}; },
      onSnapshot: (list) => manager.applySnapshot(list),
      onUpdate: (list, removed) => manager.applyUpdate(list, removed),
      onStatus: (ok) => ui.setConnected(ok),
    });
  }

  // kiosk: hide chrome until the pointer moves, re-hide after a pause
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
    return manager.hitTest(w.floorId, w.wx, w.wy, 3);
  }
  canvas.addEventListener('pointermove', (ev) => {
    const a = pick(ev);
    state.hoverId = a ? a.id : null;
    canvas.classList.toggle('hover', !!a);
  });
  canvas.addEventListener('pointerdown', (ev) => {
    const a = pick(ev);
    const id = a ? a.id : null;
    state.selectedId = id;
    ui.setSelected(a || null);
  });

  window.addEventListener('resize', () => renderer.resize());

  function visibleFloors(now) {
    if (state.floorsMode === 'main') return ['main'];
    if (state.floorsMode === 'both') return ['main', 'upper'];
    const inUse = manager.floorsInUse().has('upper');
    if (inUse) { state.upperSince = now; state.upperVisible = true; }
    else if (state.upperVisible && now - state.upperSince > 1500) state.upperVisible = false;
    return state.upperVisible ? ['main', 'upper'] : ['main'];
  }

  function isNight(d) {
    const m = d.getHours() * 60 + d.getMinutes();
    return m < 6 * 60 + 30 || m > 19 * 60 + 30;
  }

  let last = performance.now(), uiAcc = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const now = Date.now();
    manager.update(dt, now);
    const agents = manager.list;
    renderer.render({
      agents, visibleFloors: visibleFloors(now), selectedId: state.selectedId, hoverId: state.hoverId,
      showLabels: state.labels, now, tick: t / 1000, night: params.has('night') ? params.get('night') === '1' : isNight(new Date()),
    });
    uiAcc += dt;
    if (uiAcc > 0.5) { uiAcc = 0; ui.setAgents(agents); ui.tick(agents); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__pa = { world, manager, renderer, state, ui };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;inset:0;margin:0;padding:24px;color:#b91c1c;background:#fff">Failed to start: ${String(e.message || e)}</pre>`);
});
