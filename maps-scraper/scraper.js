import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

export function buildQueries({ searches = [], location = "" }) {
  const clean = searches.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 10);
  return clean.map((value) => {
    if (/^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(value)) return value;
    const q = location ? `${value} ${location}` : value;
    return `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
  });
}

function parseAddress(address) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    street: parts.length > 2 ? parts.slice(0, -2).join(", ") : parts[0] || null,
    city: parts.length > 1 ? parts[parts.length - 2] || null : null,
    postalCode: (address || "").match(/\b\d{4,6}(?:-\d{4})?\b/)?.[0] || null,
  };
}

async function collectLinks(page, limit) {
  await page.waitForSelector('div[role="feed"], a[href*="/maps/place/"]', { timeout: 25000 });
  let stable = 0;
  let previous = 0;
  for (let round = 0; round < 60 && previous < limit && stable < 5; round++) {
    const count = await page.$$eval('a[href*="/maps/place/"]', (links) => new Set(links.map((l) => l.href)).size);
    stable = count === previous ? stable + 1 : 0;
    previous = count;
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTo({ top: feed.scrollHeight });
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await sleep(700);
  }
  return page.$$eval('a[href*="/maps/place/"]', (links, max) => {
    const seen = new Set();
    const rows = [];
    for (const link of links) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      const container = link.closest('[role="article"], .Nv2PK, div[role="feed"] > div');
      const title = link.getAttribute("aria-label")?.trim() || container?.querySelector('[role="heading"], .qBF1Pd')?.innerText?.trim() || "Unknown place";
      rows.push({ url: link.href, title, rank: rows.length + 1 });
      if (rows.length >= max) break;
    }
    return rows;
  }, limit);
}

async function extractPlace(page) {
  return page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) || null;
    const body = document.body.innerText || "";
    const ratingText = attr('[role="img"][aria-label*="stars"]', "aria-label") || text('.F7nice span[aria-hidden="true"]') || "";
    const reviewText = attr('[aria-label*="reviews"]', "aria-label") || body.match(/[\d,]+ reviews/i)?.[0] || "";
    const website = document.querySelector('a[data-item-id="authority"]');
    return {
      title: text('h1, [role="main"] h1') || attr('meta[property="og:title"]', "content") || "Unknown place",
      address: attr('button[data-item-id="address"]', "aria-label")?.replace(/^Address:\s*/i, "") || null,
      phone: attr('button[data-item-id^="phone"]', "aria-label")?.replace(/^Phone:\s*/i, "") || null,
      website: website?.href || null,
      categoryName: text('button[jsaction*="category"], button.DkEaL') || null,
      totalScore: Number.parseFloat(ratingText.replace(",", ".")) || null,
      reviewsCount: Number.parseInt(reviewText.replace(/\D/g, ""), 10) || null,
      price: text('[aria-label^="Price"], .mgr77e') || null,
      permanentlyClosed: /permanently closed/i.test(body),
      temporarilyClosed: /temporarily closed/i.test(body),
    };
  });
}

function matches(item, opts) {
  if (opts.skipClosed && (item.permanentlyClosed || item.temporarilyClosed)) return false;
  if (opts.minStars && (item.totalScore || 0) < opts.minStars) return false;
  if (opts.website === "withWebsite" && !item.website) return false;
  if (opts.website === "withoutWebsite" && item.website) return false;
  return true;
}

/**
 * Streams progress objects: { type, current, total, message, data? }.
 * `onEvent` is called for each. Resolves with the full result array.
 */
export async function scrapeMaps(options, onEvent) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const queries = buildQueries(options);
  if (!queries.length) throw new Error("No search query provided.");

  const browser = await puppeteer.launch({
    executablePath: EXEC,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const results = [];
  const seen = new Set();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": `${options.language || "en"},en;q=0.8` });

    for (let q = 0; q < queries.length && results.length < limit; q++) {
      onEvent({ type: "progress", current: results.length, total: limit, message: `Opening query ${q + 1} of ${queries.length}` });
      await page.goto(queries[q], { waitUntil: "domcontentloaded", timeout: 45000 });
      const consent = await page.$('button[aria-label*="Accept"], form[action*="consent"] button');
      if (consent) { await consent.click().catch(() => {}); await sleep(1000); }

      const links = await collectLinks(page, limit - results.length);
      for (const basic of links) {
        if (results.length >= limit) break;
        onEvent({ type: "progress", current: results.length, total: limit, message: `Reading: ${basic.title}` });
        let item;
        if (options.details === false) {
          item = { rank: basic.rank, title: basic.title, url: basic.url, address: null, categoryName: null, totalScore: null, reviewsCount: null, website: null, phone: null, price: null, permanentlyClosed: false, temporarilyClosed: false, ...parseAddress(null) };
        } else {
          await page.goto(basic.url, { waitUntil: "domcontentloaded", timeout: 35000 });
          await page.waitForSelector('h1, [role="main"]', { timeout: 12000 }).catch(() => {});
          await sleep(600);
          const detail = await extractPlace(page);
          item = { rank: basic.rank, url: page.url(), ...detail, ...parseAddress(detail.address) };
        }
        const key = item.url.split("?")[0];
        if (seen.has(key) || !matches(item, { skipClosed: options.skipClosed, minStars: options.minStars, website: options.website })) continue;
        seen.add(key);
        results.push(item);
        onEvent({ type: "result", current: results.length, total: limit, message: item.title, data: item });
      }
    }
    onEvent({ type: "done", current: results.length, total: results.length, message: `Done. ${results.length} unique places.` });
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}
