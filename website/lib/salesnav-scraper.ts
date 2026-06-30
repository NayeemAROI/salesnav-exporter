import { Browser, Page } from "puppeteer";
import { getBrowser, LinkedInCookie, ScrapeProgress, ProxyConfig, authenticateProxy } from "./linkedin-scraper";

/* ── Types ── */
export interface LeadResult {
  full_name: string; first_name: string; last_name: string;
  linkedin_profile_url: string; sales_navigator_url: string;
  title: string; headline: string; company_name: string; company_url: string;
  industry: string; profile_location: string; connection_degree: string;
  is_premium: boolean; is_open_link: boolean; profile_picture_url: string;
}

export interface CompanyResult {
  company_name: string; linkedin_company_url: string;
  industry: string; employees: string;
}

export interface SearchProgress {
  type: "progress" | "result" | "page_done" | "done" | "error";
  current: number; total: number; page: number; message: string;
  data?: LeadResult[] | CompanyResult[];
}

/* ── Page setup ── */
async function setupPage(browser: Browser, cookies: LinkedInCookie[], proxy?: ProxyConfig): Promise<Page> {
  const page = await browser.newPage();
  // Authenticate proxy if credentials provided
  await authenticateProxy(page, proxy);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  });
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9", "sec-ch-ua": '"Google Chrome";v="125"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"' });
  const mapped = cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain || ".linkedin.com", path: c.path || "/" }));
  await page.setCookie(...mapped);
  return page;
}

/* ═══════════════════════════════════════════
   LEAD EXTRACTION — exact copy of content_people.js
   ═══════════════════════════════════════════ */
