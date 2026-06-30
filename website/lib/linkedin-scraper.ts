import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

export interface LinkedInCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface ProfileResult {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  connections: string;
  isPremium: boolean;
  about: string;
  currentCompany: string;
  currentTitle: string;
  error?: string;
}

export interface ScrapeProgress {
  type: "progress" | "result" | "done" | "error";
  current: number;
  total: number;
  message: string;
  data?: ProfileResult;
}

export interface ProxyConfig {
  host: string;
  port: string;
  username?: string;
  password?: string;
  countryCode?: string;
}

let activeBrowser: Browser | null = null;

function getDefaultProxy(): ProxyConfig | undefined {
  if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
    return {
      host: process.env.PROXY_HOST,
      port: process.env.PROXY_PORT,
      username: process.env.PROXY_USER || undefined,
      password: process.env.PROXY_PASS || undefined,
    };
  }
  return undefined;
}

export async function getBrowser(proxy?: ProxyConfig): Promise<Browser> {
  // Always use proxy — fall back to env vars
  const resolvedProxy = proxy || getDefaultProxy();

  // Close any existing browser to ensure fresh proxy config
  if (activeBrowser && activeBrowser.connected) {
    try { await activeBrowser.close(); } catch {}
    activeBrowser = null;
  }

  const isProduction = process.env.NODE_ENV === "production";

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-first-run",
    "--no-zygote",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-translate",
    "--disable-sync",
    "--disable-component-update",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    "--metrics-recording-only",
    "--mute-audio",
    "--js-flags=--max-old-space-size=256",
    ...(isProduction
      ? ["--single-process", "--window-size=1280,720"]
      : ["--window-size=1366,768", "--start-maximized"]),
  ];

  // Add proxy if configured
  if (resolvedProxy?.host && resolvedProxy?.port) {
    args.push(`--proxy-server=${resolvedProxy.host}:${resolvedProxy.port}`);
    console.log(`[Proxy] Using: ${resolvedProxy.host}:${resolvedProxy.port}`);
  } else {
    console.log("[Proxy] WARNING: No proxy configured — using direct connection (may get 429)");
  }

  activeBrowser = await puppeteer.launch({
    headless: isProduction ? true : false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args,
    defaultViewport: isProduction ? { width: 1280, height: 720 } : null,
    ignoreDefaultArgs: ["--enable-automation"],
  });
  return activeBrowser;
}

// Helper: authenticate proxy on a page — MUST be called BEFORE any navigation
export async function authenticateProxy(page: Page, proxy?: ProxyConfig) {
  const resolvedProxy = proxy || getDefaultProxy();
  if (resolvedProxy?.username && resolvedProxy?.password) {
    let finalUsername = resolvedProxy.username;
    
    // Dynamically inject country code and sticky session if countryCode is provided
    if (resolvedProxy.countryCode) {
      if (finalUsername.includes("spifym7x1r") || finalUsername.includes("sppv9iblpt")) {
        // Smartproxy/Decodo format
        const match = finalUsername.match(/(?:user-)?([a-z0-9]+)/);
        const baseUser = match ? match[1] : finalUsername;
        finalUsername = `user-${baseUser}-sessionduration-60-country-${resolvedProxy.countryCode.toLowerCase()}`;
      } else if (finalUsername.includes("brd-customer-")) {
        // BrightData format (extract base up to proxy1, ignore existing -country or -session)
        const match = finalUsername.match(/^(brd-customer-[^-]+-zone-[^-]+)/);
        const baseUser = match ? match[1] : finalUsername;
        const sessionId = Math.random().toString(36).substring(2, 10);
        finalUsername = `${baseUser}-country-${resolvedProxy.countryCode.toLowerCase()}-session-${sessionId}`;
      } else if (resolvedProxy.host.includes("apify.com") || finalUsername === "auto" || finalUsername.startsWith("groups-")) {
        // Apify format
        const sessionId = Math.random().toString(36).substring(2, 10);
        finalUsername = `groups-RESIDENTIAL,country-${resolvedProxy.countryCode.toUpperCase()},session-${sessionId}`;
      }
    }

    await page.authenticate({ username: finalUsername, password: resolvedProxy.password });
    console.log(`[Proxy] Authenticated as: ${finalUsername}`);
  }
}

export async function closeBrowser() {
  if (activeBrowser) {
    try { await activeBrowser.close(); } catch {}
    activeBrowser = null;
  }
}

