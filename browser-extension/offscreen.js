/* ═════════════════════════════════════
 * OFFSCREEN DOCUMENT — Blob URL minter
 *
 * MV3 service workers do not expose URL.createObjectURL, so large exports had
 * to be shipped as data: URLs (capped ~2MB, silently truncated/failed beyond
 * that). This offscreen document runs in a normal DOM context, so it CAN build
 * a Blob and hand back a blob: URL with no practical size limit.
 *
 * Protocol (messages are addressed via `target` so the background service
 * worker's own onMessage handlers ignore them):
 *   { target: 'offscreen-blob',   mimeType, content } -> { ok, url }
 *   { target: 'offscreen-revoke', url }               -> { ok }
 * ═════════════════════════════════════ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === 'offscreen-blob') {
    try {
      const blob = new Blob([msg.content ?? ''], { type: msg.mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      sendResponse({ ok: true, url });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return false;
  }

  if (msg?.target === 'offscreen-revoke') {
    try { URL.revokeObjectURL(msg.url); } catch (e) {}
    sendResponse({ ok: true });
    return false;
  }

  // Not ours — let other listeners handle it.
  return false;
});