async function extractLeadsFromPage(page: Page): Promise<LeadResult[]> {
  // Inject the EXACT extension scroll + parse logic into the page
  return page.evaluate(async () => {
    /* ── Utilities (from extension) ── */
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    function txt(el: Element | null) { return el ? (el.textContent || "").trim() : ""; }
    function attr(el: Element | null, a: string) { return el ? (el.getAttribute(a) || "").trim() : ""; }
    function directTxt(el: Element | null) {
      if (!el) return "";
      let s = "";
      for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
      return s.trim();
    }
    function absUrl(href: string) {
      if (!href) return "";
      try { return new URL(href, location.origin).toString(); } catch { return ""; }
    }
    function splitName(full: string) {
      const p = full.trim().split(/\s+/).filter(Boolean);
      return { first_name: p[0] || "", last_name: p.slice(1).join(" ") || "", full_name: full.trim() };
    }

    /* ── Selectors (EXACT from extension) ── */
    const SEL = {
      card: "main li",
      leadLink: 'a[href*="/sales/lead/"]',
      leadLinkPrimary: 'a[href*="/sales/lead/"]:not([aria-label^="Go to"])',
      image: ['img[src*="media.licdn.com"]', 'img[src*="dms/image"]', 'img[data-anonymize="avatar"]', '.presence-entity__image', 'img.lazy-image'],
      headline: ['[data-anonymize="headline"]', '.artdeco-entity-lockup__subtitle', '[data-anonymize="job-title"]', '[data-anonymize="title"]'],
      company: 'a[href*="/sales/company/"]',
      industry: '[data-anonymize="industry"]',
      location: ['[data-anonymize="location"]', '[data-anonymize="geography"]'],
      degree: ['.artdeco-entity-lockup__degree', '[data-anonymize="degree"]'],
      premium: ['[data-test-badge-premium]', '.premium-icon', '[aria-label*="premium" i]', 'li-icon[type="linkedin-premium-gold"]'],
      openLink: ['[data-test-badge-openlink]', '[aria-label*="open profile" i]', '[aria-label*="openlink" i]', 'li-icon[type="open-in-new"]'],
    };

    function q(root: Element, selectors: string | string[]): Element | null {
      const arr = Array.isArray(selectors) ? selectors : [selectors];
      for (const s of arr) { const el = root.querySelector(s); if (el) return el; }
      return null;
    }

    /* ── Scroll Engine (EXACT from extension) ── */
    function findScrollContainers(): Element[] {
      const containers: Element[] = [];
      let el: Element | null = document.querySelector(`${SEL.card} ${SEL.leadLink}`)?.closest("li") || null;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 20) {
          containers.push(el);
        }
        el = el.parentElement;
      }
      return containers;
    }
    function scrollTo(containers: Element[], pos: number) {
      window.scrollTo(0, pos);
      for (const c of containers) c.scrollTop = pos;
    }
    function maxScroll(containers: Element[]) {
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
        await sleep(180);
        const count = document.querySelectorAll(`${SEL.card} ${SEL.leadLink}`).length;
        if (count === lastCount && count > 0) { stable++; if (count >= 25 || stable >= 8) break; }
        else stable = 0;
        lastCount = count;
        maxS = maxScroll(containers);
      }
      scrollTo(containers, maxScroll(containers) + 5000);
      await sleep(250);
      scrollTo(containers, 0);
      await sleep(120);
    }

    /* ── Card Parser (EXACT from extension parseCard) ── */
    function parseCard(li: Element): LeadResult | null {
      const nameLink = li.querySelector(SEL.leadLinkPrimary) || li.querySelector(SEL.leadLink);
      if (!nameLink) return null;

      let fullName = txt(nameLink)
        .replace(/\s+(is reachable|was last active.*|is online)$/i, "")
        .replace(/\s*[\u00B7]\s*\d+\w+$/i, "").trim();
      if (!fullName || /^linkedin\s+member$/i.test(fullName)) return null;

      const salesNavHref = attr(nameLink, "href");
      const salesNavigatorUrl = salesNavHref ? absUrl(salesNavHref) : "";
      const leadId = salesNavigatorUrl.match(/\/sales\/lead\/([^,/?#]+)/)?.[1] || "";
      const linkedinUrl = leadId ? `https://www.linkedin.com/in/${leadId}` : salesNavigatorUrl;

      // Image
      const imgEl = q(li, SEL.image);
      const profilePictureUrl = imgEl ? (attr(imgEl, "src") || "") : "";

      // Degree
      let connectionDegree = "";
      const degreeEl = q(li, SEL.degree);
      if (degreeEl) connectionDegree = txt(degreeEl).replace(/[^1-3a-z]/gi, "").match(/(1st|2nd|3rd)/i)?.[0] || "";
      if (!connectionDegree) {
        const nameParent = nameLink.closest(".artdeco-entity-lockup__title") || nameLink.parentElement;
        const nearby = nameParent ? (nameParent.parentElement?.textContent || "") : "";
        connectionDegree = nearby.match(/\b(1st|2nd|3rd)\b/i)?.[1] || "";
      }
      if (!connectionDegree) connectionDegree = (li.textContent || "").match(/\b(1st|2nd|3rd)\b/i)?.[1] || "";

      // Headline
      let headlineEl = q(li, SEL.headline);
      let headline = txt(headlineEl);
      if (headline && /(in role|in company)/i.test(headline)) { headline = ""; headlineEl = null; }

      // Company
      const companyLink = li.querySelector(SEL.company);
      let companyName = txt(companyLink);
      let companyUrl = companyLink ? absUrl(attr(companyLink, "href")) : "";
      if (!companyName && headline) {
        const parts = headline.split(/\s+at\s+|[\u00B7\u2022\u2013\u2014|]\s*/);
        if (parts.length > 1) { const c = parts[parts.length - 1].trim(); if (c.length > 1 && c.length < 60) companyName = c; }
      }

      // Industry
      const industryEl = q(li, SEL.industry);
      const industry = industryEl ? txt(industryEl) : "";

      // Location
      let profileLocation = "";
      const locEl = q(li, SEL.location);
      if (locEl) profileLocation = txt(locEl);
      if (!profileLocation) {
        for (const el of li.querySelectorAll("span, div")) {
          const t = directTxt(el);
          if (t && t.length > 3 && t.length < 80 && /^[A-Za-z\u00C0-\u00FF\s.'-]+,\s*[A-Za-z\u00C0-\u00FF\s.'-]+/.test(t) &&
              !/\b(manager|director|engineer|analyst|specialist|consultant|founder|ceo|cto|vp|president|head|lead|senior|junior)\b/i.test(t)) {
            profileLocation = t; break;
          }
        }
      }

      // Title
      let title = headline.replace(/\b(1st|2nd|3rd|degree)\b.*/ig, "").replace(/^(?:Current:\s*|·\s*)/i, "").split(/\r?\n/)[0].trim();
      if (companyName) {
        const safe = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        title = title.replace(new RegExp(`(?:\\s+at\\s+|[\\s,·|\\-–—]+)?${safe}\\s*$`, "i"), "").trim();
      }
      title = title.replace(/^[\s·|,\-–—]+|[\s·|,\-–—]+$/g, "").trim();
      if (/(in role|in company)/i.test(title)) title = "";

      // Badges
      const isPremium = !!q(li, SEL.premium);
      const isOpenLink = !!q(li, SEL.openLink);

      return {
        ...splitName(fullName), linkedin_profile_url: linkedinUrl, sales_navigator_url: salesNavigatorUrl,
        title, headline, company_name: companyName, company_url: companyUrl,
        industry, profile_location: profileLocation, connection_degree: connectionDegree,
        is_premium: isPremium, is_open_link: isOpenLink, profile_picture_url: profilePictureUrl,
      };
    }

    /* ── Main Pipeline (EXACT from extension extractPageRows) ── */
    await scrollToLoadAllCards();
    const lis = document.querySelectorAll(SEL.card);
    const cards = Array.from(lis).filter(li => li.querySelector(SEL.leadLink));
    const rows: LeadResult[] = [];
    for (const li of cards) {
      const result = parseCard(li);
      if (result) rows.push(result);
    }
    return rows;
  });
}

