// WebSocket client with exponential-backoff reconnect.
export function connect({ onHello, onSnapshot, onUpdate, onStatus } = {}) {
  let ws = null, delay = 1000, pingTimer = null, closed = false;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch (e) { schedule(); return; }
    ws.onopen = () => {
      delay = 1000;
      onStatus?.(true);
      pingTimer = setInterval(() => { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); }, 25000);
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg?.type) {
        case 'hello': onHello?.(msg); break;
        case 'snapshot': onSnapshot?.(msg.agents || [], msg); break;
        case 'update': onUpdate?.(msg.agents || [], msg.removed || [], msg); break;
        default: break;
      }
    };
    ws.onclose = () => { clearInterval(pingTimer); pingTimer = null; onStatus?.(false); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function schedule() {
    if (closed) return;
    setTimeout(open, delay);
    delay = Math.min(delay * 2, 10000);
  }
  open();
  return { close() { closed = true; clearInterval(pingTimer); try { ws?.close(); } catch {} } };
}
