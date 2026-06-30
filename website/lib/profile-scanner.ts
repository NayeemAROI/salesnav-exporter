import { Page } from "puppeteer";
import { getBrowser, LinkedInCookie, ProxyConfig, authenticateProxy } from "./linkedin-scraper";

/* ── Types ── */
export interface ProfileScanResult {
  original_url: string;
  name: string;
  profile_url: string;
  status: string;          // 'active' | 'inactive' | 'Skipped'
  is_premium: string;      // 'Yes' | 'No' | 'Skipped'
  connection_count: string;
  activity_type: string;   // 'Post' | 'Comment' | 'Reaction' | 'Repost' | 'Premium' | 'None'
  last_activity: string;   // '2 Days' | '3 Months' | 'now' | 'No activity'
}

export interface ProfileScanProgress {
  type: "progress" | "result" | "done" | "error";
  current: number;
  total: number;
  message: string;
  data?: ProfileScanResult;
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
   EXTRACT PROFILE MAIN — exact content_profile.js extractProfileMain()
   ═══════════════════════════════════════════ */
async function extractProfileMain(page: Page) {
  return page.evaluate(async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    await sleep(3000);
    let name = "", connectionCount = "", connectionCountInt = 0, isPremium = false;

    // ═══ STRATEGY 1: DOM selectors (h1 + h2 + role heading) ═══
    let nameEl: Element | null = null;
    for (let i = 0; i < 16; i++) {
      nameEl = document.querySelector(
        'h1.text-heading-xlarge, h2.text-heading-xlarge, ' +
        '.ph5 h1, .ph5 h2, .pv-top-card h1, .pv-top-card h2, ' +
        'main h1, main h2, ' +
        '[data-anonymize="person-name"], .profile-topcard-person-entity__name, ' +
        'main [role="heading"][aria-level="1"], main [role="heading"][aria-level="2"]'
      );
      if (nameEl && (nameEl as HTMLElement).innerText?.trim()) break;
      await sleep(250);
    }
    if (nameEl) name = (nameEl as HTMLElement).innerText.trim();

    // ═══ STRATEGY 1b: Any heading inside main section ═══
    if (!name) {
      const headings = document.querySelectorAll('main h1, main h2, main [role="heading"]');
      for (const h of headings) {
        const t = (h as HTMLElement).innerText?.trim();
        // Person names: 2-5 words, no special chars, not a section label
        if (t && t.length > 2 && t.length < 60 && /^[A-Za-z\u00C0-\u024F\u0600-\u06FF\u0980-\u09FF\s.'-]+$/.test(t) 
            && !/\b(experience|education|skills|about|activity|interests|recommendations)\b/i.test(t)) {
          name = t;
          break;
        }
      }
    }

    // ═══ STRATEGY 2: JSON-LD structured data ═══
    if (!name) {
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          const parsed = JSON.parse(s.textContent || "");
          if (parsed["@type"] === "Person" || parsed["@type"]?.includes?.("Person")) {
            if (parsed.name) name = parsed.name;
            break;
          }
        }
      } catch {}
    }

    // ═══ STRATEGY 3: document.title → "Name - Title | LinkedIn" ═══
    if (!name) {
      const titleMatch = (document.title || "").match(/^(.+?)\s*[-–—]\s*(.+?)\s*\|\s*LinkedIn/);
      if (titleMatch) name = titleMatch[1].trim();
    }

    // ═══ STRATEGY 4: og:title meta tag ═══
    if (!name) {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
      const ogMatch = ogTitle.split(/\s*[-–—|]\s*/);
      if (ogMatch[0]) name = ogMatch[0].trim();
    }

    // ═══ Connection count — DOM + meta fallback ═══
    const allText = document.body.innerText || "";
    const connMatch = allText.match(/([\d,]+\+?)\s+connections/i) || allText.match(/([\d,]+\+?)\s+followers/i);
    if (connMatch) { connectionCount = connMatch[1]; }
    else {
      const connEls = document.querySelectorAll(".t-bold");
      for (const el of connEls) { if ((el as HTMLElement).innerText.includes("500+")) { connectionCount = "500+"; break; } }
    }
    // Meta description fallback for connections
    if (!connectionCount) {
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      const metaConn = metaDesc.match(/(\d[\d,+]*)\s*connections?/i);
      if (metaConn) connectionCount = metaConn[1].replace(/,/g, "");
    }
    if (connectionCount) connectionCountInt = parseInt(connectionCount.replace(/,/g, "").replace(/\+/g, ""), 10) || 0;

    return { name, connectionCount, connectionCountInt, isPremium };
  });
}