/* ═══════════════════════════════════════════
   COMPANY EXTRACTION — exact copy of content_company.js
   ═══════════════════════════════════════════ */
async function extractCompaniesFromPage(page: Page): Promise<CompanyResult[]> {
  return page.evaluate(async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    function normalizeText(v: string) { return (v || "").replace(/\s+/g, " ").trim(); }
    function absUrl(href: string) { try { return new URL(href, location.origin).toString(); } catch { return ""; } }
    function cleanCompanyUrl(raw: string) {
      try { const m = new URL(raw).pathname.match(/\/sales\/company\/(\d+)/); return m ? `https://www.linkedin.com/company/${m[1]}` : raw; } catch { return raw; }
    }

    const SEL = {
      card: "main li",
      companyLink: 'a[href*="/sales/company/"]',
      companyName: ['[data-anonymize="company-name"]', '.artdeco-entity-lockup__title a', 'a[href*="/sales/company/"]'],
      industry: ['[data-anonymize="industry"]', 'span[data-anonymize="industry"]', '.artdeco-entity-lockup__caption span'],
      location: ['[data-anonymize="location"]', '[data-anonymize*="location"]'],
      employees: ['a[href*="view-all-employees"]', '.artdeco-entity-lockup__subtitle'],
    };

    function pickFirst(root: Element, sels: string[]) {
      for (const s of sels) { const el = root.querySelector(s); if (el) { const t = normalizeText(el.textContent || ""); if (t) return t; } }
      return "";
    }
    function getCardLines(li: Element) {
      const lines = (li.textContent || "").replace(/\r/g, "").split("\n").map(normalizeText).filter(Boolean);
      const seen = new Set<string>();
      return lines.filter(l => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    function isUiNoise(line: string) {
      return [/^(save|more|follow|message|connect|pending)$/i, /^(view\s+profile|view\s+on\s+linkedin)$/i,
        /^\d+[kmb]?\+?\s*(followers?|connections?)$/i, /\b(headcount|growth|in\s+common)\b/i].some(re => re.test(line));
    }
    function looksLikeIndustry(line: string) {
      if (!line || line.length < 2 || line.length > 90 || !/[A-Za-z]/.test(line)) return false;
      if (isUiNoise(line)) return false;
      if (/\b(employee|followers?|headcount|growth|in\s+common)\b/i.test(line)) return false;
      if (/\b(year|month|week|day|hour)\b/i.test(line)) return false;
      if (/^https?:\/\//i.test(line)) return false;
      return true;
    }

    /* ── Company Scroll Engine (EXACT from extension) ── */
    function findScrollContainer(): Element | null {
      const firstCard = document.querySelector(`${SEL.card} ${SEL.companyLink}`)?.closest("li") ||
        document.querySelector(`li ${SEL.companyLink}`)?.closest("li");
      let el: Element | null = firstCard || null;
      while (el && el !== document.body) {
        const style = getComputedStyle(el);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 50) return el;
        el = el.parentElement;
      }
      return null;
    }
    function countCards() {
      let c = document.querySelectorAll(`${SEL.card} ${SEL.companyLink}`).length;
      if (c > 0) return c;
      c = document.querySelectorAll(`li ${SEL.companyLink}`).length;
      return c > 0 ? c : document.querySelectorAll(SEL.companyLink).length;
    }

    async function scrollToLoadAllCards() {
      const container = findScrollContainer();
      const STEP = 400;
      const getH = () => container ? container.scrollHeight : document.body.scrollHeight;
      const setS = (v: number) => { if (container) container.scrollTop = v; else window.scrollTo(0, v); };
      let pos = 0; setS(0); await sleep(200);
      for (let i = 0; i < 80; i++) {
        pos += STEP; if (pos >= getH()) { setS(getH()); await sleep(300); break; }
        setS(pos); await sleep(300);
      }
      await sleep(600);
      let stable = 0, last = countCards();
      for (let i = 0; i < 10; i++) { setS(getH()); await sleep(500); const c = countCards(); if (c === last) stable++; else stable = 0; last = c; if (stable >= 2) break; }
      setS(0); await sleep(300);
    }

    /* ── Extract (EXACT from extension extractCompanyRows) ── */
    await scrollToLoadAllCards();
    let lis = Array.from(document.querySelectorAll(SEL.card)).filter(li => li.querySelector(SEL.companyLink));
    if (lis.length === 0) lis = Array.from(document.querySelectorAll("li")).filter(li => li.querySelector(SEL.companyLink));

    const rows: CompanyResult[] = [];
    const seen = new Set<string>();
    for (const card of lis) {
      const companyLink = card.querySelector(SEL.companyLink);
      if (!companyLink) continue;
      let name = pickFirst(card, SEL.companyName);
      if (!name) name = normalizeText(companyLink.textContent || "");
      const url = cleanCompanyUrl(absUrl(companyLink.getAttribute("href") || ""));
      if (!name || !url) continue;
      const key = url || name;
      if (seen.has(key)) continue;
      seen.add(key);
      const lines = getCardLines(card);
      // Industry
      let industry = pickFirst(card, SEL.industry);
      if (!industry) { const nameLower = name.toLowerCase(); industry = lines.find(l => looksLikeIndustry(l) && l.toLowerCase() !== nameLower) || ""; }
      // Employees
      let employees = "";
      for (const sel of SEL.employees) { const el = card.querySelector(sel); if (el) { const m = normalizeText(el.textContent || "").match(/([\d,kmb+]+)\s*\+?\s*employees?/i); if (m) { employees = m[0]; break; } } }
      if (!employees) { const m = (card.textContent || "").match(/([\d,kmb+]+)\s*\+?\s*employees?/i); if (m) employees = m[0]; }
      rows.push({ company_name: name, linkedin_company_url: url, industry, employees });
    }
    return rows;
  });
}

/* ═══════════════════════════════════════════
   MAIN SEARCH GENERATOR — pagination loop
   ═══════════════════════════════════════════ */
export async function* scrapeSalesNavSearch(
  searchUrl: string, cookies: LinkedInCookie[], maxResults: number = 100, mode: "leads" | "companies" = "leads", proxy?: ProxyConfig
): AsyncGenerator<SearchProgress> {
  const browser = await getBrowser(proxy);
  const page = await setupPage(browser, cookies, proxy);
  const allResults: (LeadResult | CompanyResult)[] = [];
  const seenKeys = new Set<string>();
  let pageNum = 0;

  try {
    yield { type: "progress", current: 0, total: maxResults, page: 0, message: "Warming up session..." };

    // Warm up on regular LinkedIn to establish session cookies
    try {
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (warmupErr: unknown) {
      const msg = warmupErr instanceof Error ? warmupErr.message : "";
      // If warmup itself gets 429, wait and retry
      if (msg.includes("429") || msg.includes("ERR_TOO_MANY_REDIRECTS")) {
        yield { type: "progress", current: 0, total: maxResults, page: 0, message: "⏳ Rate-limited on warmup, waiting 15s..." };
        await new Promise(r => setTimeout(r, 15000));
        await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 20000 });
      } else {
        await page.goto("https://www.linkedin.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
      }
    }
    await new Promise(r => setTimeout(r, 3000));

    // Check for 429 on the warmup page
    const warmupUrl = page.url();
    if (warmupUrl.includes("chrome-error")) {
      const warmupBody = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (warmupBody.includes("429")) {
        yield { type: "error", current: 0, total: maxResults, page: 0, 
          message: "❌ HTTP 429: LinkedIn blocked this IP. Make sure PROXY_HOST/PORT/USER/PASS env vars are set in Railway." };
        return;
      }
    }

    if (warmupUrl.includes("/login") || warmupUrl.includes("/authwall")) {
      yield { type: "error", current: 0, total: maxResults, page: 0, message: "❌ Cookies expired." }; return;
    }
    yield { type: "progress", current: 0, total: maxResults, page: 0, message: "✅ Session valid. Loading search..." };
    await new Promise(r => setTimeout(r, 1500));

    while (allResults.length < maxResults) {
      pageNum++;
      yield { type: "progress", current: allResults.length, total: maxResults, page: pageNum, message: `📄 Loading page ${pageNum}...` };

      if (pageNum === 1) {
        // Go directly to search URL with retry on failure
        let searchLoaded = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // Use domcontentloaded — networkidle2 often times out on Sales Nav's heavy SPA
            await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            // Check if we landed on chrome-error (429)
            if (page.url().includes("chrome-error")) {
              const errBody = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
              if (errBody.includes("429")) {
                const waitSecs = attempt * 15;
                yield { type: "progress", current: 0, total: maxResults, page: pageNum, 
                  message: `⏳ 429 rate limit — retry ${attempt}/3, waiting ${waitSecs}s...` };
                await new Promise(r => setTimeout(r, waitSecs * 1000));
                continue;
              }
            }
            // Check for login redirect
            const currentUrl = page.url();
            if (currentUrl.includes("/sales/login") || currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
              yield { type: "error", current: 0, total: maxResults, page: pageNum, 
                message: "❌ Sales Navigator session expired. Re-enter li_at and JSESSIONID cookies from your browser." };
              searchLoaded = false;
              break;
            }
            searchLoaded = true;
            break;
          } catch (navErr: unknown) {
            const errMsg = navErr instanceof Error ? navErr.message : "Unknown";
            if (attempt < 3) {
              yield { type: "progress", current: 0, total: maxResults, page: pageNum, 
                message: `⏳ Navigation failed (${errMsg.substring(0, 80)}) — retry ${attempt}/3...` };
              await new Promise(r => setTimeout(r, 10000));
            } else {
              yield { type: "progress", current: 0, total: maxResults, page: pageNum,
                message: `❌ Final attempt failed: ${errMsg.substring(0, 120)}` };
            }
          }
        }
        if (!searchLoaded) {
          yield { type: "error", current: 0, total: maxResults, page: pageNum, 
            message: "❌ Failed to load search after 3 retries. Check proxy and cookies." };
          break;
        }
      }

      // Wait extra time for Sales Nav SPA to fully render
      await new Promise(r => setTimeout(r, 5000));

      // Try multiple selectors — Sales Nav DOM structure varies
      const cardSelectors = mode === "leads"
        ? ['a[href*="/sales/lead/"]', 'a[href*="/sales/people/"]', 'main li a[data-control-name]', 'main li']
        : ['a[href*="/sales/company/"]', 'main li a[data-control-name]', 'main li'];

      let foundCards = false;
      for (const sel of cardSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 10000 });
          foundCards = true;
          break;
        } catch { continue; }
      }

      if (!foundCards) {
        // Last resort: check if there are ANY list items in main
        const hasAnyContent = await page.evaluate(() => {
          return document.querySelectorAll("main li").length > 0 || document.querySelectorAll("[class*='result']").length > 0;
        });
        if (!hasAnyContent) {
          const debugUrl = page.url();
          const debugTitle = await page.title();
          const debugSnippet = await page.evaluate(() => {
            const body = document.body?.innerText || "";
            return body.substring(0, 300).replace(/\s+/g, " ").trim();
          });
          yield { type: "progress", current: allResults.length, total: maxResults, page: pageNum,
            message: `⚠ No results. URL: ${debugUrl} | Title: ${debugTitle} | Content: ${debugSnippet.substring(0, 150)}...` };
          break;
        }
      }
      await new Promise(r => setTimeout(r, 2000));

      yield { type: "progress", current: allResults.length, total: maxResults, page: pageNum, message: `📜 Scrolling page ${pageNum}...` };

      let pageRows: (LeadResult | CompanyResult)[];
      if (mode === "leads") pageRows = await extractLeadsFromPage(page);
      else pageRows = await extractCompaniesFromPage(page);

      let added = 0;
      for (const row of pageRows) {
        if (allResults.length >= maxResults) break;
        const key = mode === "leads" ? (row as LeadResult).linkedin_profile_url || (row as LeadResult).full_name
          : (row as CompanyResult).linkedin_company_url || (row as CompanyResult).company_name;
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key); allResults.push(row); added++;
      }

      yield { type: "page_done", current: allResults.length, total: maxResults, page: pageNum,
        message: `✅ Page ${pageNum}: +${added} ${mode} (total: ${allResults.length})`, data: pageRows.slice(0, added) as LeadResult[] | CompanyResult[] };

      if (allResults.length >= maxResults) break;

      // Next button (EXACT from extension)
      const hasNext = await page.evaluate(() => {
        return !!Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().toLowerCase() === "next" && !b.disabled);
      });
      if (!hasNext) { yield { type: "progress", current: allResults.length, total: maxResults, page: pageNum, message: "📭 No more pages." }; break; }

      // Find the Next button natively and click it to ensure isTrusted=true
      const nextBtnHandles = await page.$$("button");
      let clicked = false;
      for (const btn of nextBtnHandles) {
        const text = await page.evaluate(el => (el.textContent || "").trim().toLowerCase(), btn);
        const isDisabled = await page.evaluate(el => el.disabled, btn);
        if (text === "next" && !isDisabled) {
          // Add a realistic human delay before clicking
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
          // Native puppeteer click sets event.isTrusted = true
          await btn.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        yield { type: "progress", current: allResults.length, total: maxResults, page: pageNum, message: "📭 Failed to click Next page." };
        break;
      }

      // Wait a realistic amount of time for the SPA to load the next page
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 4000));
    }

    yield { type: "done", current: allResults.length, total: maxResults, page: pageNum,
      message: `🎉 Done! ${allResults.length} ${mode} from ${pageNum} page(s).` };
  } catch (err: unknown) {
    yield { type: "error", current: allResults.length, total: maxResults, page: pageNum, message: `❌ ${err instanceof Error ? err.message : "Unknown"}` };
  } finally {
    await page.close();
    // Close browser to ensure next session gets fresh proxy config
    try { await browser.close(); } catch {}
  }
}
