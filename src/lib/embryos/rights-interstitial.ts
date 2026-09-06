/**
 * The only script in the credential interstitial. This is a plain document,
 * not a hydrated application: fragment removal must run synchronously before
 * any body is parsed or any application/analytics script can start. The raw
 * credential is never put in the DOM, a global, or browser storage.
 */
export function rightsInterstitialScript(formToken: string): string {
  // The value is a server-minted sealed form, not a URL or user-controlled
  // string. Still escape HTML's script terminator when serializing it.
  const nonce = JSON.stringify(formToken).replaceAll("<", "\\u003c");
  return `(() => {
  let token = '';
  let button;
  let status;
  function captureFragment() {
    token = location.hash.slice(1, 45);
    history.replaceState(null, '', '/withdraw/request');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) token = '';
    if (button) {
      button.disabled = !token;
      status.textContent = token ? '' : 'Open the full link from your email to continue.';
    }
  }
  captureFragment();
  const expires = Date.now() + 600000;
  addEventListener('hashchange', captureFragment);
  addEventListener('pagehide', () => { token = ''; });
  setTimeout(() => { token = ''; }, 600000);
  document.addEventListener('DOMContentLoaded', () => {
    button = document.getElementById('activate');
    status = document.getElementById('status');
    if (!token) {
      status.textContent = 'Open the full link from your email to continue.';
    }
    button.disabled = !token;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (!token || Date.now() >= expires) {
        token = '';
        status.textContent = 'This page has expired. Open the link from your email again.';
        return;
      }
      status.textContent = 'Opening your request…';
      const pending = fetch('/api/rights/activate', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, nonce: ${nonce} })
      });
      token = '';
      try {
        const response = await pending;
        if (response.redirected && new URL(response.url).origin === location.origin
            && new URL(response.url).pathname === '/withdraw/session') {
          location.replace('/withdraw/session');
          return;
        }
        status.textContent = 'This link is unavailable. It may have expired or already been used.';
      } catch {
        status.textContent = 'We could not confirm the result. Try Continue an open request below.';
      }
    });
  }, { once: true });
})();`;
}
