import { Page } from "puppeteer";
import { getBrowser, LinkedInCookie, ProxyConfig, authenticateProxy } from "./linkedin-scraper";

/* ── Types ── */
export interface CompanyProfileResult {
  original_url: string;
  companyName: string;
  website: string;
  industry: string;
  companySize: string;
  headquarters: string;
  founded: string;
  companyType: string;
  description: string;
  specialties: string;
  linkedinUrl: string;
  followerCount: string;
  employeesOnLinkedIn: string;
  error?: string;
}

export interface CompanyScanProgress {
  type: "progress" | "result" | "done" | "error";
  current: number;
  total: number;
  message: string;
  data?: CompanyProfileResult;
}

/* ── Page setup ── */
async function setupPage(cookies: LinkedInCookie[], proxy?: ProxyConfig): Promise<Page> {
  const browser = await getBrowser(proxy);
  const page = await browser.newPage();
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
   EXTRACT COMPANY MAIN — ported from
   browser-extension/content_company_profile.js extractCompanyMain()
   ═══════════════════════════════════════════ */
async function extractCompanyMain(page: Page) {
  return page.evaluate(async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const NAME_SEL =
      'h1.org-top-card-summary__title, ' +
      'h1.t-24, ' +
      '.org-top-card-summary-info-list + h1, ' +
      'main h1, ' +
      '.top-card-layout__title, ' +
      '[data-anonymize="company-name"], ' +
      'h1';

    const ready = () => {
      const nameEl = document.querySelector(NAME_SEL);
      if (!nameEl || !(nameEl as HTMLElement).innerText.trim()) return false;
      return !!document.querySelector('dt') ||
        /\b(Website|Industry|Company size|Headquarters)\b/.test(document.body?.innerText || '');
    };
    for (let i = 0; i < 40 && !ready(); i++) await sleep(250);

    let companyName = '';
    let website = '';
    let industry = '';
    let companySize = '';
    let headquarters = '';
    let founded = '';
    let companyType = '';
    let description = '';
    let specialties = '';
    let linkedinUrl = '';
    let followerCount = '';
    let employeesOnLinkedIn = '';

    try {
      const nameEl = document.querySelector(NAME_SEL);
      if (nameEl) companyName = (nameEl as HTMLElement).innerText.trim();

      linkedinUrl = window.location.href.split('?')[0];
      if (!linkedinUrl.endsWith('/')) linkedinUrl += '/';

      const aboutSection = document.querySelector(
        '.org-about-us-organization-description__text, ' +
        '[data-test-id="about-us__description"], ' +
        'section.org-about-module p, ' +
        '.break-words .org-top-card-summary__tagline, ' +
        '.org-page-details-module__card-spacing p'
      );
      if (aboutSection) description = (aboutSection as HTMLElement).innerText.trim();

      const allText = document.body.innerText || '';

      const websiteLink = document.querySelector(
        'a[data-test-id="about-us__website"] span, ' +
        '.org-about-us-company-module__company-page-url a, ' +
        '.org-about-company-module__company-page-url a, ' +
        'a[href*="company-website"], ' +
        '.link-without-visited-state[data-test-id="about-us__website"]'
      );
      if (websiteLink) {
        website = (websiteLink as HTMLElement).innerText?.trim() || (websiteLink as HTMLAnchorElement).href || '';
      }

      const dtElements = document.querySelectorAll('dt');
      for (const dt of dtElements) {
        const label = ((dt as HTMLElement).innerText || '').trim().toLowerCase();
        const dd = dt.nextElementSibling;
        if (!dd) continue;
        const value = (dd as HTMLElement).innerText?.trim() || '';

        if (label.includes('website') && !website) {
          website = value;
        } else if (label.includes('industry') && !industry) {
          industry = value;
        } else if (label.includes('company size') || label.includes('organization size')) {
          if (!companySize) companySize = value;
        } else if (label.includes('headquarters') || label.includes('location')) {
          if (!headquarters) headquarters = value;
        } else if (label.includes('founded')) {
          if (!founded) founded = value;
        } else if (label.includes('type')) {
          if (!companyType) companyType = value;
        } else if (label.includes('specialties') || label.includes('specialities')) {
          if (!specialties) specialties = value;
        }
      }

      const detailItems = document.querySelectorAll(
        '.org-about-company-module__company-info-item, ' +
        '.org-page-details__definition-term, ' +
        '.org-top-card-summary-info-list__info-item'
      );
      for (const item of detailItems) {
        const text = (item as HTMLElement).innerText?.trim() || '';
        const lower = text.toLowerCase();
        if (lower.includes('website') && !website) {
          const link = item.querySelector('a');
          if (link) website = (link as HTMLAnchorElement).href || (link as HTMLElement).innerText?.trim() || '';
        }
      }

      if (!industry) {
        const indMatch = allText.match(/(?:Industry|industry)\s*\n\s*(.+)/);
        if (indMatch) industry = indMatch[1].trim();
      }
      if (!companySize) {
        const sizeMatch = allText.match(/(?:Company size|Organization size)\s*\n\s*(.+)/i);
        if (sizeMatch) companySize = sizeMatch[1].trim();
      }
      if (!headquarters) {
        const hqMatch = allText.match(/(?:Headquarters|Location)\s*\n\s*(.+)/i);
        if (hqMatch) headquarters = hqMatch[1].trim();
      }
      if (!founded) {
        const foundedMatch = allText.match(/(?:Founded)\s*\n\s*(\d{4})/i);
        if (foundedMatch) founded = foundedMatch[1].trim();
      }
      if (!companyType) {
        const typeMatch = allText.match(/(?:Type)\s*\n\s*(.+)/i);
        if (typeMatch) {
          const val = typeMatch[1].trim();
          if (/public|private|nonprofit|partnership|self-employed|government|educational/i.test(val)) {
            companyType = val;
          }
        }
      }
      if (!specialties) {
        const specMatch = allText.match(/(?:Specialties|Specialities)\s*\n\s*(.+)/i);
        if (specMatch) specialties = specMatch[1].trim();
      }

      const followerMatch = allText.match(/([\d,]+)\s*followers/i);
      if (followerMatch) followerCount = followerMatch[1].replace(/,/g, '');

      const empMatch = allText.match(/([\d,]+)\s*(?:employees?\s+on\s+LinkedIn|associated\s+members)/i);
      if (empMatch) employeesOnLinkedIn = empMatch[1].replace(/,/g, '');

      if (website) website = website.replace(/…$/, '').replace(/\.\.\.$/, '').trim();
    } catch (e) {
      console.warn("Company Profile Parse Error", e);
    }

    return {
      companyName, website, industry, companySize, headquarters, founded,
      companyType, description, specialties, linkedinUrl, followerCount, employeesOnLinkedIn,
    };
  });
}

