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
      /^(show\s+more|see\s+all|about|recent\s+activity)$/i,
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

  function looksLikeIndustry(line) {
    if (!line || line.length < 2 || line.length > 90) return false;
    if (!/[A-Za-z]/.test(line)) return false;
    if (looksLikeLocation(line)) return false;
    if (isUiNoise(line)) return false;
    if (/\b(employee|employees|follower|followers|headcount|growth|in\s+common)\b/i.test(line)) return false;
    if (/\b(year|month|week|day|hour|min)\b/i.test(line)) return false;
    if (/^https?:\/\//i.test(line)) return false;
    return true;
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
    let stable = 0;
    let lastCount = 0;

    for (let i = 0; i < 25; i++) {
      const count = countCompanyCards();
      if (count === lastCount) stable++;
      else stable = 0;
      lastCount = count;

      if (stable >= 3) break;

      if (container) container.scrollTop = container.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);

      await sleep(700);
    }

    if (container) container.scrollTop = 0;
    else window.scrollTo(0, 0);

    await sleep(400);
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

      const linkedin_profile_url = absUrl(companyLink.getAttribute('href'));
      if (!company_name || !linkedin_profile_url) continue;

      const uniqueKey = linkedin_profile_url || company_name;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const lines = getCardLines(card);
      const company_location = extractCompanyLocation(card, lines);
      const industry = extractIndustry(card, company_name, company_location, lines);
      const employees = extractEmployees(card, lines);

      rows.push({ company_name, linkedin_profile_url, industry, company_location, employees });
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