/* ═══════════════════════════════════════════
   EXTRACT ACTIVITY — exact content_profile.js extractProfileActivity()
   With snowflake decoder, time parsing, premium detection
   ═══════════════════════════════════════════ */
async function extractProfileActivity(page: Page) {
  return page.evaluate(async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Snowflake decoder
    function decodeSnowflakeTimestamp(idStr: string): Date | null {
      try {
        const id = BigInt(idStr);
        const timestamp = Number(id >> 22n) + 1288834974657;
        const date = new Date(timestamp);
        if (date.getFullYear() >= 2010 && date.getFullYear() <= 2030) return date;
      } catch {}
      return null;
    }
    function formatTimeAgo(date: Date) {
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      const diffWeeks = Math.floor(diffDays / 7);
      const diffMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
      const diffYears = Math.floor(diffMonths / 12);
      if (diffHours < 1) return "now";
      if (diffHours < 24) return diffHours + (diffHours === 1 ? " Hour" : " Hours");
      if (diffDays < 7) return diffDays + (diffDays === 1 ? " Day" : " Days");
      if (diffWeeks < 5) return diffWeeks + (diffWeeks === 1 ? " Week" : " Weeks");
      if (diffMonths < 12) return diffMonths + (diffMonths === 1 ? " Month" : " Months");
      return diffYears + (diffYears === 1 ? " Year" : " Years");
    }
    function timeStringToDays(t: string) {
      if (!t || t === "now") return 0;
      const num = parseInt(t) || 0;
      const lower = t.toLowerCase();
      if (lower.includes("minute")) return 0;
      if (lower.includes("hour")) return 0;
      if (lower.includes("day")) return num;
      if (lower.includes("week")) return num * 7;
      if (lower.includes("month")) return num * 30;
      if (lower.includes("year")) return num * 365;
      return 9999;
    }

    // Wait for feed or empty state
    let feedFound = false, isEmpty = false;
    for (let i = 0; i < 12; i++) {
      if (document.querySelector('.profile-creator-shared-feed-update__container, .feed-shared-update-v2, .occludable-update, [data-urn^="urn:li:activity:"]')) { feedFound = true; break; }
      if (document.querySelector(".artdeco-empty-state")) { feedFound = true; isEmpty = true; break; }
      const bodyText = document.body.innerText || "";
      if (bodyText.includes("hasn't posted") || bodyText.includes("No posts") || bodyText.includes("No activity")) { feedFound = true; isEmpty = true; break; }
      await sleep(500);
    }

    let lastActivityTime = "", lastActivityType = "";

    // Premium detection
    let isPremium = false;
    for (let i = 0; i < 6; i++) {
      const pw = document.querySelector('span.pv-recent-activity-top-card__premium_wordmark, [class*="premium_wordmark"], [class*="premium-wordmark"]');
      if (pw) { isPremium = true; break; }
      const spans = document.querySelectorAll(".pv-recent-activity-top-card span, .profile-creator-shared-header span");
      for (const span of spans) { if ((span as HTMLElement).innerText.trim().toUpperCase() === "PREMIUM") { isPremium = true; break; } }
      if (isPremium) break;
      await sleep(500);
    }

    if (isEmpty || !feedFound) return { lastActivityTime, lastActivityType, isPremium };

    window.scrollBy(0, 500);
    await sleep(500);

    const updateEls = document.querySelectorAll('.profile-creator-shared-feed-update__container, .feed-shared-update-v2, .occludable-update, [data-urn^="urn:li:activity:"]');
    const elSet = new Set(updateEls);
    const uniqueEls: Element[] = [];
    for (const el of updateEls) {
      let dominated = false;
      let parent = el.parentElement;
      while (parent) { if (elSet.has(parent)) { dominated = true; break; } parent = parent.parentElement; }
      if (!dominated) uniqueEls.push(el);
    }

    let bestAgeDays = Infinity;

    for (const el of uniqueEls) {
      let currentType = "Post";
      const href = window.location.href;
      if (href.includes("/comments/")) currentType = "Comment";
      else if (href.includes("/reactions/")) currentType = "Reaction";
      else if (href.includes("/shares/")) currentType = "Post";
      else {
        const headerEl = el.querySelector(".update-components-header__text-wrapper, .update-components-header, .update-components-actor__description, .feed-shared-header");
        let typeText = headerEl ? (headerEl as HTMLElement).innerText.toLowerCase() : (el as HTMLElement).innerText.substring(0, 300).toLowerCase();
        if (typeText.match(/\bcommented\b|\breplied\b/)) currentType = "Comment";
        else if (typeText.match(/\bliked\b|\breacted\b|\bcelebrated\b|\bfinds this\b/)) currentType = "Reaction";
        else if (typeText.match(/\breposted\b|\bshared\b/)) currentType = "Repost";
      }

      let currentTime = "";
      // Strategy 1: <time datetime>
      const timeEl = el.querySelector("time[datetime]");
      if (timeEl) { const d = new Date(timeEl.getAttribute("datetime") || ""); if (!isNaN(d.getTime())) currentTime = formatTimeAgo(d); }
      // Strategy 2: Snowflake from data-urn
      if (!currentTime) { const urn = el.getAttribute("data-urn") || ""; const m = urn.match(/activity:(\d{15,20})/); if (m) { const d = decodeSnowflakeTimestamp(m[1]); if (d) currentTime = formatTimeAgo(d); } }
      // Strategy 3: Activity link snowflakes
      if (!currentTime) { for (const link of el.querySelectorAll('a[href*="activity:"]')) { const m = (link.getAttribute("href") || "").match(/activity[:\-](\d{15,20})/); if (m) { const d = decodeSnowflakeTimestamp(m[1]); if (d) { currentTime = formatTimeAgo(d); break; } } } }
      // Strategy 4: Relative time text
      if (!currentTime) {
        const raw = ((el.querySelector(".update-components-actor, .update-components-header") as HTMLElement)?.innerText || (el as HTMLElement).innerText.substring(0, 400)).toLowerCase();
        const tm = raw.match(/\b(\d+)\s*(mo|yr|month|year|week|day|hour|min|sec)s?\b/i) || raw.match(/\b(now)\b/i);
        if (tm) {
          if (tm[1] === "now") currentTime = "now";
          else { const v = parseInt(tm[1]), u = tm[2].toLowerCase();
            if (u.startsWith("min") || u.startsWith("sec")) currentTime = v + " Minutes";
            else if (u.startsWith("hour")) currentTime = v + " Hours";
            else if (u.startsWith("day")) currentTime = v + " Days";
            else if (u.startsWith("week")) currentTime = v + " Weeks";
            else if (u.startsWith("month") || u === "mo") currentTime = v + " Months";
            else if (u.startsWith("year") || u === "yr") currentTime = v + " Years";
          }
        }
      }
      if (currentTime) { const age = timeStringToDays(currentTime); if (age < bestAgeDays) { bestAgeDays = age; lastActivityTime = currentTime; lastActivityType = currentType; } }
    }

    // Fallback: visible relative time spans
    if (!lastActivityTime && feedFound) {
      const allSpans = document.querySelectorAll('span.visually-hidden, span[aria-hidden="true"], .update-components-actor__sub-description span');
      for (const span of allSpans) {
        const t = (span as HTMLElement).innerText.trim().toLowerCase();
        const m = t.match(/^(\d+)(mo|yr|h|d|w|m|now)/i);
        if (m) {
          if (m[1] === "now") lastActivityTime = "now";
          else { const v = parseInt(m[1]), u = m[2];
            if (u === "m") lastActivityTime = v + " Minutes"; else if (u === "h") lastActivityTime = v + " Hours";
            else if (u === "d") lastActivityTime = v + " Days"; else if (u === "w") lastActivityTime = v + " Weeks";
            else if (u === "mo") lastActivityTime = v + " Months"; else if (u === "yr") lastActivityTime = v + " Years";
          }
          lastActivityType = lastActivityType || "Post"; break;
        }
      }
    }
    return { lastActivityTime, lastActivityType, isPremium };
  });
}