async function setupPage(browser: Browser, cookies: LinkedInCookie[]): Promise<Page> {
  const page = await browser.newPage();

  // Extra headers to look more human
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "sec-ch-ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  });

  // Set cookies
  const cookiesForPuppeteer = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || ".linkedin.com",
    path: c.path || "/",
  }));
  await page.setCookie(...cookiesForPuppeteer);

  return page;
}

export async function scrapeProfile(
  page: Page,
  url: string
): Promise<ProfileResult> {
  const emptyResult: ProfileResult = {
    name: "",
    headline: "",
    location: "",
    profileUrl: url,
    connections: "",
    isPremium: false,
    about: "",
    currentCompany: "",
    currentTitle: "",
  };

  try {
    // Use domcontentloaded — networkidle2 often times out on LinkedIn's heavy pages
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Wait for key profile element to appear (up to 15s)
    try {
      await page.waitForSelector("h1", { timeout: 15000 });
    } catch {
      // h1 not found — page might still be loading or is blocked
    }

    // Extra wait for dynamic content
    await new Promise((r) => setTimeout(r, 3000));

    // Check for auth wall / challenge
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/authwall") ||
      currentUrl.includes("/checkpoint")
    ) {
      return {
        ...emptyResult,
        error: "Session expired or challenge detected — update your cookies",
      };
    }

    const data = await page.evaluate(() => {
      // ═══ STRATEGY 1: JSON-LD structured data (most reliable) ═══
      let jsonLd: any = null;
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          const parsed = JSON.parse(s.textContent || "");
          if (parsed["@type"] === "Person" || parsed["@type"]?.includes?.("Person")) {
            jsonLd = parsed;
            break;
          }
        }
      } catch {}

      // ═══ STRATEGY 2: Parse document.title → "Name - Title | LinkedIn" ═══
      let titleName = "";
      let titleHeadline = "";
      const pageTitle = document.title || "";
      const titleMatch = pageTitle.match(/^(.+?)\s*[-–—]\s*(.+?)\s*\|\s*LinkedIn/);
      if (titleMatch) {
        titleName = titleMatch[1].trim();
        titleHeadline = titleMatch[2].trim();
      }

      // ═══ STRATEGY 3: Meta tags ═══
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";

      // Parse meta description: "Name - Title - Company. Location. xxx connections..."
      let metaName = "";
      let metaHeadline = "";
      let metaLocation = "";
      let metaConnections = "";
      if (metaDesc) {
        // Pattern: "Name – Title · Location · Experience: ... · xxx connections..."
        const parts = metaDesc.split(/\s*[·|]\s*/);
        if (parts.length >= 2) {
          // First part often has "Name – Title"
          const firstPart = parts[0];
          const dashSplit = firstPart.split(/\s*[-–—]\s*/);
          if (dashSplit.length >= 2) {
            metaName = dashSplit[0].trim();
            metaHeadline = dashSplit.slice(1).join(" - ").trim();
          } else {
            metaName = firstPart.trim();
          }
        }
        // Find location (usually a city/country pattern)
        const locMatch = metaDesc.match(/·\s*([A-Z][a-zA-Z\s,]+(?:Area|Region|City)?)\s*·/);
        if (locMatch) metaLocation = locMatch[1].trim();
        // Find connections
        const connMatch = metaDesc.match(/(\d[\d,+]*)\s*connections?/i);
        if (connMatch) metaConnections = connMatch[1].replace(/,/g, "");
      }

      // ═══ STRATEGY 4: DOM selectors (least reliable, changes often) ═══
      const txt = (sel: string) => document.querySelector(sel)?.textContent?.trim() || "";

      const domName =
        txt("h1.text-heading-xlarge") ||
        txt("h1.inline.t-24") ||
        txt("h1") ||
        "";
      const domHeadline =
        txt(".text-body-medium.break-words") ||
        txt(".pv-text-details__left-panel .text-body-medium") ||
        "";
      const domLocation =
        txt(".text-body-small.inline.t-black--light.break-words") ||
        txt(".pv-text-details__left-panel .text-body-small") ||
        "";

      // Connections from DOM
      const domConnections = (() => {
        const allText = document.body.innerText || "";
        const m = allText.match(/(\d[\d,+]*)\s*connections?/i);
        return m ? m[1].replace(/,/g, "") : "";
      })();

      // Premium badge
      const isPremium = !!document.querySelector(
        '.premium-icon, .pv-text-details__premium-icon, img[alt*="Premium"], [data-anonymize="premium-badge"]'
      );

      // About from DOM
      const aboutSection = document.querySelector("#about")?.closest("section");
      const domAbout = aboutSection?.querySelector(".inline-show-more-text span, .pv-shared-text-with-see-more span")
        ?.textContent?.trim() || "";

      // Experience from DOM
      const expSection = document.querySelector("#experience")?.closest("section");
      let domTitle = "";
      let domCompany = "";
      if (expSection) {
        const firstExp = expSection.querySelector("li");
        if (firstExp) {
          domTitle = firstExp.querySelector('.t-bold span, [data-anonymize="job-title"]')
            ?.textContent?.trim() || "";
          const compText = firstExp.querySelector('.t-14.t-normal span, [data-anonymize="company-name"]')
            ?.textContent?.trim() || "";
          domCompany = compText.split(" · ")[0].trim();
        }
      }

      // ═══ MERGE: Best value from all strategies ═══
      const name = jsonLd?.name || titleName || domName || metaName || ogTitle?.split(/\s*[-–—|]\s*/)?.[0] || "";
      const headline = jsonLd?.jobTitle?.[0] || jsonLd?.jobTitle || titleHeadline || domHeadline || metaHeadline || "";
      const location = jsonLd?.address?.addressLocality || domLocation || metaLocation || "";
      const connections = domConnections || metaConnections || "";
      const about = domAbout || (jsonLd?.description || "").substring(0, 500) || "";
      const currentTitle = domTitle || (jsonLd?.jobTitle?.[0] || jsonLd?.jobTitle || "");
      const currentCompany = domCompany || (jsonLd?.worksFor?.[0]?.name || jsonLd?.worksFor?.name || "");

      return {
        name: typeof name === "string" ? name : "",
        headline: typeof headline === "string" ? headline : "",
        location: typeof location === "string" ? location : "",
        connections: typeof connections === "string" ? connections : "",
        isPremium,
        about: typeof about === "string" ? about.substring(0, 500) : "",
        currentTitle: typeof currentTitle === "string" ? currentTitle : "",
        currentCompany: typeof currentCompany === "string" ? currentCompany : "",
      };
    });

    return { ...data, profileUrl: url };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ...emptyResult, error: message };
  }
}

