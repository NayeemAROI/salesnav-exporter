(function () {
  'use strict';

  /* ═════════════════════════════════════
   * LEAD-SEARCH CAPTURE (MAIN world)
   *
   * Runs in the page's own JS context so it can see Sales Navigator's own
   * fetch/XHR. Each lead-search response holds EVERY lead for a page in one
   * JSON payload — unlike the DOM, which lazy-loads and can miss cards.
   *
   * Matching is SHAPE-based (any API response carrying a lead-like `elements`
   * array), not URL-based, because SN's endpoint name varies. A discovery log
   * ([SNX url]) prints candidate endpoints + field names so the parser can be
   * pinned to the live payload.
   * ═════════════════════════════════════ */

  const DISCOVER = false; // set true to print endpoint/field discovery logs while pinning the parser

  if (DISCOVER) { try { console.log('%c[SNX cap] injector active (MAIN world)', 'color:#16a34a;font-weight:bold'); } catch (e) {} }

  function isApiUrl(url) {
    return /(sales-api|voyager|graphql|salesApi|search|lead)/i.test(String(url || ''));
  }

  // Find a lead-like array anywhere shallow in the payload (top-level or under
  // `data`, `elements`, `included`, or a graphql cluster).
  function findLeadArray(json, depth) {
    if (!json || typeof json !== 'object' || depth > 4) return null;
    if (Array.isArray(json)) {
      return looksLikeLeads(json) ? json : null;
    }
    if (Array.isArray(json.elements) && looksLikeLeads(json.elements)) return json.elements;
    if (Array.isArray(json.included) && looksLikeLeads(json.included)) return json.included;
    for (const k of Object.keys(json)) {
      const v = json[k];
      if (v && typeof v === 'object') {
        const found = findLeadArray(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function looksLikeLeads(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return false;
    let hits = 0;
    for (const e of arr.slice(0, 6)) {
      if (!e || typeof e !== 'object') continue;
      if (e.firstName || e.lastName || e.fullName || e.formattedName) { hits++; continue; }
      const urn = JSON.stringify(e.entityUrn || e.objectUrn || e.memberUrn || e.profileUrn || '');
      if (/salesProfile|fs_lead|fsd_profile|member/i.test(urn)) hits++;
    }
    return hits >= 2;
  }

  const seen = new Set();
  function discover(url, json) {
    if (!DISCOVER) return;
    let path;
    try { path = new URL(url, location.origin).pathname; } catch (e) { path = String(url).slice(0, 90); }
    const arr = findLeadArray(json, 0);
    if (arr) {
      // Always log lead arrays (per page) — this is the jackpot line.
      const sample = arr.find((x) => x && typeof x === 'object') || {};
      console.log('%c[SNX url] LEADS @', 'color:#16a34a;font-weight:bold', path, 'count=', arr.length, 'keys=', Object.keys(sample));
      return;
    }
    // Otherwise log each unique API path once so the lead endpoint can't hide.
    if (seen.has(path)) return;
    seen.add(path);
    const top = json && typeof json === 'object' ? Object.keys(json).slice(0, 12) : typeof json;
    console.log('%c[SNX url]', 'color:#eab308', path, 'topKeys=', top);
  }

  const buffer = []; // recent captures, replayed if the content script loads late
  function forward(url, leads) {
    buffer.push({ url: String(url), leads });
    while (buffer.length > 8) buffer.shift();
    try {
      window.postMessage({ __snxLeadCapture: true, url: String(url), leads }, window.location.origin);
    } catch (e) { /* serialization issue — ignore */ }
  }

  function handle(url, json) {
    if (!isApiUrl(url)) return;
    try { discover(url, json); } catch (e) {}
    const arr = findLeadArray(json, 0);
    if (arr) forward(url, arr);
  }

  // Replay buffered captures when the isolated content script announces itself.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__snxReady !== true) return;
    for (const b of buffer) {
      try { window.postMessage({ __snxLeadCapture: true, url: b.url, leads: b.leads }, window.location.origin); } catch (_) {}
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
        if (isApiUrl(url)) {
          promise.then((res) => { res.clone().json().then((j) => handle(url, j)).catch(() => {}); }).catch(() => {});
        }
      } catch (e) {}
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
      if (isApiUrl(this.__snxUrl)) {
        this.addEventListener('load', function () {
          try { handle(this.__snxUrl, JSON.parse(this.responseText)); } catch (e) {}
        });
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };
})();