/* ═══════════════════════════════════════════
   MAIN SCANNER
   ═══════════════════════════════════════════ */
export async function* scanCompanies(
  urls: string[], cookies: LinkedInCookie[],
  options: { proxy?: ProxyConfig } = {}
): AsyncGenerator<CompanyScanProgress> {
  const page = await setupPage(cookies, options.proxy);

  try {
    yield { type: "progress", current: 0, total: urls.length, message: "Warming up session..." };
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
    if (page.url().includes("/login") || page.url().includes("/authwall")) {
      yield { type: "error", current: 0, total: urls.length, message: "❌ Cookies expired." }; return;
    }
    yield { type: "progress", current: 0, total: urls.length, message: "✅ Session verified." };

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      if (!url) continue;

      yield { type: "progress", current: i + 1, total: urls.length, message: `Loading company ${i + 1} of ${urls.length}...` };

      let result: CompanyProfileResult;
      try {
        const companyMatch = url.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/company\/[^/?]+)/);
        const baseUrl = (companyMatch ? companyMatch[1] : url.split("?")[0]).replace(/\/$/, "") + "/about/";

        await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 }).catch(() =>
          page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        );
        try { await page.waitForSelector("h1, [role='heading']", { timeout: 15000 }); } catch {}
        await new Promise(r => setTimeout(r, 2500));

        if (page.url().includes("/login") || page.url().includes("/authwall")) {
          result = {
            original_url: url, companyName: "Unknown", website: "", industry: "", companySize: "",
            headquarters: "", founded: "", companyType: "", description: "", specialties: "",
            linkedinUrl: baseUrl, followerCount: "", employeesOnLinkedIn: "", error: "Auth wall",
          };
          yield { type: "result", current: i + 1, total: urls.length, message: `⚠ ${result.companyName} — auth wall`, data: result };
          continue;
        }

        yield { type: "progress", current: i + 1, total: urls.length, message: `Scanning company ${i + 1} of ${urls.length}...` };

        let data: Awaited<ReturnType<typeof extractCompanyMain>>;
        try {
          data = await extractCompanyMain(page);
        } catch {
          data = {
            companyName: "", website: "", industry: "", companySize: "", headquarters: "", founded: "",
            companyType: "", description: "", specialties: "", linkedinUrl: baseUrl, followerCount: "", employeesOnLinkedIn: "",
          };
        }

        if (!data.companyName) {
          const slug = baseUrl.match(/\/company\/([^/?#]+)/)?.[1];
          if (slug) data.companyName = decodeURIComponent(slug).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        }

        result = { original_url: url, ...data, companyName: data.companyName || "Unknown" };

        yield {
          type: "result", current: i + 1, total: urls.length,
          message: `✅ ${result.companyName}`, data: result,
        };
      } catch (err: unknown) {
        result = {
          original_url: url, companyName: "Unknown", website: "", industry: "", companySize: "",
          headquarters: "", founded: "", companyType: "", description: "", specialties: "",
          linkedinUrl: url, followerCount: "", employeesOnLinkedIn: "",
          error: err instanceof Error ? err.message : "Error",
        };
        yield { type: "result", current: i + 1, total: urls.length, message: `⚠ Skipped company ${i + 1}`, data: result };
      }

      if (i < urls.length - 1) {
        const delay = 3000 + Math.random() * 5000;
        yield { type: "progress", current: i + 1, total: urls.length, message: `Waiting ${Math.round(delay / 1000)}s...` };
        await new Promise(r => setTimeout(r, delay));
      }
    }

    yield { type: "done", current: urls.length, total: urls.length, message: `🎉 Done! Scanned ${urls.length} companies.` };
  } catch (err: unknown) {
    yield { type: "error", current: 0, total: urls.length, message: `❌ ${err instanceof Error ? err.message : "Unknown"}` };
  } finally {
    await page.close();
  }
}
