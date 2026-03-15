(function () {
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

  function looksLikeLocation(line) {
    if (!line || line.length < 3 || line.length > 90) return false;
    if (isUiNoise(line)) return false;
    if (/\b(manager|director|engineer|analyst|consultant|founder|ceo|cto|vp|president|head|lead|specialist)\b/i.test(line)) {
      return false;
    }

    if (/^remote$/i.test(line) || /^worldwide$/i.test(line)) return true;
    if (/^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?$/.test(line)) return true;
    if (/\b(United States|United Kingdom|Canada|India|Australia|Germany|France|Singapore|Netherlands|UAE|Japan|Brazil)\b/i.test(line)) {
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

  function extractEmployees(lines) {
    for (const line of lines) {
      if (/\b\d+[kmb,]*\+?\s*employees?\b/i.test(line)) {
        // e.g. "37 employees on LinkedIn" -> "37 employees" or just the raw string
        // The regex matches e.g. "37 employees", we can just return the raw line.
        let match = line.match(/([\d,kmb+]+)\s*employees?/i);
        if (match) return match[0];
        return line;
      }
    }
    return '';
  }

  function pickFromSelectors(root, selectors, predicate) {
    for (const selector of selectors) {
      const nodes = Array.from(root.querySelectorAll(selector));
      for (const node of nodes) {
        const text = normalizeText(node.textContent || '');
        if (text && predicate(text)) return text;
      }
    }
    return '';
  }

  function extractCompanyLocation(li, lines) {
    const fromAttrs = pickFromSelectors(
      li,
      ['[data-anonymize="location"]', '[data-anonymize*="location"]'],
      looksLikeLocation
    );
    if (fromAttrs) return fromAttrs;

    return lines.find((line) => looksLikeLocation(line)) || '';
  }

  function extractIndustry(li, companyName, companyLocation, lines) {
    const companyLower = (companyName || '').toLowerCase();
    const locationLower = (companyLocation || '').toLowerCase();

    const fromAttrs = pickFromSelectors(
      li,
      ['[data-anonymize="industry"]', '[data-anonymize*="industry"]'],
      looksLikeIndustry
    );
    if (fromAttrs) return fromAttrs;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (!looksLikeIndustry(line)) continue;
      if (lower === companyLower || lower === locationLower) continue;
      if (companyLower && lower.includes(companyLower)) continue;
      return line;
    }

    return '';
  }

  function findNextButton() {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'next' && !b.disabled);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findScrollableResultsContainer() {
    const firstCard = document.querySelector('main li a[href*="/sales/company/"]')?.closest('li');
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

  async function scrollToLoadAllCards() {
    const container = findScrollableResultsContainer();
    let stable = 0;
    let lastCount = 0;

    for (let i = 0; i < 25; i++) {
      const count = document.querySelectorAll('main li a[href*="/sales/company/"]').length;
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

  async function extractCompanyRows() {
    await scrollToLoadAllCards();

    const lis = Array.from(document.querySelectorAll('main li'));
    const rows = [];
    const seen = new Set();

    for (const li of lis) {
      const companyLink = li.querySelector('a[href*="/sales/company/"]');
      if (!companyLink) continue;

      const company_name = normalizeText(companyLink.textContent || '');
      const linkedin_profile_url = absUrl(companyLink.getAttribute('href'));
      if (!company_name || !linkedin_profile_url) continue;

      const uniqueKey = linkedin_profile_url || company_name;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const lines = getCardLines(li);
      const company_location = extractCompanyLocation(li, lines);
      const industry = extractIndustry(li, company_name, company_location, lines);
      const employees = extractEmployees(lines);

      rows.push({ company_name, linkedin_profile_url, industry, company_location, employees });
    }

    return rows;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'EXTRACT_PAGE' && msg.type !== 'HAS_NEXT' && msg.type !== 'CLICK_NEXT') return false;

    (async () => {
      try {
        if (msg.type === 'EXTRACT_PAGE') {
          const rows = await extractCompanyRows();
          const cards = document.querySelectorAll('main li a[href*="/sales/company/"]').length;
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