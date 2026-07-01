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
    const STEP = 800;
    scrollTo(containers, 0);
    await sleep(200);

    let pos = 0, maxS = maxScroll(containers), stable = 0, lastCount = 0;

    while (pos < maxS) {
      pos += STEP;
      scrollTo(containers, pos);
      await sleep(180); // Fast scroll — LinkedIn lazy-loads within 100-200ms

      const count = document.querySelectorAll(`${SEL.card} ${SEL.leadLink}`).length;
      if (count === lastCount && count > 0) {
        stable++;
        // Use higher stability threshold (8 instead of 3) because 
        // Chrome massively throttles background tab setTimeout / renders.
        if (count >= 25 || stable >= 8) break; // SN max = 25 per page
      } else {
        stable = 0;
      }
      lastCount = count;
      maxS = maxScroll(containers);
    }

    // Slam to bottom to catch any stragglers
    scrollTo(containers, maxScroll(containers) + 5000);
    await sleep(250);
    scrollTo(containers, 0);
    await sleep(120);
  }

  /* ═══════════════════════════════════════════════════
   * MAIN EXTRACTION PIPELINE
   * ═══════════════════════════════════════════════════ */
  async function extractPageRows(options = {}) {
    // Phase 1: Wait for at least one lead card using MutationObserver
    await waitForElements(`${SEL.card} ${SEL.leadLink}`, 1, 8000);

    // Phase 2: Scroll to lazy-load all cards
    await scrollToLoadAllCards();

    // Phase 3: Extract all cards
    const lis = document.querySelectorAll(SEL.card);
    const cards = Array.from(lis).filter(li => li.querySelector(SEL.leadLink));

    // Phase 3.5: Deep Fetch → resolve each UNIQUE company's industry via the
    // Sales Navigator internal API (cached), then hand parseCard a lookup map.
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
