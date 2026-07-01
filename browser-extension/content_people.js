(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
   * SalesNav Exporter — Expert Data Extraction Engine
   * 
   * Techniques used (from top scraper research):
   * 1. data-anonymize / aria-label attribute targeting
   * 2. MutationObserver for DOM readiness detection
   * 3. Structural DOM traversal (parent→child walks)
   * 4. Multiple selector fallback chains
   * 5. Regex-free field isolation where possible
   * ═══════════════════════════════════════════════════ */

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ─── DOM Utilities ─── */
  function txt(el) { return el ? (el.textContent || '').trim() : ''; }
  function attr(el, a) { return el ? (el.getAttribute(a) || '').trim() : ''; }

  /** Direct text content (excludes child elements) */
  function directTxt(el) {
    if (!el) return '';
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
    return s.trim();
  }

  /** Resolve relative href to absolute */
  function absUrl(href) {
    if (!href) return '';
    try { return new URL(href, location.origin).toString(); } catch { return ''; }
  }

  /** Split a full name into parts */
  function splitName(full) {
    const p = (full || '').trim().split(/\s+/).filter(Boolean);
    return {
      first_name: p[0] || '',
      last_name: p.slice(1).join(' ') || '',
      full_name: (full || '').trim()
    };
  }

  /* ─── MutationObserver-based DOM Readiness ─── */
  /**
   * Wait until at least `minCount` elements matching `selector` exist,
   * or until `timeoutMs` elapses. Uses MutationObserver for efficiency
   * instead of polling with sleep loops.
   */
  function waitForElements(selector, minCount = 1, timeoutMs = 30000) {
    return new Promise(resolve => {
      const existing = document.querySelectorAll(selector);
      if (existing.length >= minCount) return resolve(existing);

      let observer;
      const timer = setTimeout(() => {
        if (observer) observer.disconnect();
        resolve(document.querySelectorAll(selector));
      }, timeoutMs);

      observer = new MutationObserver(() => {
        const els = document.querySelectorAll(selector);
        if (els.length >= minCount) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(els);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ═══════════════════════════════════════════════════
   * SELECTOR CHAINS
   * Each field has a prioritized chain of selectors.
   * Falls through to next if the first returns empty.
   * ═══════════════════════════════════════════════════ */

  const SEL = {
    // Card container: <li> elements with lead links
    card: 'main li',
    leadLink: 'a[href*="/sales/lead/"]',
    leadLinkPrimary: 'a[href*="/sales/lead/"]:not([aria-label^="Go to"])',

    // Profile image (LinkedIn CDN)
    image: [
      'img[src*="media.licdn.com"]',
      'img[src*="dms/image"]',
      'img[data-anonymize="avatar"]',
      '.presence-entity__image',
      'img.lazy-image'
    ],

    // Headline / Title
    headline: [
      '[data-anonymize="headline"]',
      '.artdeco-entity-lockup__subtitle',
      '[data-anonymize="job-title"]',
      '[data-anonymize="title"]'
    ],

    // Company link
    company: 'a[href*="/sales/company/"]',

    // Industry
    industry: '[data-anonymize="industry"]',

    // Location
    location: [
      '[data-anonymize="location"]',
      '[data-anonymize="geography"]',
    ],

    // Connection degree badges
    degree: [
      '.artdeco-entity-lockup__degree',
      '[data-anonymize="degree"]',
    ],

    // Premium / OpenLink
    premium: [
      '[data-test-badge-premium]',
      '.premium-icon',
      '[aria-label*="premium" i]',
      'li-icon[type="linkedin-premium-gold"]'
    ],
    openLink: [
      '[data-test-badge-openlink]',
      '[aria-label*="open profile" i]',
      '[aria-label*="openlink" i]',
      'li-icon[type="open-in-new"]'
    ]
  };

  /** Query with fallback chain — returns first match */
  function q(root, selectors) {
    const arr = Array.isArray(selectors) ? selectors : [selectors];
    for (const s of arr) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════
   * INDUSTRY RESOLVER — Sales Navigator internal API
   *
   * Deep Fetch no longer hovers over each lead. Instead we
   * read the company id from each card's company link and ask
   * LinkedIn's own Sales Navigator company endpoint for the
   * canonical industry value. Same-origin fetch → auth cookies
   * flow automatically; we only need the CSRF token.
   *
   *   • One request per UNIQUE company (cached), not per lead.
   *   • Bounded concurrency so we don't hammer the endpoint.
   *   • Any error / missing field → '' (leave blank, never guess).
   * ═══════════════════════════════════════════════════ */
  const industryCache = new Map(); // companyId -> industry ('' = resolved, none found)

  /** LinkedIn's CSRF token is the JSESSIONID cookie value (quotes stripped). */
  function getCsrfToken() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return m ? m[1] : '';
  }

  /** Extract the Sales Navigator company id from a /sales/company/<id> URL. */
  function companyIdFromUrl(url) {
    return (url || '').match(/\/sales\/company\/([^,/?#]+)/)?.[1] || '';
  }

  /**
   * Recursively locate an industry label inside an arbitrary API JSON.
   * Robust to shape drift: handles a plain `industry` string, and the
   * common array shapes (`companyIndustries` / `industries` / `industryV2`)
   * whose entries may be strings or objects with localizedName/name.
   */
  function findIndustryInJson(node, depth = 0) {
    if (!node || depth > 6) return '';
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findIndustryInJson(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    if (typeof node === 'object') {
      if (typeof node.industry === 'string' && node.industry.trim()) {
        return node.industry.trim();
      }
      for (const key of ['companyIndustries', 'industries', 'industryV2']) {
        const v = node[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (Array.isArray(v) && v.length) {
          const first = v[0];
          if (typeof first === 'string' && first.trim()) return first.trim();
          if (first && typeof first === 'object') {
            const name = first.localizedName || first.name || first.value || '';
            if (name && String(name).trim()) return String(name).trim();
          }
        }
      }
      for (const k in node) {
        if (k === 'industryUrn' || k === 'industryUrns') continue; // urn only, no label
        const found = findIndustryInJson(node[k], depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  // Flip to true to print per-request diagnostics to the page console.
  const SNX_DEBUG = false;
  const dbg = (...a) => { if (SNX_DEBUG) console.log('%c[SNX industry]', 'color:#f97316', ...a); };

  /**
   * Fetch (and cache) a single company's industry via LinkedIn's Voyager
   * organization endpoint. Confirmed on live sessions: this returns the
   * canonical industry (companyIndustries[].localizedName). The sales-api
   * company endpoint 400s / omits industry, so we don't call it.
   */
  async function fetchCompanyIndustry(companyId) {
    if (!companyId) return '';
    if (industryCache.has(companyId)) return industryCache.get(companyId);

    const csrf = getCsrfToken();
    const headers = {
      'accept': 'application/json',
      'x-restli-protocol-version': '2.0.0',
    };
    if (csrf) headers['csrf-token'] = csrf;

    const encId = encodeURIComponent(companyId);
    const urls = [
      `https://www.linkedin.com/voyager/api/organization/companies/${encId}`,
      `https://www.linkedin.com/voyager/api/entities/companies/${encId}`, // legacy fallback
    ];

    let industry = '';
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) { dbg('HTTP', res.status, url); continue; }
        if (!ct.includes('json')) { dbg('non-JSON', ct, url); continue; }
        industry = findIndustryInJson(await res.json());
        dbg(industry ? `OK "${industry}"` : 'JSON but no industry field', url);
        if (industry) break;
      } catch (e) {
        dbg('threw', String(e), url);
      }
    }

    if (!csrf) dbg('WARNING: no JSESSIONID/CSRF token found — LinkedIn will reject the request');
    industryCache.set(companyId, industry);
    return industry;
  }

  /** Resolve many company ids with bounded concurrency → Map(id → industry). */
  async function resolveIndustries(companyIds, concurrency = 5) {
    const ids = [...new Set(companyIds.filter(Boolean))];
    const map = new Map();
    let i = 0;
    async function worker() {
      while (i < ids.length) {
        const id = ids[i++];
        map.set(id, await fetchCompanyIndustry(id));
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, ids.length) }, worker)
    );
    return map;
  }

  /* ═══════════════════════════════════════════════════
   * LEAD-SEARCH API CAPTURE (isolated world)
   *
   * inject_capture.js (MAIN world) forwards Sales Navigator's own lead-search
   * responses here. Each payload holds every lead for a page, so we prefer it
   * over DOM scraping (which lazy-loads and can miss cards) and fall back to
   * the DOM only if a clean capture isn't available.
   * ═══════════════════════════════════════════════════ */
  const SNX_CAP_DEBUG = true; // logs capture diagnostics to the page console
  const dbgCap = (...a) => { if (SNX_CAP_DEBUG) console.log('%c[SNX cap]', 'color:#22c55e', ...a); };

  const capturedPages = []; // { start, leads:[...], ts }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__snxLeadCapture !== true) return;
    try {
      const start = parseStartOffset(d.url);
      const raw = Array.isArray(d.leads) ? d.leads : [];
      const leads = raw.map(leadFromElement).filter(Boolean);
      if (leads.length) {
        capturedPages.push({ start, leads, ts: Date.now() });
        while (capturedPages.length > 20) capturedPages.shift();
        dbgCap(`captured ${leads.length}/${raw.length} leads (start=${start})`, d.url);
      } else {
        dbgCap(`lead array received (${raw.length}) but 0 parsed. sample keys:`,
          raw[0] && typeof raw[0] === 'object' ? Object.keys(raw[0]) : typeof raw[0]);
      }
    } catch (err) {
      dbgCap('parse error', String(err));
    }
  });

  // Tell the MAIN-world capture script we're listening so it can replay any
  // lead-search response that arrived before this script attached.
  try { window.postMessage({ __snxReady: true }, window.location.origin); } catch (e) {}

  function parseStartOffset(url) {
    const m = String(url || '').match(/[?&(,]start[=:](\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Pull the leads array out of an SN lead-search JSON payload. */
  function parseLeadSearchJson(json) {
    if (!json || typeof json !== 'object') return null;
    const arr =
      (Array.isArray(json.elements) && json.elements) ||
      (json.data && Array.isArray(json.data.elements) && json.data.elements) ||
      null;
    if (!arr) return null;
    return arr.map(leadFromElement).filter(Boolean);
  }

  /** Extract the Sales Navigator lead id from a lead element's urn. */
  function leadIdFromElement(el) {
    const urn = el.entityUrn || el.objectUrn || el.memberUrn || el.profileUrn || '';
    let m = String(urn).match(/fs_salesProfile:\(([^,)]+)/);
    if (m) return m[1];
    m = String(urn).match(/:\(?([A-Za-z0-9_-]+)[,)]/) || String(urn).match(/:([A-Za-z0-9_-]+)$/);
    return m ? m[1] : '';
  }

  function companyIdFromUrn(urn) {
    const m = String(urn || '').match(/:(\d+)\)?$/) || String(urn || '').match(/(\d+)\s*$/);
    return m ? m[1] : '';
  }

  /** Build a normalized row from one lead-search element (defensive). */
  function leadFromElement(el) {
    if (!el || typeof el !== 'object') return null;

    const first = el.firstName || '';
    const last = el.lastName || '';
    let full = (el.fullName || el.formattedName || `${first} ${last}`).trim();
    if (!full && !first && !last) return null;

    const leadId = leadIdFromElement(el);
    const linkedinUrl = leadId ? `https://www.linkedin.com/in/${leadId}` : '';

    const pos = (Array.isArray(el.currentPositions) && el.currentPositions[0]) ||
                el.currentPosition || {};
    const title = pos.title || el.title || el.headline || '';
    const companyName = pos.companyName || (pos.company && pos.company.name) || el.companyName || '';
    const companyUrn = pos.companyUrn || (pos.company && pos.company.entityUrn) || el.companyUrn || '';
    const industry = el.industry || (pos.company && pos.company.industry) || '';

    let location = el.geoRegion || el.location || el.geographyLocation || '';
    if (location && typeof location === 'object') location = location.displayName || location.name || '';

    return {
      first_name: first || full.split(/\s+/)[0] || '',
      last_name: last || full.split(/\s+/).slice(1).join(' ') || '',
      full_name: full,
      linkedin_profile_url: linkedinUrl,
      title,
      company_name: companyName,
      industry,
      profile_location: typeof location === 'string' ? location : '',
      __companyId: companyIdFromUrn(companyUrn)
    };
  }

  /** Pick the captured leads for a given 1-based page (SN packs 25/page). */
  function pickCapturedLeads(page) {
    if (!capturedPages.length) return null;
    const wantStart = page ? (page - 1) * 25 : null;
    if (wantStart != null) {
      for (let i = capturedPages.length - 1; i >= 0; i--) {
        if (capturedPages[i].start === wantStart) return capturedPages[i].leads;
      }
    }
    return capturedPages[capturedPages.length - 1].leads; // newest capture
  }

  /* ═══════════════════════════════════════════════════
   * SINGLE CARD PARSER
   * Extracts all visible fields from one <li> card.
   * ═══════════════════════════════════════════════════ */
  function parseCard(li, industryByCompany = null) {
    // ── 1. Name Link + Sales Navigator URL ──
    const nameLink = li.querySelector(SEL.leadLinkPrimary) || li.querySelector(SEL.leadLink);
    if (!nameLink) return null;

    let fullName = txt(nameLink)
      .replace(/\s+(is reachable|was last active.*|is online)$/i, '')
      .replace(/\s*[\u00B7]\s*\d+\w+$/i, '')  // Remove trailing "· 2nd" etc
      .trim();

    // Skip private profiles (no visible name)
    if (!fullName || /^linkedin\s+member$/i.test(fullName)) return null;

    const salesNavHref = attr(nameLink, 'href');
    const salesNavigatorUrl = salesNavHref ? absUrl(salesNavHref) : '';

    // ── 2. Lead ID → LinkedIn URL → Public ID ──
    const leadId = salesNavigatorUrl.match(/\/sales\/lead\/([^,/?#]+)/)?.[1] || '';
    const linkedinUrl = leadId ? `https://www.linkedin.com/in/${leadId}` : salesNavigatorUrl;
    const publicId = linkedinUrl.match(/\/in\/([^/?#]+)/)?.[1] || '';

    // ── 3. Profile Picture (via selector chain) ──
    const imgEl = q(li, SEL.image);
    const profilePictureUrl = imgEl ? (attr(imgEl, 'src') || '') : '';

    // ── 4. Connection Degree ──
    //    Strategy A: Dedicated degree element
    //    Strategy B: Parse from innerText near the name
    let connectionDegree = '';
    const degreeEl = q(li, SEL.degree);
    if (degreeEl) {
      connectionDegree = txt(degreeEl).replace(/[^1-3a-z]/gi, '').match(/(1st|2nd|3rd)/i)?.[0] || '';
    }
    if (!connectionDegree) {
      // Fallback: scan a narrow region near the name link
      const nameParent = nameLink.closest('.artdeco-entity-lockup__title') || nameLink.parentElement;
      const nearby = nameParent ? (nameParent.parentElement?.textContent || '') : '';
      connectionDegree = nearby.match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
    }
    if (!connectionDegree) {
      // Last resort: scan full card
      connectionDegree = (li.innerText || '').match(/\b(1st|2nd|3rd)\b/i)?.[1] || '';
    }

    // ── 5. Headline (raw text from dedicated element) ──
    let headlineEl = q(li, SEL.headline);
    let headline = txt(headlineEl);
    
    // Explicitly reject if we accidentally grabbed the tenure block
    if (headline && /(in role|in company)/i.test(headline)) {
      headline = '';
      headlineEl = null;
    }

    // ── 6. Company Name + URL ──
    const companyLink = li.querySelector(SEL.company);
    let companyName = txt(companyLink);
    let companyUrl = companyLink ? absUrl(attr(companyLink, 'href')) : '';

    // Fallback: parse company from headline pattern "Title at Company" or "Title · Company"
    if (!companyName && headline) {
      const separators = /\s+at\s+|[\u00B7\u2022\u2013\u2014|]\s*/;
      const parts = headline.split(separators);
      if (parts.length > 1) {
        const candidate = parts[parts.length - 1].trim();
        if (candidate.length > 1 && candidate.length < 60) {
          // Ensure it's not a location pattern (City, State)
          if (!/^[A-Za-z\u00C0-\u00FF\s.'-]+,\s*[A-Za-z\u00C0-\u00FF\s.'-]+$/.test(candidate)) {
            companyName = candidate;
          }
        }
      }
    }

    // ── 6.5 Industry (resolved via SN company API when Deep Fetch is on) ──
    // Lead cards never render an industry node — it's a company attribute —
    // so we look it up by company id from the pre-resolved map.
    let industry = '';
    const companyId = companyIdFromUrl(companyUrl);
    if (companyId && industryByCompany) {
      industry = industryByCompany.get(companyId) || '';
    }

    // ── 7. Location ──
    //    Strategy A: data-anonymize="location" attribute
    //    Strategy B: structural scan for City, State/Country pattern
    let profileLocation = '';
    const locEl = q(li, SEL.location);
    if (locEl) {
      profileLocation = txt(locEl);
    }
    if (!profileLocation) {
      // Walk spans/divs for geographic pattern
      for (const el of li.querySelectorAll('span, div')) {
        const t = directTxt(el);
        if (t && t.length > 3 && t.length < 80 &&
            /^[A-Za-z\u00C0-\u00FF\s.'-]+,\s*[A-Za-z\u00C0-\u00FF\s.'-]+/.test(t) &&
            !/\b(manager|director|engineer|analyst|specialist|consultant|founder|ceo|cto|vp|president|head|lead|senior|junior)\b/i.test(t)) {
          profileLocation = t;
          break;
        }
      }
    }

    // ── 8. Job Title (cleaned from headline) ──
    let title = '';
    if (headline) {
      title = headline
        .replace(/\b(1st|2nd|3rd|degree)\b.*/ig, '')
        .replace(/^(?:Current:\s*|·\s*)/i, '')
        .trim();
        
      // If there are newlines, the title is usually on the first line
      title = title.split(/\r?\n/)[0].trim();

      if (companyName) {
        // Create a regex to match the company name at the end, handling optional leading punctuation
        const safeComp = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const endPattern = new RegExp(`(?:\\s+at\\s+|[\\s,·|\\-–—]+)?${safeComp}\\s*$`, 'i');
        title = title.replace(endPattern, '').trim();
      }
      title = title.replace(/^[\s·|,\-–—]+|[\s·|,\-–—]+$/g, '').trim();
    }
    
    // Final sanity check: title shouldn't be the tenure block
    if (/(in role|in company)/i.test(title)) title = '';

    return {
      data: {
        ...splitName(fullName),
        linkedin_profile_url: linkedinUrl,
        title,
        company_name: companyName,
        industry,
        profile_location: profileLocation
      }
    };
  }


  /* ═══════════════════════════════════════════════════
   * SCROLL ENGINE
   * Uses aggressive but efficient scrolling with
   * MutationObserver-assisted card count tracking.
   * ═══════════════════════════════════════════════════ */
  function findScrollContainers() {
    const containers = [];
    let el = document.querySelector(`${SEL.card} ${SEL.leadLink}`)?.closest('li');
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 20) {
        containers.push(el);
      }
      el = el.parentElement;
    }
    return containers;
  }

  function scrollTo(containers, pos) {
    window.scrollTo(0, pos);
    for (const c of containers) c.scrollTop = pos;
  }

  function maxScroll(containers) {
    let m = document.documentElement.scrollHeight - window.innerHeight;
    for (const c of containers) m = Math.max(m, c.scrollHeight - c.clientHeight);
    return Math.max(m, 0);
  }

  async function scrollToLoadAllCards() {
    const containers = findScrollContainers();
    const STEP = 300; // small steps + longer pauses give sections time to load
    const countCards = () => document.querySelectorAll(`${SEL.card} ${SEL.leadLink}`).length;

    // Sales Navigator packs exactly 25 leads per page except the last one.
    // If "Next" is enabled this is a full page, so we know to wait for 25 and
    // never stop short at 20–23. On the last page Next is gone → target unknown,
    // so we fall back to "stop when a whole pass adds nothing new".
    const EXPECTED = findNextButton() ? 25 : 0;
    const DEADLINE = Date.now() + 40000; // hard cap so we can never hang

    scrollTo(containers, 0);
    await sleep(300);

    let prevPassCount = -1;
    while (Date.now() < DEADLINE) {
      // One full, gentle top→bottom pass. We deliberately DON'T early-exit when
      // the card count is reached — walking the whole list with a dwell at each
      // step is what gives every card's sections time to lazy-load.
      let pos = 0, maxS = maxScroll(containers);
      while (pos < maxS && Date.now() < DEADLINE) {
        pos += STEP;
        scrollTo(containers, Math.min(pos, maxS)); // never overshoot past the bottom
        await sleep(320);                          // dwell so sections can render
        maxS = maxScroll(containers);              // list may grow as rows load
      }
      await sleep(400); // settle at the bottom

      const count = countCards();
      if (EXPECTED && count >= EXPECTED) break;   // full page: every card present
      if (count === prevPassCount) break;         // last page: a pass added nothing
      prevPassCount = count;

      scrollTo(containers, 0); // re-walk from the top for any still-missing rows
      await sleep(300);
    }

    scrollTo(containers, 0);
    await sleep(200);
  }

  /* ═══════════════════════════════════════════════════
   * MAIN EXTRACTION PIPELINE
   * ═══════════════════════════════════════════════════ */
  /**
   * Build rows from Sales Navigator's captured lead-search payload, or return
   * null if no clean capture is available (→ caller falls back to DOM scrape).
   */
  async function buildRowsFromCapture(options) {
    // The page fetches results on navigation; give the capture a moment to land.
    let leads = pickCapturedLeads(options.page);
    for (let i = 0; !leads && i < 12; i++) { await sleep(250); leads = pickCapturedLeads(options.page); }
    if (!leads || !leads.length) return null;

    // Quality gate: trust the capture only if every lead parsed to a real name
    // and profile URL, so a shape mismatch can never export half-parsed junk.
    const clean = leads.filter(l => l.full_name && !/^linkedin member$/i.test(l.full_name));
    const withUrl = clean.filter(l => l.linkedin_profile_url);
    if (!clean.length || withUrl.length < clean.length) {
      dbgCap(`capture rejected by quality gate: ${withUrl.length}/${clean.length} rows have URLs`);
      return null;
    }

    // Industry: use any value already in the payload; otherwise resolve via the
    // company API (Deep Fetch), same as the DOM path.
    let industryByCompany = null;
    if (options.deepFetch) {
      const ids = clean.map(l => l.__companyId).filter(Boolean);
      industryByCompany = await resolveIndustries(ids);
    }

    return clean.map(l => {
      const industry = l.industry ||
        (industryByCompany && l.__companyId ? (industryByCompany.get(l.__companyId) || '') : '');
      const { __companyId, ...row } = l;
      return { ...row, industry };
    });
  }

  async function extractPageRows(options = {}) {
    // Phase 1: Wait for at least one lead card using MutationObserver
    await waitForElements(`${SEL.card} ${SEL.leadLink}`, 1, 8000);

    // Phase 2 (preferred): use SN's captured lead-search payload — it holds
    // every lead for the page and is immune to DOM lazy-loading.
    const capRows = await buildRowsFromCapture(options);
    if (capRows && capRows.length) {
      dbgCap(`page ${options.page || '?'} → ${capRows.length} rows from API capture`);
      return { rows: capRows };
    }

    // Phase 3 (fallback): DOM scrape with the target-aware scroll loader.
    dbgCap(`page ${options.page || '?'} → no clean capture, using DOM scrape`);
    await scrollToLoadAllCards();

    const lis = document.querySelectorAll(SEL.card);
    const cards = Array.from(lis).filter(li => li.querySelector(SEL.leadLink));

    // Deep Fetch → resolve each UNIQUE company's industry via the SN internal
    // API (cached), then hand parseCard a lookup map.
    let industryByCompany = null;
    if (options.deepFetch) {
      const companyIds = cards.map(li => {
        const link = li.querySelector(SEL.company);
        return link ? companyIdFromUrl(absUrl(attr(link, 'href'))) : '';
      });
      industryByCompany = await resolveIndustries(companyIds);
    }

    const rows = [];
    for (const li of cards) {
      const result = parseCard(li, industryByCompany);
      if (!result) continue;
      rows.push(result.data);
    }

    return { rows };
  }

  /* ─── Navigation ─── */
  function findNextButton() {
    return Array.from(document.querySelectorAll('button')).find(
      b => txt(b).toLowerCase() === 'next' && !b.disabled
    );
  }

  /* ─── Message Handler ─── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!['EXTRACT_PAGE', 'HAS_NEXT', 'CLICK_NEXT'].includes(msg.type)) return false;

    (async () => {
      try {
        switch (msg.type) {
          case 'EXTRACT_PAGE': {
            const { rows } = await extractPageRows(msg.options || {});
            sendResponse({ ok: true, rows, meta: { cards: rows.length, returned: rows.length } });
            break;
          }
          case 'HAS_NEXT':
            sendResponse({ ok: true, hasNext: !!findNextButton() });
            break;
          case 'CLICK_NEXT': {
            const btn = findNextButton();
            if (!btn) return sendResponse({ ok: true, clicked: false });
            btn.click();
            sendResponse({ ok: true, clicked: true });
            break;
          }
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();

    return true;
  });
})();