export async function* scrapeProfiles(
  urls: string[],
  cookies: LinkedInCookie[]
): AsyncGenerator<ScrapeProgress> {
  const browser = await getBrowser();
  const page = await setupPage(browser, cookies);

  try {
    // Warm up — visit LinkedIn homepage first to establish session
    yield {
      type: "progress",
      current: 0,
      total: urls.length,
      message: "Warming up session...",
    };

    try {
      await page.goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await new Promise((r) => setTimeout(r, 2000));

      // Check if we're logged in
      const feedUrl = page.url();
      if (feedUrl.includes("/login") || feedUrl.includes("/authwall")) {
        yield {
          type: "error",
          current: 0,
          total: urls.length,
          message: "❌ Cookies are invalid or expired. Please update your li_at cookie.",
        };
        return;
      }

      yield {
        type: "progress",
        current: 0,
        total: urls.length,
        message: "✅ Session verified. Starting scan...",
      };
    } catch {
      yield {
        type: "progress",
        current: 0,
        total: urls.length,
        message: "⚠ Could not verify session, proceeding anyway...",
      };
    }

    await new Promise((r) => setTimeout(r, 1500));

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      if (!url) continue;

      yield {
        type: "progress",
        current: i + 1,
        total: urls.length,
        message: `Scanning profile ${i + 1} of ${urls.length}...`,
      };

      const result = await scrapeProfile(page, url);

      yield {
        type: "result",
        current: i + 1,
        total: urls.length,
        message: result.error
          ? `❌ ${result.error}`
          : `✅ ${result.name || "Unknown"}`,
        data: result,
      };

      // Random human-like delay between profiles (4-8s)
      if (i < urls.length - 1) {
        const delay = 4000 + Math.random() * 4000;
        yield {
          type: "progress",
          current: i + 1,
          total: urls.length,
          message: `Waiting ${Math.round(delay / 1000)}s before next profile...`,
        };
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    yield {
      type: "done",
      current: urls.length,
      total: urls.length,
      message: `Completed! ${urls.length} profiles scanned.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    yield {
      type: "error",
      current: 0,
      total: urls.length,
      message: `Fatal error: ${message}`,
    };
  } finally {
    await page.close();
  }
}
