// Registers the offline service worker and shows the Install button once the browser
// decides the page is installable (Chrome and Edge fire beforeinstallprompt; Safari never does).
export function initPWA(button) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!button) return;

  let pending = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pending = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { pending = null; button.hidden = true; });
  if (matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) button.hidden = true;

  button.addEventListener('click', async () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    button.hidden = true;
    p.prompt();
    const { outcome } = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') { pending = p; button.hidden = false; }
  });
}
