(function () {
  /* ═══════════════════════════════════════════════════
   * UTILITIES
   * ═══════════════════════════════════════════════════ */
  function absUrl(href) {
    try {
      return new URL(href, window.location.origin).toString();
    } catch {
      return '';
    }
  }

  function cleanCompanyUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const match = u.pathname.match(/\/sales\/company\/(\d+)/);
      if (match) {
        return `https://www.linkedin.com/company/${match[1]}`;
      }
      return rawUrl;
    } catch {
      return rawUrl;
    }
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ═══════════════════════════════════════════════════
   * SELECTORS — prioritized chains, broadest last
   * ═══════════════════════════════════════════════════ */
  const SEL = {
    card: 'main li',
    companyLink: 'a[href*="/sales/company/"]',
    companyName: [
      '[data-anonymize="company-name"]',
      '.artdeco-entity-lockup__title a',
      'a[href*="/sales/company/"]'
    ],
    industry: [
      '[data-anonymize="industry"]',
      'span[data-anonymize="industry"]',
      '.artdeco-entity-lockup__caption span'
    ],
    location: [
      '[data-anonymize="location"]',
      '[data-anonymize*="location"]'
    ],
    employees: [
      'a[href*="view-all-employees"]',
      '.artdeco-entity-lockup__subtitle'
    ]
  };

  /* ═══════════════════════════════════════════════════
   * WAIT FOR ELEMENTS (critical for SPA navigation)
   * ═══════════════════════════════════════════════════ */
  function waitForElements(selector, timeout = 12000) {
    return new Promise((resolve) => {
      const existing = document.querySelectorAll(selector);
      if (existing.length > 0) return resolve(existing);

      const observer = new MutationObserver(() => {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(els);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelectorAll(selector));
      }, timeout);

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ═══════════════════════════════════════════════════
   * CARD LINE EXTRACTION
   * ═══════════════════════════════════════════════════ */
  function getCardLines(li) {
    const lines = (li.innerText || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(normalizeText)
      .filter(Boolean);

    const seen = new Set();
    return lines.filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isUiNoise(line) {
    return [
      /^(save|more|follow|message|connect|pending)$/i,
      /^(view\s+profile|view\s+on\s+linkedin|open\s+profile)$/i,
      /^(show\s+more|see\s+all|about|recent\s+activity)\s*:?$/i,
      /^(inmail|send\s+inmail)$/i,
      /^\d+[kmb]?\+?\s*(followers?|connections?)$/i,
      /^\d+\s+(day|days|week|weeks|month|months|year|years)\b/i,
      /\b(headcount|growth|in\s+common|shared\s+connections?)\b/i,
      /^(linkedin\s+member|linkedin\s+premium)$/i
    ].some((re) => re.test(line));
  }

  /* ═══════════════════════════════════════════════════
   * FIELD EXTRACTION HELPERS
   * ═══════════════════════════════════════════════════ */
  function pickFirstText(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) {
        const text = normalizeText(el.textContent || '');
        if (text) return text;
      }
    }
    return '';
  }

  function looksLikeLocation(line) {
    if (!line || line.length < 3 || line.length > 90) return false;
    if (isUiNoise(line)) return false;
    if (/\b(manager|director|engineer|analyst|consultant|founder|ceo|cto|vp|president|head|lead|specialist)\b/i.test(line)) {
      return false;
    }
    if (/^remote$/i.test(line) || /^worldwide$/i.test(line)) return true;
    if (/^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?$/.test(line)) return true;
    if (/\b(United States|United Kingdom|Canada|India|Australia|Germany|France|Singapore|Netherlands|UAE|Japan|Brazil|Indonesia|Malaysia)\b/i.test(line)) {
      return true;
    }
    return false;
  }

  const SNX_CO_DEBUG = true; // logs why a company's industry came out blank
  const dbgCo = (...a) => { if (SNX_CO_DEBUG) console.log('%c[SNX co]', 'color:#f97316', ...a); };

  // Backstop allowlist for real LinkedIn industries that contain no obvious
  // industry keyword (so the keyword test below wouldn't catch them).
  const INDUSTRY_SET = new Set([
    'internet','banking','insurance','retail','wholesale','construction','hospitality',
    'utilities','semiconductors','nanotechnology','tobacco','philanthropy','think tanks',
    'alternative dispute resolution','executive office','legislative office','public policy',
    'international affairs','political organizations','luxury goods and jewelry','import and export',
    'packaging and containers','packaging & containers','industrial automation','operations research',
    'venture capital and private equity','capital markets','online media','photography'
  ]);

  // Characteristic words a real LinkedIn industry almost always contains.
  const INDUSTRY_TAIL = /\b(manufactur\w*|services?|software|technolog\w*|retail|wholesale|construction|bank\w*|financ\w*|insurance|healthcare|health\s*care|hospitals?|medical|medicine|dental|veterinary|pharmaceutical\w*|biotechnolog\w*|biotech|education|e-?learning|training|coaching|media|broadcast\w*|telecommunications?|telecom|transportation|logistics|warehousing|supply\s*chain|real\s*estate|consult\w*|automotive|automobile|motor\s*vehicle|aerospace|aviation|airlines?|maritime|shipbuilding|railroad|trucking|freight|semiconductor\w*|electronics?|electrical|utilit\w*|energy|oil|gas|renewable\w*|mining|metals?|steel|chemicals?|plastics?|textiles?|apparel|fashion|luxury|jewelry|furniture|packaging|containers?|paper|building\s*materials|glass|ceramics|agricultur\w*|farming|ranching|fishing|dairy|food|beverages?|tobacco|wine|spirits|cosmetics|goods|machinery|automation|industrial|robotics|nanotechnology|defen[sc]e|security|government|administration|nonprofit|non-profit|accounting|legal|law\s*practice|research|design|architecture|engineering|internet|computers?|networking|hospitality|hotels?|restaurants?|leisure|travel|tourism|entertainment|gaming|games?|casinos|gambling|sports|recreation|publishing|newspapers?|books?|music|movies|animation|photography|printing|advertising|marketing|public\s*relations|staffing|recruiting|outsourcing|offshoring|human\s*resources|wellness|fitness|events|venture\s*capital|investment|capital\s*markets|import|export|facilities)\b/i;

  function looksLikeIndustry(line) {
    if (!line) return false;
    const clean = line.replace(/[\s:：]+$/, '').trim();
    if (clean.length < 2 || clean.length > 80) return false;
    if (!/[A-Za-z]/.test(clean)) return false;
    const lower = clean.toLowerCase();

    // ── Hard noise rejects: badges, buyer-intent, hiring, CTAs, taglines ──
    if (/\b(buyer\s+intent|hiring|actively\s+recruiting|recently\s+hired|in\s+the\s+news|mutual|shared\s+connection|save|message|connect|follows?|following|linkedin\s+(member|premium))\b/i.test(lower)) return false;
    if (/^(our\s+(mission|vision|story|goal|purpose|values)|we\s+(are|'re|provide|help|build|deliver|offer|specialize|enable)|leading|the\s+leader|leader\s+in|welcome\s+to|for\s+more)/i.test(lower)) return false;
    // Sentence/blurb: mid-line sentence punctuation followed by more words.
    if (/[:;.!?]\s*\S/.test(clean) && clean.split(/\s+/).length > 4) return false;
    if (looksLikeLocation(clean)) return false;
    if (isUiNoise(clean)) return false;
    if (/^(about|overview|description|summary|specialt(?:y|ies|ities)|website|headquarters|hq|founded|company\s+size|phone|similar\s+companies|see\s+jobs|view\s+jobs)\b/i.test(lower)) return false;
    if (/\b(employee|employees|follower|followers|headcount|growth|in\s+common)\b/i.test(lower)) return false;
    if (/\b(year|month|week|day|hour|min)\b/i.test(lower)) return false;
    if (/^https?:\/\//i.test(clean)) return false;

    // ── Positive validation: must be a known industry or clearly industry-shaped ──
    const norm = lower.replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    if (INDUSTRY_SET.has(norm)) return true;
    if (INDUSTRY_TAIL.test(lower) && clean.split(/\s+/).length <= 8) return true;
    return false;
  }

  function extractEmployees(li, lines) {
    // Try data-attribute selectors first
    for (const sel of SEL.employees) {
      const el = li.querySelector(sel);
      if (el) {
        const text = normalizeText(el.textContent || '');
        const match = text.match(/([\d,kmb+]+)\s*\+?\s*employees?/i);
        if (match) return match[0];
      }
    }
    // Fallback to line scanning
    for (const line of lines) {
      if (/\b\d+[kmb,]*\+?\s*employees?\b/i.test(line)) {
        let match = line.match(/([\d,kmb+]+)\s*\+?\s*employees?/i);
        if (match) return match[0];
        return line;
      }
    }
    return '';
  }

  function extractCompanyLocation(li, lines) {
    const fromAttrs = pickFirstText(li, SEL.location);
    if (fromAttrs && looksLikeLocation(fromAttrs)) return fromAttrs;
    return lines.find((line) => looksLikeLocation(line)) || '';
  }

  function extractIndustry(li, companyName, companyLocation, lines) {
    const companyLower = (companyName || '').toLowerCase();
    const locationLower = (companyLocation || '').toLowerCase();

    const fromAttrs = pickFirstText(li, SEL.industry);
    if (fromAttrs && looksLikeIndustry(fromAttrs)) return fromAttrs;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (!looksLikeIndustry(line)) continue;
      if (lower === companyLower || lower === locationLower) continue;
      if (companyLower && lower.includes(companyLower)) continue;
      return line;
    }

    // Blank: show what the card actually contained so we can tell whether the
    // industry was absent (timing/markup) or wrongly rejected by the filter.
    dbgCo('no industry for', companyName, '| attr=', JSON.stringify(fromAttrs || ''), '| lines=', lines);
    return '';
  }

  /* ═══════════════════════════════════════════════════
   * NAVIGATION
   * ═══════════════════════════════════════════════════ */
  function findNextButton() {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'next' && !b.disabled);
  }

  /* ═══════════════════════════════════════════════════
   * SCROLL TO LOAD ALL CARDS
   * ═══════════════════════════════════════════════════ */
  function findScrollableResultsContainer() {
    // Try multiple selectors to find the first company card
    const firstCard =
      document.querySelector(`${SEL.card} ${SEL.companyLink}`)?.closest('li') ||
      document.querySelector(`li ${SEL.companyLink}`)?.closest('li') ||
      document.querySelector(SEL.companyLink)?.closest('li');

    let el = firstCard;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const scrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
      if (scrollable) return el;
      el = el.parentElement;
    }
    return null;
  }

  function countCompanyCards() {
    // Try multiple selector strategies
    const count1 = document.querySelectorAll(`${SEL.card} ${SEL.companyLink}`).length;
    if (count1 > 0) return count1;
    const count2 = document.querySelectorAll(`li ${SEL.companyLink}`).length;
    if (count2 > 0) return count2;
    return document.querySelectorAll(SEL.companyLink).length;
  }

  async function scrollToLoadAllCards() {
    const container = findScrollableResultsContainer();
    const STEP = 300; // small steps + dwell so each card's sections load
    const getScrollHeight = () => container ? container.scrollHeight : document.documentElement.scrollHeight;
    const getClient = () => container ? container.clientHeight : window.innerHeight;
    const setScrollTop = (v) => { if (container) container.scrollTop = v; else window.scrollTo(0, v); };
    const maxScroll = () => Math.max(getScrollHeight() - getClient(), 0);

    // Sales Navigator packs 25 results per page except the last. If "Next" is
    // enabled this is a full page → wait for 25 and never stop short. On the
    // last page Next is gone → settle when a full pass adds nothing new.
    const EXPECTED = findNextButton() ? 25 : 0;
    const DEADLINE = Date.now() + 40000; // hard cap so we can never hang

    setScrollTop(0);
    await sleep(300);

    let prevPassCount = -1;
    while (Date.now() < DEADLINE) {
      // One full, gentle top→bottom pass — dwell at every step (no early exit)
      // so each card's sections have time to lazy-load.
      let pos = 0, maxS = maxScroll();
      while (pos < maxS && Date.now() < DEADLINE) {
        pos += STEP;
        setScrollTop(Math.min(pos, maxS)); // never overshoot past the bottom
        await sleep(320);
        maxS = maxScroll();                 // list may grow as rows load
      }
      await sleep(400); // settle at the bottom

      const count = countCompanyCards();
      if (EXPECTED && count >= EXPECTED) break;   // full page: every card present
      if (count === prevPassCount) break;         // last page: a pass added nothing
      prevPassCount = count;

      setScrollTop(0); // re-walk from the top for any still-missing rows
      await sleep(300);
    }

    setScrollTop(0);
    await sleep(200);
  }

  /* ═══════════════════════════════════════════════════
   * MAIN EXTRACTION PIPELINE
   * ═══════════════════════════════════════════════════ */
  function findCompanyCards() {
    // Strategy 1: main li with company link
    let lis = Array.from(document.querySelectorAll(SEL.card));
    let cards = lis.filter(li => li.querySelector(SEL.companyLink));
    if (cards.length > 0) return cards;

    // Strategy 2: any li with company link
    lis = Array.from(document.querySelectorAll('li'));
    cards = lis.filter(li => li.querySelector(SEL.companyLink));
    if (cards.length > 0) return cards;

    // Strategy 3: find company links and walk up to closest li or card-like container
    const allLinks = Array.from(document.querySelectorAll(SEL.companyLink));
    const containers = [];
    for (const link of allLinks) {
      const container = link.closest('li') || link.closest('[data-x-search-result]') || link.closest('.artdeco-entity-lockup')?.closest('li, div[class*="list"]');
      if (container && !containers.includes(container)) {
        containers.push(container);
      }
    }
    return containers;
  }

  async function extractCompanyRows() {
    // Wait for company links to appear in DOM
    await waitForElements(SEL.companyLink, 12000);
    await scrollToLoadAllCards();

    const cards = findCompanyCards();
    const rows = [];
    const seen = new Set();

    for (const card of cards) {
      const companyLink = card.querySelector(SEL.companyLink);
      if (!companyLink) continue;

      // Extract company name - try data-anonymize first, then link text
      let company_name = '';
      const nameEl = card.querySelector('[data-anonymize="company-name"]');
      if (nameEl) {
        company_name = normalizeText(nameEl.textContent || '');
      }
      if (!company_name) {
        company_name = normalizeText(companyLink.textContent || '');
      }

      const linkedin_profile_url = cleanCompanyUrl(absUrl(companyLink.getAttribute('href')));
      if (!company_name || !linkedin_profile_url) continue;

      const uniqueKey = linkedin_profile_url || company_name;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const lines = getCardLines(card);
      const industry = extractIndustry(card, company_name, '', lines);
      const employees = extractEmployees(card, lines);

      rows.push({ company_name, linkedin_profile_url, industry, employees });
    }

    return rows;
  }

  /* ═══════════════════════════════════════════════════
   * MESSAGE HANDLER
   * ═══════════════════════════════════════════════════ */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'EXTRACT_PAGE' && msg.type !== 'HAS_NEXT' && msg.type !== 'CLICK_NEXT') return false;

    (async () => {
      try {
        if (msg.type === 'EXTRACT_PAGE') {
          const rows = await extractCompanyRows();
          const cards = countCompanyCards();
          sendResponse({ ok: true, rows, meta: { cards } });
          return;
        }

        if (msg.type === 'HAS_NEXT') {
          sendResponse({ ok: true, hasNext: !!findNextButton() });
          return;
        }

        if (msg.type === 'CLICK_NEXT') {
          const btn = findNextButton();
          if (!btn) {
            sendResponse({ ok: true, clicked: false });
            return;
          }
          btn.click();
          sendResponse({ ok: true, clicked: true });
          return;
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();

    return true;
  });
})();