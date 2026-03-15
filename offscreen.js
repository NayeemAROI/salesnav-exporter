// Offscreen document used to create Blob/object URLs reliably for downloads.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Only handle MAKE_BLOB_URL messages; silently ignore everything else
  // so we don't race with the background script's response.
  if (msg?.type !== 'MAKE_BLOB_URL') return false;

  (async () => {
    try {

      const content = msg.data || msg.csv;
      if (typeof content !== 'string') {
        sendResponse({ ok: false, error: 'data must be string' });
        return;
      }

      const mime = msg.mimeType || 'text/csv;charset=utf-8';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      sendResponse({ ok: true, url });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
