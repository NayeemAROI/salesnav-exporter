(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
   * LEAD-SEARCH CAPTURE (MAIN world)
   *
   * Runs in the page's own JS context (world: MAIN) so it can see Sales
   * Navigator's own fetch/XHR calls. Each lead-search response contains
   * EVERY lead for a page in a single JSON payload — unlike the DOM, which
   * lazy-loads and sometimes renders only 20–23 of 25 cards.
   *
   * We passively clone matching responses and forward them (URL + JSON) to
   * the isolated content script via postMessage. We never block or modify
   * the page's own requests.
   * ═══════════════════════════════════════════════════ */

  function isLeadSearch(url) {
    if (!url) return false;
    return /salesApiLeadSearch|salesApiPeopleSearch|leadSearch|peopleSearch|searchDashClusters/i.test(String(url));
  }

  const buffer = []; // recent captures, replayed if the content script loads late

  function forward(url, json) {
    buffer.push({ url: String(url), json });
    while (buffer.length > 8) buffer.shift();
    try {
      window.postMessage({ __snxLeadCapture: true, url: String(url), json }, window.location.origin);
    } catch (e) { /* structured-clone/serialization issue — ignore */ }
  }

  // The isolated content script announces itself on load; replay what we have
  // so a capture that fired before it was listening isn't lost.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__snxReady !== true) return;
    for (const b of buffer) {
      try { window.postMessage({ __snxLeadCapture: true, url: b.url, json: b.json }, window.location.origin); } catch (_) {}
    }
  });

  // ── Patch fetch ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = typeof req === 'string' ? req : (req && req.url) || '';
        if (isLeadSearch(url)) {
          promise.then((res) => {
            res.clone().json().then((j) => forward(url, j)).catch(() => {});
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return promise;
    };
  }

  // ── Patch XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__snxUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      if (isLeadSearch(this.__snxUrl)) {
        this.addEventListener('load', function () {
          try { forward(this.__snxUrl, JSON.parse(this.responseText)); } catch (e) {}
        });
      }
    } catch (e) { /* ignore */ }
    return origSend.apply(this, arguments);
  };
})();