/* ═══════════════════════════════════════════
   MAIN SCANNER — exact background.js _scanNextInner() flow
   ═══════════════════════════════════════════ */
export async function* scanProfiles(
  urls: string[], cookies: LinkedInCookie[],
  options: { minConnections?: number; minActivityMonths?: number; proxy?: ProxyConfig } = {}
): AsyncGenerator<ProfileScanProgress> {
  const page = await setupPage(cookies, options.proxy);
  const minConn = options.minConnections || 0;
  const minMonths = options.minActivityMonths || 3;

  try {
    // Session warmup
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

      yield { type: "progress", current: i + 1, total: urls.length, message: `Loading profile ${i + 1} of ${urls.length}...` };

      let result: ProfileScanResult;
      try {
        // Parse base URL
        const profileMatch = url.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/in\/[^/?]+)/);
        const baseUrl = profileMatch ? profileMatch[1] + "/" : url.split("?")[0];

        // Navigate to profile
        await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 }).catch(() =>
          page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        );
        try { await page.waitForSelector("h1, h2, [role='heading']", { timeout: 15000 }); } catch {}
        await new Promise(r => setTimeout(r, 3500));

        // Check for auth wall
        if (page.url().includes("/login") || page.url().includes("/authwall")) {
          result = { original_url: url, name: "Unknown", profile_url: baseUrl, status: "Skipped",
            is_premium: "Skipped", connection_count: "Skipped", activity_type: "Skipped", last_activity: "Auth wall" };
          yield { type: "result", current: i + 1, total: urls.length, message: `⚠ ${result.name} — auth wall`, data: result };
          continue;
        }

        // Get final URL after redirect
        const finalUrl = page.url();
        const finalMatch = finalUrl.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/in\/[^/?]+)/);
        let finalPublicUrl = finalMatch ? finalMatch[1] + "/" : finalUrl.split("?")[0];
        if (!finalPublicUrl.endsWith("/")) finalPublicUrl += "/";

        // Extract main profile data
        yield { type: "progress", current: i + 1, total: urls.length, message: `Scanning profile ${i + 1} of ${urls.length}...` };
        let mainData: { name: string; connectionCount: string; connectionCountInt: number; isPremium: boolean };
        try {
          mainData = await extractProfileMain(page);
        } catch {
          // Context destroyed — use fallbacks only
          mainData = { name: "", connectionCount: "", connectionCountInt: 0, isPremium: false };
        }

        // ═══ SERVER-SIDE NAME FALLBACK ═══
        // page.evaluate may fail to find name if LinkedIn doesn't render DOM for Puppeteer
        if (!mainData.name || mainData.name === "Unknown" || mainData.name === "LinkedIn") {
          // Try page.title() — always available
          const title = await page.title();
          const titleMatch = title.match(/^(.+?)\s*[-–—]\s*.+?\s*\|\s*LinkedIn/);
          if (titleMatch && titleMatch[1].trim() && !titleMatch[1].trim().toLowerCase().includes("linkedin")) {
            mainData.name = titleMatch[1].trim();
          }
        }
        if (!mainData.name || mainData.name === "Unknown" || mainData.name === "LinkedIn") {
          // Try og:title meta via $eval
          try {
            const ogTitle = await page.$eval('meta[property="og:title"]', el => el.getAttribute("content") || "");
            const parts = ogTitle.split(/\s*[-–—|]\s*/);
            if (parts[0] && !parts[0].toLowerCase().includes("linkedin")) mainData.name = parts[0].trim();
          } catch {}
        }
        if (!mainData.name || mainData.name === "Unknown" || mainData.name === "LinkedIn") {
          // Extract from URL slug as last resort: /in/john-doe/ → "John Doe"
          const slug = finalPublicUrl.match(/\/in\/([^/?#]+)/)?.[1];
          if (slug) mainData.name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        }

        let status = "inactive";
        let finalActivityTime = "";
        let finalActivityType = "";

        // Connection filter
        if (mainData.connectionCountInt < minConn) {
          status = "inactive"; finalActivityTime = "N/A"; finalActivityType = "N/A";
        } else if (mainData.isPremium) {
          status = "active"; finalActivityTime = "N/A"; finalActivityType = "Premium";
        } else {
          // Check activity: reactions → comments → shares (exact extension order)
          const activityTabs = ["reactions", "comments", "shares"];
          let bestAgeDays = Infinity;

          for (const actTab of activityTabs) {
            const activityUrl = finalPublicUrl + `recent-activity/${actTab}/`;
            yield { type: "progress", current: i + 1, total: urls.length, message: `Checking ${actTab} for profile ${i + 1}...` };

            try {
              await page.goto(activityUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
              await new Promise(r => setTimeout(r, 2000));

              // Re-check if page navigated away (auth wall / redirect)
              if (page.url().includes("/login") || page.url().includes("/authwall")) break;

              const actData = await extractProfileActivity(page);

              // Premium detected on activity page
              if (actData.isPremium) {
                mainData.isPremium = true;
                status = "active";
                finalActivityType = finalActivityType || "Premium";
                break;
              }

              if (actData.lastActivityTime) {
                // Calculate age
                const t = actData.lastActivityTime.toLowerCase();
                let ageInMonths = Infinity;
                if (t.includes("year")) ageInMonths = parseInt(actData.lastActivityTime) * 12;
                else if (t.includes("month")) ageInMonths = parseInt(actData.lastActivityTime);
                else ageInMonths = 0; // hours/days/weeks = < 1 month

                const isRecent = ageInMonths <= minMonths;
                const ageDays = (() => {
                  if (!actData.lastActivityTime || actData.lastActivityTime === "now") return 0;
                  const num = parseInt(actData.lastActivityTime) || 0;
                  const l = actData.lastActivityTime.toLowerCase();
                  if (l.includes("hour") || l.includes("minute")) return 0;
                  if (l.includes("day")) return num;
                  if (l.includes("week")) return num * 7;
                  if (l.includes("month")) return num * 30;
                  if (l.includes("year")) return num * 365;
                  return 9999;
                })();

                if (ageDays <= bestAgeDays) {
                  bestAgeDays = ageDays;
                  status = isRecent ? "active" : "inactive";
                  finalActivityTime = actData.lastActivityTime;
                  finalActivityType = actData.lastActivityType;
                }

                if (status === "active") break;
              }
            } catch (navErr: unknown) {
              // "Execution context destroyed" = LinkedIn redirected during evaluate
              const msg = navErr instanceof Error ? navErr.message : "";
              if (msg.includes("context") || msg.includes("destroyed") || msg.includes("navigation")) {
                // Wait and try to recover
                await new Promise(r => setTimeout(r, 2000));
                continue;
              }
              // Other errors — skip tab
            }
            await new Promise(r => setTimeout(r, 1500));
          }
        }

        result = {
          original_url: url,
          name: mainData.name || "Unknown",
          profile_url: finalPublicUrl,
          status,
          is_premium: mainData.isPremium ? "Yes" : "No",
          connection_count: mainData.connectionCount || "0",
          activity_type: finalActivityType || "None",
          last_activity: finalActivityTime || "No activity",
        };

        yield { type: "result", current: i + 1, total: urls.length,
          message: `${status === "active" ? "✅" : "❌"} ${result.name} — ${status} (${result.last_activity})`, data: result };

      } catch (err: unknown) {
        result = { original_url: url, name: "Unknown", profile_url: url, status: "Skipped",
          is_premium: "Skipped", connection_count: "Skipped", activity_type: "Skipped",
          last_activity: err instanceof Error ? err.message : "Error" };
        yield { type: "result", current: i + 1, total: urls.length, message: `⚠ Skipped profile ${i + 1}`, data: result };
      }

      // Random delay 3-8s between profiles (longer to avoid rate-limiting)
      if (i < urls.length - 1) {
        const delay = 3000 + Math.random() * 5000;
        yield { type: "progress", current: i + 1, total: urls.length, message: `Waiting ${Math.round(delay / 1000)}s...` };
        await new Promise(r => setTimeout(r, delay));
      }
    }

    yield { type: "done", current: urls.length, total: urls.length, message: `🎉 Done! Scanned ${urls.length} profiles.` };
  } catch (err: unknown) {
    yield { type: "error", current: 0, total: urls.length, message: `❌ ${err instanceof Error ? err.message : "Unknown"}` };
  } finally { await page.close(); }
}
