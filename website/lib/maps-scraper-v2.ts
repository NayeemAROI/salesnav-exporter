import { Page } from "puppeteer";
import { getBrowser } from "./linkedin-scraper";

export interface MapsResult {
  searchString: string;
  rank: number;
  title: string;
  placeId: string;
  url: string;
  address: string | null;
  categoryName: string | null;
  categories: string[];
  totalScore: number | null;
  reviewsCount: number | null;
  website: string | null;
  phone: string | null;
  location: { lat: number | null; lng: number | null };
  openingHours: Array<{ day: string; hours: string }>;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  price: string | null;
  imageUrl: string | null;
  description: string | null;
  neighborhood: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  state: string | null;
  countryCode: string | null;
  scrapedAt: string;
}

export interface MapsProgress {
  type: "progress" | "page_done" | "done" | "error";
  current: number;
  total: number;
  page: number;
  message: string;
  data?: MapsResult[];
}

export interface MapsScrapeOptions {
  maxCrawledPlacesPerSearch?: number;
  language?: string;
  categoryFilterWords?: string[];
  placeMinimumStars?: number;
  website?: "allPlaces" | "withWebsite" | "withoutWebsite";
  skipClosedPlaces?: boolean;
  scrapePlaceDetailPage?: boolean;
  maxReviews?: number;
  maxImages?: number;
}

type BasicPlace = { title: string; url: string; rank: number };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseAddress(address: string | null) {
  const parts = (address || "").split(",").map((part) => part.trim()).filter(Boolean);
  const postalCode = address?.match(/\b\d{4,6}(?:-\d{4})?\b/)?.[0] || null;
  return {
    street: parts.length > 2 ? parts.slice(0, -2).join(", ") : parts[0] || null,
    city: parts.length > 1 ? parts.at(-2) || null : null,
    state: parts.length > 2 ? parts.at(-1)?.replace(postalCode || "", "").trim() || null : null,
    postalCode,
    neighborhood: null as string | null,
    countryCode: null as string | null,
  };
}

function placeKey(place: Pick<MapsResult, "placeId" | "url">) {
  return place.placeId || place.url.split("?")[0];
}

async function collectLinks(page: Page, limit: number): Promise<BasicPlace[]> {
  await page.waitForSelector('div[role="feed"], a[href*="/maps/place/"]', { timeout: 20_000 });
  let stableRounds = 0;
  let previousCount = 0;
  for (let round = 0; round < 60 && previousCount < limit && stableRounds < 5; round++) {
    const count = await page.$$eval('a[href*="/maps/place/"]', (links) => new Set(links.map((link) => (link as HTMLAnchorElement).href)).size);
    stableRounds = count === previousCount ? stableRounds + 1 : 0;
    previousCount = count;
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
      if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: "instant" });
      else window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    });
    await sleep(650);
  }

  return page.$$eval('a[href*="/maps/place/"]', (links, max) => {
    const seen = new Set<string>();
    const rows: BasicPlace[] = [];
    for (const link of links as NodeListOf<HTMLAnchorElement>) {
      const url = link.href;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const container = link.closest('[role="article"], .Nv2PK, div[role="feed"] > div');
      const title = link.getAttribute("aria-label")?.trim() || (container?.querySelector('[role="heading"], .qBF1Pd') as HTMLElement | null)?.innerText?.trim() || "Unknown place";
      rows.push({ title, url, rank: rows.length + 1 });
      if (rows.length >= Number(max)) break;
    }
    return rows;
  }, limit);
}

async function extractPlace(page: Page, basic: BasicPlace, searchString: string): Promise<MapsResult> {
  const data = await page.evaluate(() => {
    const text = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() || null;
    const attr = (selector: string, name: string) => document.querySelector(selector)?.getAttribute(name) || null;
    const body = document.body.innerText || "";
    const title = text('h1, [role="main"] h1') || attr('meta[property="og:title"]', "content") || "Unknown place";
    const address = attr('button[data-item-id="address"]', "aria-label")?.replace(/^Address:\s*/i, "") || text('button[data-item-id="address"]') || null;
    const phone = attr('button[data-item-id^="phone"]', "aria-label")?.replace(/^Phone:\s*/i, "") || text('button[data-item-id^="phone"]') || null;
    const websiteNode = document.querySelector('a[data-item-id="authority"]') as HTMLAnchorElement | null;
    const category = text('button[jsaction*="category"], button.DkEaL') || null;
    const ratingText = attr('[role="img"][aria-label*="stars"]', "aria-label") || text('.F7nice span[aria-hidden="true"]') || "";
    const reviewText = attr('[aria-label*="reviews"]', "aria-label") || body.match(/[\d,]+ reviews/i)?.[0] || "";
    const hoursLabel = attr('[data-item-id="oh"]', "aria-label") || "";
    const price = text('[aria-label^="Price"], .mgr77e') || null;
    const imageUrl = (document.querySelector('button[jsaction*="photo"] img, img[decoding="async"]') as HTMLImageElement | null)?.src || null;
    const description = text('[data-section-id="description"], .PYvSYb, .WeS02d') || null;
    return {
      title,
      address,
      phone,
      website: websiteNode?.href || null,
      category,
      score: Number.parseFloat(ratingText.replace(",", ".")) || null,
      reviews: Number.parseInt(reviewText.replace(/\D/g, ""), 10) || null,
      hoursLabel,
      price,
      imageUrl,
      description,
      permanentlyClosed: /permanently closed/i.test(body),
      temporarilyClosed: /temporarily closed/i.test(body),
    };
  });

  const loadedUrl = page.url();
  const placeId = loadedUrl.match(/!1s([^!]+)/)?.[1] || loadedUrl.match(/place_id:([^&/]+)/)?.[1] || "";
  const coords = loadedUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const addressParts = parseAddress(data.address);
  return {
    searchString,
    rank: basic.rank,
    title: data.title || basic.title,
    placeId,
    url: loadedUrl,
    address: data.address,
    categoryName: data.category,
    categories: data.category ? [data.category] : [],
    totalScore: data.score,
    reviewsCount: data.reviews,
    website: data.website,
    phone: data.phone,
    location: { lat: coords ? Number(coords[1]) : null, lng: coords ? Number(coords[2]) : null },
    openingHours: data.hoursLabel ? [{ day: "Summary", hours: data.hoursLabel }] : [],
    permanentlyClosed: data.permanentlyClosed,
    temporarilyClosed: data.temporarilyClosed,
    price: data.price,
    imageUrl: data.imageUrl,
    description: data.description,
    ...addressParts,
    scrapedAt: new Date().toISOString(),
  };
}

function matchesFilters(item: MapsResult, options: MapsScrapeOptions) {
  if (options.skipClosedPlaces && (item.permanentlyClosed || item.temporarilyClosed)) return false;
  if (options.placeMinimumStars && (item.totalScore || 0) < options.placeMinimumStars) return false;
  if (options.website === "withWebsite" && !item.website) return false;
  if (options.website === "withoutWebsite" && item.website) return false;
  const words = options.categoryFilterWords?.map((word) => word.toLowerCase()).filter(Boolean) || [];
  if (words.length && !words.some((word) => `${item.categoryName || ""} ${item.title}`.toLowerCase().includes(word))) return false;
  return true;
}

export async function* scrapeGoogleMaps(searchUrl: string, options: MapsScrapeOptions = {}): AsyncGenerator<MapsProgress> {
  const limit = Math.min(Math.max(options.maxCrawledPlacesPerSearch || 100, 1), 500);
  const browser = await getBrowser();
  const page = await browser.newPage();
  const language = options.language || "en";
  try {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": `${language},en;q=0.8` });
    yield { type: "progress", current: 0, total: limit, page: 1, message: "Opening Google Maps..." };
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const consent = await page.$('button[aria-label*="Accept"], form[action*="consent"] button');
    if (consent) { await consent.click(); await sleep(1_000); }
    const links = await collectLinks(page, limit);
    if (!links.length) throw new Error("No Google Maps results found. Try a broader query or location.");

    const results: MapsResult[] = [];
    const seen = new Set<string>();
    for (const basic of links) {
      yield { type: "progress", current: results.length, total: limit, page: 1, message: `Reading ${basic.rank} of ${Math.min(links.length, limit)}: ${basic.title}` };
      let item: MapsResult;
      if (options.scrapePlaceDetailPage !== false) {
        await page.goto(basic.url, { waitUntil: "domcontentloaded", timeout: 35_000 });
        await page.waitForSelector('h1, [role="main"]', { timeout: 12_000 }).catch(() => null);
        await sleep(600);
        item = await extractPlace(page, basic, searchUrl);
      } else {
        const addressParts = parseAddress(null);
        item = { searchString: searchUrl, rank: basic.rank, title: basic.title, placeId: "", url: basic.url, address: null, categoryName: null, categories: [], totalScore: null, reviewsCount: null, website: null, phone: null, location: { lat: null, lng: null }, openingHours: [], permanentlyClosed: false, temporarilyClosed: false, price: null, imageUrl: null, description: null, ...addressParts, scrapedAt: new Date().toISOString() };
      }
      const key = placeKey(item);
      if (!seen.has(key) && matchesFilters(item, options)) { seen.add(key); results.push(item); }
      if (results.length >= limit) break;
    }
    yield { type: "page_done", current: results.length, total: limit, page: 1, message: `Collected ${results.length} unique places`, data: results };
    yield { type: "done", current: results.length, total: results.length, page: 1, message: `Done. ${results.length} unique places collected.` };
  } catch (error) {
    yield { type: "error", current: 0, total: limit, page: 1, message: error instanceof Error ? error.message : "Google Maps scrape failed" };
  } finally {
    await page.close().catch(() => null);
  }
}
