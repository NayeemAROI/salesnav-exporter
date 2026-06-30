import { getBrowser } from "./linkedin-scraper";

/* ── Types ── */

export interface Location {
  lat: number | null;
  lng: number | null;
}

export interface OpeningHoursEntry {
  day: string;
  hours: string;
}

export interface ReviewDistribution {
  oneStar: number;
  twoStar: number;
  threeStar: number;
  fourStar: number;
  fiveStar: number;
}

export interface PeopleAlsoSearch {
  category: string;
  title: string;
  reviewsCount: number | null;
  totalScore: number | null;
}

export interface ReviewsTag {
  title: string;
  count: number;
}

export interface ImageItem {
  imageUrl: string;
  authorName: string | null;
  authorUrl: string | null;
  uploadedAt: string | null;
}

export interface ReviewItem {
  name: string;
  text: string | null;
  textTranslated: string | null;
  publishAt: string;
  publishedAtDate: string | null;
  likesCount: number;
  reviewId: string;
  reviewUrl: string | null;
  reviewerId: string | null;
  reviewerUrl: string | null;
  reviewerPhotoUrl: string | null;
  reviewerNumberOfReviews: number | null;
  isLocalGuide: boolean;
  reviewOrigin: string;
  stars: number;
  rating: number | null;
  responseFromOwnerDate: string | null;
  responseFromOwnerText: string | null;
  reviewImageUrls: string[];
  reviewContext: Record<string, any>;
  reviewDetailedRating: Record<string, number> | null;
}

export interface OrderByItem {
  name: string;
  orderUrl: string;
}

export interface TableReservationLink {
  name: string;
  url: string;
}

export interface MapsResult {
  searchString: string;
  rank: number | null;
  searchPageUrl: string | null;
  searchPageLoadedUrl: string | null;
  isAdvertisement: boolean;
  title: string;
  subTitle: string | null;
  description: string | null;
  price: string | null;
  categoryName: string | null;
  address: string | null;
  neighborhood: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  state: string | null;
  countryCode: string | null;
  website: string | null;
  phone: string | null;
  phoneUnformatted: string | null;
  claimThisBusiness: boolean | null;
  location: Location;
  locatedIn: string | null;
  plusCode: string | null;
  menu: string | null;
  servicesLink: string | null;
  totalScore: number | null;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  placeId: string;
  categories: string[];
  fid: string | null;
  cid: string | null;
  reviewsCount: number | null;
  reviewsDistribution: ReviewDistribution | null;
  imagesCount: number;
  imageCategories: string[];
  scrapedAt: string;
  reserveTableUrl: string | null;
  googleFoodUrl: string | null;
  hotelStars: string | null;
  hotelDescription: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  similarHotelsNearby: Array<{ name: string; rating: number | null; reviews: number | null; description: string | null; price: string | null; }> | null;
  hotelReviewSummary: Record<string, any> | null;
  hotelAds: Array<{ title: string; googleUrl: string | null; isOfficialSite: boolean; price: string | null; url: string | null; }>;
  openingHours: OpeningHoursEntry[];
  additionalOpeningHours: Record<string, string>;
  peopleAlsoSearch: PeopleAlsoSearch[];
  placesTags: string[];
  reviewsTags: ReviewsTag[];
  additionalInfo: Record<string, Array<Record<string, boolean>>>;
  gasPrices: string[];
  questionsAndAnswers: Array<{ question: string; answer: string }>;
  updatesFromCustomers: string | null;
  ownerUpdates: string[];
  url: string;
  imageUrl: string | null;
  kgmid: string | null;
  webResults: string[];
  parentPlaceUrl: string | null;
  tableReservationLinks: TableReservationLink[];
  bookingLinks: TableReservationLink[];
  orderBy: OrderByItem[];
  images: ImageItem[];
  imageUrls: string[];
  reviews: ReviewItem[];
  userPlaceNote: string | null;
  restaurantData: Record<string, any>;
  isExternalServicePlace: boolean;
  externalServiceProvider: string | null;
  externalId: string | null;
}

export interface MapsProgress {
  type: "progress" | "result" | "page_done" | "done" | "error";
  current: number;
  total: number;
  page: number;
  message: string;
  data?: MapsResult[];
}

export interface MapsScrapeOptions {
  searchStringsArray?: string[];
  locationQuery?: string;
  maxCrawledPlacesPerSearch?: number;
  language?: string;
  categoryFilterWords?: string[];
  searchMatching?: "all" | "only_includes" | "only_exact";
  placeMinimumStars?: number;
  website?: "allPlaces" | "withWebsite" | "withoutWebsite";
  skipClosedPlaces?: boolean;
  scrapePlaceDetailPage?: boolean;
  scrapeTableReservationProvider?: boolean;
  includeWebResults?: boolean;
  scrapeDirectories?: boolean;
  maxQuestions?: number;
  scrapeContacts?: boolean;
  scrapeSocialMediaProfiles?: boolean;
  maximumLeadsEnrichmentRecords?: number;
  leadsEnrichmentDepartments?: string[];
  verifyLeadsEnrichmentEmails?: boolean;
  maxReviews?: number;
  reviewsStartDate?: string;
  reviewsSort?: "newest" | "mostRelevant" | "highestRanking" | "lowestRanking";
  reviewsFilterString?: string;
  reviewsOrigin?: "all" | "google";
  scrapeReviewsPersonalData?: boolean;
  maxImages?: number;
  scrapeImageAuthors?: boolean;
  countryCode?: string;
  city?: string;
  state?: string;
  county?: string;
  postalCode?: string;
  customGeolocation?: any;
  startUrls?: string[];
  placeIds?: string[];
  allPlacesNoSearchAction?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Retry wrapper ── */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) {
        await sleep(delay * (i + 1) + Math.random() * 500);
      }
    }
  }
  throw lastErr;
}

/* ── Parse address into components ── */
function parseAddressComponents(fullAddress: string): {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  neighborhood: string | null;
} {
  const result = {
    street: null,
    city: null,
    state: null,
    postalCode: null,
    countryCode: null,
    neighborhood: null,
  } as {
    street: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    countryCode: string | null;
    neighborhood: string | null;
  };
  if (!fullAddress) return result;

  // Extract postal/ZIP
  const postalMatch = fullAddress.match(/(\d{5}(-\d{4})?|\d{4,})/);
  if (postalMatch) result.postalCode = postalMatch[1];

  // Extract state (US pattern: City, State)
  const stateMatch = fullAddress.match(/,\s*([A-Z]{2})\s+\d/);
  if (stateMatch) result.state = stateMatch[1];

  // Country code heuristics
  if (/\bUSA?\b|United States/i.test(fullAddress)) result.countryCode = "US";
  else if (/\bUK\b|United Kingdom|England|Scotland|Wales/i.test(fullAddress)) result.countryCode = "GB";
  else if (/\bBangladesh\b/i.test(fullAddress)) result.countryCode = "BD";
  else if (/\bIndia\b/i.test(fullAddress)) result.countryCode = "IN";
  else if (/\bCanada\b/i.test(fullAddress)) result.countryCode = "CA";
  else if (/\bAustralia\b/i.test(fullAddress)) result.countryCode = "AU";
  else if (/\bGermany\b|Deutschland/i.test(fullAddress)) result.countryCode = "DE";
  else if (/\bFrance\b/i.test(fullAddress)) result.countryCode = "FR";
  else if (/\bSpain\b|España/i.test(fullAddress)) result.countryCode = "ES";
  else if (/\bItaly\b|Italia/i.test(fullAddress)) result.countryCode = "IT";
  else if (/\bNetherlands\b|Nederland/i.test(fullAddress)) result.countryCode = "NL";
  else if (/\bBrazil\b|Brasil/i.test(fullAddress)) result.countryCode = "BR";
  else if (/\bMexico\b|México/i.test(fullAddress)) result.countryCode = "MX";
  else if (/\bJapan\b|日本/i.test(fullAddress)) result.countryCode = "JP";
  else if (/\bSouth Korea\b|대한민국/i.test(fullAddress)) result.countryCode = "KR";
  else if (/\bChina\b|中国/i.test(fullAddress)) result.countryCode = "CN";

  // Split by comma for city/street
  const parts = fullAddress.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    result.city = parts[parts.length - 2];
    result.street = parts.slice(0, parts.length - 2).join(", ");
  } else if (parts.length === 2) {
    result.city = parts[parts.length - 1];
    result.street = parts[0];
  } else if (parts.length === 1) {
    result.street = parts[0];
  }

  return result;
}

/* ── Create empty result with defaults ── */
function createEmptyResult(
  url: string,
  searchString: string,
  searchPageUrl: string | null,
  rank: number | null
): MapsResult {
  const now = new Date().toISOString();
  return {
    searchString,
    rank,
    searchPageUrl,
    searchPageLoadedUrl: null,
    isAdvertisement: false,
    title: "",
    subTitle: null,
    description: null,
    price: null,
    categoryName: null,
    address: null,
    neighborhood: null,
    street: null,
    city: null,
    postalCode: null,
    state: null,
    countryCode: null,
    website: null,
    phone: null,
    phoneUnformatted: null,
    claimThisBusiness: null,
    location: { lat: null, lng: null },
    locatedIn: null,
    plusCode: null,
    menu: null,
    servicesLink: null,
    totalScore: null,
    permanentlyClosed: false,
    temporarilyClosed: false,
    placeId: "",
    categories: [],
    fid: null,
    cid: null,
    reviewsCount: null,
    reviewsDistribution: null,
    imagesCount: 0,
    imageCategories: [],
    scrapedAt: now,
    reserveTableUrl: null,
    googleFoodUrl: null,
    hotelStars: null,
    hotelDescription: null,
    checkInDate: null,
    checkOutDate: null,
    similarHotelsNearby: null,
    hotelReviewSummary: null,
    hotelAds: [],
    openingHours: [],
    additionalOpeningHours: {},
    peopleAlsoSearch: [],
    placesTags: [],
    reviewsTags: [],
    additionalInfo: {},
    gasPrices: [],
    questionsAndAnswers: [],
    updatesFromCustomers: null,
    ownerUpdates: [],
    url,
    imageUrl: null,
    kgmid: null,
    webResults: [],
    parentPlaceUrl: null,
    tableReservationLinks: [],
    bookingLinks: [],
    orderBy: [],
    images: [],
    imageUrls: [],
    reviews: [],
    userPlaceNote: null,
    restaurantData: {},
    isExternalServicePlace: false,
    externalServiceProvider: null,
    externalId: null,
  };
}

/* ── Extract all data from list view ── */
async function extractResultsFast(
  page: any,
  opts: MapsScrapeOptions,
  searchString: string,
  searchPageUrl: string
): Promise<MapsResult[]> {
  return page.evaluate(
    (options: MapsScrapeOptions, sString: string, sUrl: string) => {
      const results: MapsResult[] = [];
      const seen = new Set<string>();

      const feedItems = document.querySelectorAll('div[role="feed"] > div, div[role="feed"] > div > div');

      feedItems.forEach((item, index) => {
        const link = item.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement;
        if (!link) return;

        const url = link.href || "";
        if (!url || seen.has(url)) return;
        seen.add(url);

        const result = createEmptyResult(url, sString, sUrl, index + 1);

        // ── NAME (title) ──
        let title = link.getAttribute("aria-label") || "";
        if (!title) {
          const heading = item.querySelector('[role="heading"], h3, .fontHeadlineSmall, .qBF1Pd');
          title = heading ? (heading as HTMLElement).innerText.trim() : "";
        }
        if (!title) {
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
          const firstText = walker.nextNode();
          title = firstText ? firstText.textContent?.trim() || "" : "";
        }
        title = title.replace(/\s*\d+\.\d+\s*\(\d+[\d,]*\)\s*$/, "").trim();
        result.title = title;

        // ── PLACE ID ──
        const placeIdMatch = url.match(/\/maps\/place\/[^/]+\/([^/@]+)/);
        result.placeId = placeIdMatch ? placeIdMatch[1] : "";

        // ── CID from URL ──
        const cidMatch = url.match(/[!&]cid=(\d+)/);
        result.cid = cidMatch ? cidMatch[1] : null;

        // ── FID from URL ──
        const fidMatch = url.match(/[!&]fid=(\d+)/);
        result.fid = fidMatch ? fidMatch[1] : null;

        // ── LAT/LNG from URL ──
        const latMatch = url.match(/!3d(-?\d+\.\d+)!/);
        const lngMatch = url.match(/!4d(-?\d+\.\d+)!/);
        if (latMatch) result.location.lat = parseFloat(latMatch[1]);
        if (lngMatch) result.location.lng = parseFloat(lngMatch[1]);

        const textContent = (item as HTMLElement).innerText || "";
        const lines = textContent
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l.length < 200 && l !== title);

        // ── RATING & REVIEWS ──
        for (const line of lines) {
          const patterns = [
            /^(\d+\.\d+)\s*\((\d[\d,]*)\)/,
            /^(\d+\.\d+)\s*[·\-]\s*(\d[\d,]*)\s*reviews?/i,
            /^(\d+\.\d+)\s*★?\s*\(\s*(\d[\d,]*)\s*\)/,
            /^(\d+\.\d+)\s*out of 5/i,
          ];
          for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
              result.totalScore = parseFloat(match[1]);
              result.reviewsCount = match[2] ? parseInt(match[2].replace(/,/g, ""), 10) : null;
              break;
            }
          }
          if (result.totalScore !== null) break;
        }
        // Fallback star symbols
        if (result.totalScore === null) {
          for (const line of lines) {
            const starMatch = line.match(/([\d.]+)\s*(?:★|☆|⭐)/);
            if (starMatch) {
              result.totalScore = parseFloat(starMatch[1]);
              const reviewMatch = line.match(/(\d[\d,]*)/);
              if (reviewMatch) result.reviewsCount = parseInt(reviewMatch[1].replace(/,/g, ""), 10);
              break;
            }
          }
        }

        // ── CATEGORY & PRICE ──
        const categoryEl = item.querySelector('.UsdlK, .W4Efsd, .bXlT7b, .fontBodyMedium');
        if (categoryEl) {
          const catText = (categoryEl as HTMLElement).innerText.trim();
          const parts = catText.split("·").map((p) => p.trim());
          for (const part of parts) {
            if (part.length > 1 && part.length < 60 && !part.match(/^[\d.]+$/) && !part.includes("review")) {
              if (/^[\$\uFF04\uFE69]+$/.test(part)) {
                if (!result.price) result.price = part;
              } else if (!result.categoryName) {
                result.categoryName = part;
                result.categories.push(part);
              }
            }
          }
        }
        if (!result.categoryName) {
          for (const line of lines) {
            if (line.includes("·")) {
              const parts = line.split("·").map((p) => p.trim());
              for (const part of parts) {
                if (part.length > 1 && part.length < 60 && !part.match(/^[\d.]+$/) && !part.includes("review") && !part.includes("star")) {
                  if (/^[\$\uFF04\uFE69]+$/.test(part)) {
                    if (!result.price) result.price = part;
                  } else if (!result.categoryName) {
                    result.categoryName = part;
                    result.categories.push(part);
                    break;
                  }
                }
              }
            }
            if (result.categoryName) break;
          }
        }

        // ── ADDRESS ──
        const addressPatterns = [
          /^\d+\s+\w+.*(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Plaza|Plz|Suite|Ste|Unit|Floor|Fl)\.?/i,
          /\w+.*,\s*\w+.*\d{5}(-\d{4})?/,
          /\w+.*,\s*\w+.*\d{4,}/,
          /^[A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+,\s*[A-Za-z\s]+/,
        ];
        for (const line of lines) {
          if (line === title || (result.totalScore && line.includes(String(result.totalScore)) && line.includes("review"))) continue;
          for (const pattern of addressPatterns) {
            if (pattern.test(line) && line.length > 5 && line.length < 150) {
              result.address = line;
              break;
            }
          }
          if (result.address) break;
        }
        if (!result.address) {
          let foundRating = false;
          for (const line of lines) {
            if (result.totalScore && line.includes(String(result.totalScore)) && line.includes("review")) {
              foundRating = true;
              continue;
            }
            if (foundRating && line.length > 10 && line.length < 150 && line.includes(",")) {
              result.address = line;
              break;
            }
          }
        }
        if (!result.address) {
          for (const line of lines) {
            if (line.length > 10 && line.length < 150 && !line.includes(title) && !line.match(/^[\d.]+/) && !line.includes("review") && !line.includes("Open") && !line.includes("Closed") && line.includes(",")) {
              result.address = line;
              break;
            }
          }
        }

        // ── PHONE ──
        const phoneMatch = textContent.match(/(\+?\d{1,3}[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
        if (phoneMatch) {
          result.phone = phoneMatch[0];
          result.phoneUnformatted = phoneMatch[0].replace(/[^\d+]/g, "");
        }
        const intlMatch = textContent.match(/\+\d[\d\s\-\(\)]{7,20}/);
        if (intlMatch) {
          const intlPhone = intlMatch[0].trim();
          if (!result.phone) {
            result.phone = intlPhone;
            result.phoneUnformatted = intlPhone.replace(/[^\d+]/g, "");
          }
        }

        // ── WEBSITE ──
        const allLinks = item.querySelectorAll("a");
        for (const a of allLinks) {
          const href = (a as HTMLAnchorElement).href;
          if (href && !href.includes("google.com") && !href.includes("/maps/place/") && !href.startsWith("javascript:") && href.startsWith("http")) {
            result.website = href;
            break;
          }
        }

        // ── HOURS / OPEN STATUS ──
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (lower.includes("open now") || lower.includes("open 24") || lower.includes("opens 24")) {
            result.openingHours.push({ day: "Current", hours: "Open now" });
            break;
          } else if (lower.includes("closed") && !lower.includes("permanently")) {
            result.openingHours.push({ day: "Current", hours: line });
            break;
          } else if (lower.match(/opens?\s+\d/) || lower.match(/closes?\s+\d/) || lower.match(/open\s+\d/)) {
            result.openingHours.push({ day: "Current", hours: line });
            break;
          }
        }

        // ── PHOTO ──
        const img = item.querySelector("img") as HTMLImageElement;
        if (img && img.src && !img.src.includes("google.com") && img.src.startsWith("http")) {
          result.imageUrl = img.src;
          result.imagesCount = 1;
        }

        // ── BUSINESS STATUS ──
        if (textContent.includes("Permanently closed")) {
          result.permanentlyClosed = true;
        } else if (textContent.includes("Temporarily closed")) {
          result.temporarilyClosed = true;
        }

        // ── PLUS CODE ──
        const plusMatch = textContent.match(/([A-Z0-9]{4}\+[A-Z0-9]{2,4})/);
        if (plusMatch) result.plusCode = plusMatch[1];

        // ── DESCRIPTION ──
        const descEl = item.querySelector('.W4Efsd:last-child, .bXlT7b:last-child');
        if (descEl) {
          const descText = (descEl as HTMLElement).innerText.trim();
          if (descText.length > 20 && descText.length < 300 && !descText.includes(title)) {
            result.description = descText;
          }
        }

        // ── ADVERTISEMENT ──
        const adBadge = item.querySelector('[aria-label*="Ad"], [data-ad], .s6J3Kd');
        if (adBadge) result.isAdvertisement = true;

        // ── SUBTITLE ──
        const subEl = item.querySelector('.W4Efsd, .bXlT7b');
        if (subEl) {
          const subText = (subEl as HTMLElement).innerText.trim();
          if (subText && subText !== title && subText.length < 100) {
            result.subTitle = subText;
          }
        }

        // ── LOCATED IN ──
        for (const line of lines) {
          if (line.toLowerCase().includes("located in") || line.toLowerCase().includes("inside")) {
            result.locatedIn = line.replace(/located in/i, "").replace(/inside/i, "").trim();
            break;
          }
        }

        results.push(result);
      });

      return results;
    },
    opts,
    searchString,
    searchPageUrl
  );
}

/* ── Extract detail panel data ── */
async function extractDetailPanel(page: any): Promise<Partial<MapsResult>> {
  return page.evaluate(() => {
    const result: Partial<MapsResult> = {};
    const textContent = document.body.innerText || "";

    // Description
    const descSelectors = [
      '[data-section-id="description"]',
      '[aria-label*="About"]',
      '.m6QErb .fontBodyMedium',
      '.PYvSYb',
      '.kno-rdesc',
      '[data-section-id="details"]',
    ];
    for (const sel of descSelectors) {
      const descEl = document.querySelector(sel);
      if (descEl) {
        const text = (descEl as HTMLElement).innerText.trim();
        if (text.length > 10 && text.length < 600) {
          result.description = text;
          break;
        }
      }
    }

    // Hotel description
    const hotelDescSelectors = ['[data-section-id="hotel-description"]', '.PYvSYb', '.kno-rdesc'];
    for (const sel of hotelDescSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el as HTMLElement).innerText.trim();
        if (text.length > 20 && text.length < 600) {
          result.hotelDescription = text;
          break;
        }
      }
    }

    // Hotel stars
    const starMatch = textContent.match(/(\d(?:\.\d)?)\s*[-–]\s*star/i) || textContent.match(/(\d(?:\.\d)?)\s*★/);
    if (starMatch) result.hotelStars = starMatch[1];

    // Check-in / Check-out dates
    const checkInMatch = textContent.match(/Check[- ]?in[:\s]+([A-Za-z]+ \d{1,2})/i);
    const checkOutMatch = textContent.match(/Check[- ]?out[:\s]+([A-Za-z]+ \d{1,2})/i);
    if (checkInMatch) result.checkInDate = checkInMatch[1];
    if (checkOutMatch) result.checkOutDate = checkOutMatch[1];

    // Similar hotels nearby
    const similarHotels: MapsResult["similarHotelsNearby"] = [];
    const hotelCards = document.querySelectorAll('[data-section-id="similar-hotels"] div, .HcCDpe > div');
    hotelCards.forEach((card) => {
      const nameEl = card.querySelector('[role="heading"], h3, .fontHeadlineSmall');
      const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : "";
      if (!name) return;
      const ratingEl = card.querySelector('[role="img"][aria-label*="star"], .W4Efsd');
      let rating: number | null = null;
      if (ratingEl) {
        const rMatch = (ratingEl as HTMLElement).innerText.match(/([\d.]+)/);
        if (rMatch) rating = parseFloat(rMatch[1]);
      }
      const reviewsEl = card.querySelector('.W4Efsd, .fontBodySmall');
      let reviews: number | null = null;
      if (reviewsEl) {
        const revMatch = (reviewsEl as HTMLElement).innerText.match(/(\d[\d,]*)/);
        if (revMatch) reviews = parseInt(revMatch[1].replace(/,/g, ""), 10);
      }
      const priceEl = card.querySelector('.fontBodyMedium, .W4Efsd');
      const price = priceEl ? (priceEl as HTMLElement).innerText.match(/[\$\uFF04\uFE69]+[\d,]*/)?.[0] || null : null;
      similarHotels.push({ name, rating, reviews, description: null, price });
    });
    if (similarHotels.length > 0) result.similarHotelsNearby = similarHotels;

    // Hotel ads
    const hotelAds: MapsResult["hotelAds"] = [];
    const adEls = document.querySelectorAll('[data-section-id="hotel-ads"] a, [data-section-id="ads"] a');
    adEls.forEach((adEl) => {
      const a = adEl as HTMLAnchorElement;
      const title = (a as HTMLElement).innerText.trim();
      if (!title) return;
      hotelAds.push({
        title,
        googleUrl: a.href || null,
        isOfficialSite: title.toLowerCase().includes("official"),
        price: null,
        url: a.href || null,
      });
    });
    if (hotelAds.length > 0) result.hotelAds = hotelAds;

    // Hours - structured
    const hoursEntries: OpeningHoursEntry[] = [];
    const hoursRows = document.querySelectorAll('table tbody tr, [data-section-id="hours"] tr, .y0skZc tr');
    hoursRows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const day = (cells[0] as HTMLElement).innerText.trim();
        const hours = (cells[1] as HTMLElement).innerText.trim();
        if (day && hours && day.match(/mon|tue|wed|thu|fri|sat|sun/i)) {
          hoursEntries.push({ day, hours });
        }
      }
    });
    if (hoursEntries.length > 0) result.openingHours = hoursEntries;

    // Phone
    const phoneSelectors = [
      'button[data-item-id*="phone"]',
      'a[data-item-id*="phone"]',
      '[data-tooltip="Copy phone number"]',
    ];
    for (const sel of phoneSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el as HTMLElement).innerText.trim();
        if (text.match(/[\d\+\-\(\)\s]{7,}/)) {
          result.phone = text;
          result.phoneUnformatted = text.replace(/[^\d+]/g, "");
          break;
        }
      }
      if (result.phone) break;
    }

    // Website
    const webSelectors = [
      'a[data-item-id="authority"]',
      'a[data-tooltip="Open website"]',
      'a[href^="http"]:not([href*="google.com"]):not([href*="/maps/"])',
    ];
    for (const sel of webSelectors) {
      const webEl = document.querySelector(sel) as HTMLAnchorElement;
      if (webEl && webEl.href && !webEl.href.includes("google.com")) {
        result.website = webEl.href;
        break;
      }
    }

    // Price
    const priceMatch = textContent.match(/(\$+\s*(?:-\s*\$+)?)/);
    if (priceMatch && !result.price) {
      result.price = priceMatch[1].trim();
    }

    // Plus code
    const plusCodeMatch = textContent.match(/([A-Z0-9]{4}\+[A-Z0-9]{2,4})/);
    if (plusCodeMatch) result.plusCode = plusCodeMatch[1];

    // Amenities / Additional Info
    const additionalInfo: Record<string, Array<Record<string, boolean>>> = {};
    const amenitySections = document.querySelectorAll('[data-section-id="details"] > div, [data-section-id="features"] > div, .HcCDpe > div');
    amenitySections.forEach((section) => {
      const heading = section.querySelector("h2, h3, .fontHeadlineSmall, [role='heading']");
      const headingText = heading ? (heading as HTMLElement).innerText.trim() : "Details";
      const items = section.querySelectorAll(".fontBodyMedium, li, span");
      const sectionItems: Array<Record<string, boolean>> = [];
      items.forEach((el) => {
        const text = (el as HTMLElement).innerText.trim();
        if (text && text.length < 100 && text.length > 2 && !text.match(/^(Open|Closed|Opens|Closes)/i)) {
          sectionItems.push({ [text]: true });
        }
      });
      if (sectionItems.length > 0) {
        additionalInfo[headingText] = [...new Map(sectionItems.map((obj) => [Object.keys(obj)[0], obj])).values()];
      }
    });
    if (Object.keys(additionalInfo).length > 0) result.additionalInfo = additionalInfo;

    // Business status
    if (textContent.includes("Permanently closed")) {
      result.permanentlyClosed = true;
    } else if (textContent.includes("Temporarily closed")) {
      result.temporarilyClosed = true;
    }

    // Menu URL
    const menuSelectors = ['a[data-item-id="menu"]', 'a[data-tooltip*="Menu"]'];
    for (const sel of menuSelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement;
      if (el) { result.menu = el.href; break; }
    }

    // Reserve Table URL
    const resSelectors = ['a[data-item-id="reservation"]', 'a[data-tooltip*="Reserve"]'];
    for (const sel of resSelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement;
      if (el) { result.reserveTableUrl = el.href; break; }
    }

    // Services Link
    const servicesSelectors = ['a[data-item-id="services"]', 'a[data-tooltip*="Book"]'];
    for (const sel of servicesSelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement;
      if (el) { result.servicesLink = el.href; break; }
    }

    // Order URL / googleFoodUrl
    const orderSelectors = ['a[data-item-id="order"]', 'a[data-tooltip*="Order"]'];
    for (const sel of orderSelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement;
      if (el) { result.googleFoodUrl = el.href; break; }
    }

    // Table reservation links
    const tableReservationLinks: TableReservationLink[] = [];
    const tblResEls = document.querySelectorAll('a[data-item-id*="reservation"], a[data-tooltip*="Reserve"]');
    tblResEls.forEach((el) => {
      const a = el as HTMLAnchorElement;
      const name = (a as HTMLElement).innerText.trim() || "Reserve";
      if (a.href) tableReservationLinks.push({ name, url: a.href });
    });
    if (tableReservationLinks.length > 0) result.tableReservationLinks = tableReservationLinks;

    // Booking links
    const bookingLinks: TableReservationLink[] = [];
    const bookEls = document.querySelectorAll('a[data-item-id*="booking"], a[data-tooltip*="Book"]');
    bookEls.forEach((el) => {
      const a = el as HTMLAnchorElement;
      const name = (a as HTMLElement).innerText.trim() || "Book";
      if (a.href) bookingLinks.push({ name, url: a.href });
    });
    if (bookingLinks.length > 0) result.bookingLinks = bookingLinks;

    // Order by
    const orderBy: OrderByItem[] = [];
    const orderEls = document.querySelectorAll('a[data-item-id*="order"], a[data-tooltip*="Order"]');
    orderEls.forEach((el) => {
      const a = el as HTMLAnchorElement;
      const name = (a as HTMLElement).innerText.trim() || "Order";
      if (a.href) orderBy.push({ name, orderUrl: a.href });
    });
    if (orderBy.length > 0) result.orderBy = orderBy;

    // Better photo
    const photoSelectors = [
      '.aoRNLd img', '.RZ66Rb img', '.K7oBsc img', '.ZKCDEc img',
      'img[src*="googleusercontent"]', 'img[src*="gstatic.com"]',
    ];
    for (const sel of photoSelectors) {
      const photoEl = document.querySelector(sel) as HTMLImageElement;
      if (photoEl && photoEl.src && photoEl.src.startsWith("http")) {
        result.imageUrl = photoEl.src;
        break;
      }
    }

    // Image count
    const allImages = document.querySelectorAll('img[src*="googleusercontent"], img[src*="gstatic.com"]');
    result.imagesCount = allImages.length;

    // Image URLs
    const imageUrls: string[] = [];
    allImages.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      if (src && src.startsWith("http") && !imageUrls.includes(src)) {
        imageUrls.push(src);
      }
    });
    if (imageUrls.length > 0) result.imageUrls = imageUrls;

    // Images (ImageItem)
    const images: ImageItem[] = [];
    const imgContainers = document.querySelectorAll('.aoRNLd, .RZ66Rb, .K7oBsc, .ZKCDEc');
    imgContainers.forEach((container) => {
      const imgEl = container.querySelector("img") as HTMLImageElement;
      if (!imgEl || !imgEl.src) return;
      const authorEl = container.querySelector("a, span, .fontBodySmall");
      const authorName = authorEl ? (authorEl as HTMLElement).innerText.trim() || null : null;
      const authorUrl = authorEl && authorEl.tagName === "A" ? (authorEl as HTMLAnchorElement).href || null : null;
      images.push({
        imageUrl: imgEl.src,
        authorName,
        authorUrl,
        uploadedAt: null,
      });
    });
    if (images.length > 0) result.images = images;

    // Address from detail panel (more accurate)
    const addrSelectors = [
      'button[data-item-id*="address"]',
      '[data-tooltip="Copy address"]',
      '.bXlT7b:first-child',
    ];
    for (const sel of addrSelectors) {
      const addrEl = document.querySelector(sel);
      if (addrEl) {
        const addrText = (addrEl as HTMLElement).innerText.trim();
        if (addrText.length > 10 && addrText.length < 200 && addrText.includes(",")) {
          result.address = addrText;
          break;
        }
      }
    }

    // Claim this business
    const claimEl = document.querySelector('[aria-label*="Claim"], [data-item-id="claim"], button:has-text("Claim")');
    if (claimEl) result.claimThisBusiness = true;

    // Reviews distribution
    const reviewDist: ReviewDistribution = { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 };
    const reviewBars = document.querySelectorAll('[role="img"][aria-label*="star"], .w7DbAd');
    reviewBars.forEach((bar, idx) => {
      const label = bar.getAttribute("aria-label") || "";
      const countMatch = label.match(/(\d+)\s*reviews?/i);
      const count = countMatch ? parseInt(countMatch[1], 10) : 0;
      // idx 0 usually means 5 stars, idx 4 means 1 star depending on DOM order
      const stars = 5 - idx;
      if (stars === 5) reviewDist.fiveStar = count;
      else if (stars === 4) reviewDist.fourStar = count;
      else if (stars === 3) reviewDist.threeStar = count;
      else if (stars === 2) reviewDist.twoStar = count;
      else if (stars === 1) reviewDist.oneStar = count;
    });
    if (reviewDist.oneStar || reviewDist.twoStar || reviewDist.threeStar || reviewDist.fourStar || reviewDist.fiveStar) {
      result.reviewsDistribution = reviewDist;
    }

    // Reviews tags
    const reviewsTags: ReviewsTag[] = [];
    const tagEls = document.querySelectorAll('[data-section-id="reviews"] .fontBodyMedium, .HcCDpe .fontBodyMedium');
    tagEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      const match = text.match(/(.+)\s*\((\d+)\)/);
      if (match) {
        reviewsTags.push({ title: match[1].trim(), count: parseInt(match[2], 10) });
      }
    });
    if (reviewsTags.length > 0) result.reviewsTags = reviewsTags;

    // Places tags
    const placesTags: string[] = [];
    const placeTagEls = document.querySelectorAll('[data-section-id="attributes"] span, [data-section-id="features"] span');
    placeTagEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text && text.length < 50 && !placesTags.includes(text)) {
        placesTags.push(text);
      }
    });
    if (placesTags.length > 0) result.placesTags = placesTags;

    // Image categories
    const imageCategories: string[] = [];
    const imgCatEls = document.querySelectorAll('[data-section-id="photos"] button, [data-section-id="photos"] span');
    imgCatEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text && text.length < 40 && !imageCategories.includes(text)) {
        imageCategories.push(text);
      }
    });
    if (imageCategories.length > 0) result.imageCategories = imageCategories;

    // Gas prices
    const gasPrices: string[] = [];
    const gasEls = document.querySelectorAll('[data-section-id="gas-prices"] span, .fontBodyMedium');
    gasEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text.match(/\$\d+\.\d+/) && !gasPrices.includes(text)) {
        gasPrices.push(text);
      }
    });
    if (gasPrices.length > 0) result.gasPrices = gasPrices;

    // Questions and Answers
    const qaEls = document.querySelectorAll('[data-section-id="qa"] .fontBodyMedium, .HcCDpe div');
    const questionsAndAnswers: Array<{ question: string; answer: string }> = [];
    let currentQ = "";
    qaEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text.endsWith("?")) {
        currentQ = text;
      } else if (currentQ && text.length > 5) {
        questionsAndAnswers.push({ question: currentQ, answer: text });
        currentQ = "";
      }
    });
    if (questionsAndAnswers.length > 0) result.questionsAndAnswers = questionsAndAnswers;

    // Owner updates
    const ownerUpdates: string[] = [];
    const updateEls = document.querySelectorAll('[data-section-id="updates"] .fontBodyMedium, [data-section-id="owner-updates"] .fontBodyMedium');
    updateEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text && text.length > 10 && !ownerUpdates.includes(text)) {
        ownerUpdates.push(text);
      }
    });
    if (ownerUpdates.length > 0) result.ownerUpdates = ownerUpdates;

    // Updates from customers
    const customerUpdateEl = document.querySelector('[data-section-id="customer-updates"] .fontBodyMedium');
    if (customerUpdateEl) {
      result.updatesFromCustomers = (customerUpdateEl as HTMLElement).innerText.trim();
    }

    // People also search
    const peopleAlsoSearch: PeopleAlsoSearch[] = [];
    const alsoSearchEls = document.querySelectorAll('.HcCDpe a, [data-section-id="related"] a, [data-section-id="people-also-search"] a');
    alsoSearchEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text && text.length < 80) {
        const parent = el.parentElement;
        let category = "";
        if (parent) {
          const catEl = parent.querySelector('.fontBodySmall, .W4Efsd');
          category = catEl ? (catEl as HTMLElement).innerText.trim() : "";
        }
        peopleAlsoSearch.push({ category, title: text, reviewsCount: null, totalScore: null });
      }
    });
    if (peopleAlsoSearch.length > 0) result.peopleAlsoSearch = peopleAlsoSearch;

    // Web results
    const webResults: string[] = [];
    const webResultEls = document.querySelectorAll('[data-section-id="web-results"] a, [data-section-id="web"] a');
    webResultEls.forEach((el) => {
      const text = (el as HTMLElement).innerText.trim();
      if (text && !webResults.includes(text)) webResults.push(text);
    });
    if (webResults.length > 0) result.webResults = webResults;

    // Parent place URL
    const parentEl = document.querySelector('a[href*="/maps/place/"][data-item-id*="located-in"]') as HTMLAnchorElement;
    if (parentEl) result.parentPlaceUrl = parentEl.href;

    // Reviews extraction
    const reviews: ReviewItem[] = [];
    const reviewEls = document.querySelectorAll('[data-section-id="reviews"] > div, .jftiEf');
    reviewEls.forEach((revEl) => {
      const nameEl = revEl.querySelector('.d4r55, .fontBodyMedium');
      const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : "";
      const textEl = revEl.querySelector('.wiI7pd, .fontBodyMedium');
      const text = textEl ? (textEl as HTMLElement).innerText.trim() || null : null;
      const dateEl = revEl.querySelector('.rsqaWe, .fontBodySmall');
      const publishAt = dateEl ? (dateEl as HTMLElement).innerText.trim() : "";
      const likesEl = revEl.querySelector('[aria-label*="like"], .fontBodySmall');
      let likesCount = 0;
      if (likesEl) {
        const lMatch = (likesEl as HTMLElement).innerText.match(/(\d+)/);
        if (lMatch) likesCount = parseInt(lMatch[1], 10);
      }
      const starsEl = revEl.querySelector('[role="img"][aria-label*="star"]');
      let stars = 0;
      if (starsEl) {
        const sMatch = starsEl.getAttribute("aria-label")?.match(/([\d.]+)/);
        if (sMatch) stars = parseFloat(sMatch[1]);
      }
      const reviewUrlEl = revEl.querySelector("a") as HTMLAnchorElement;
      const reviewUrl = reviewUrlEl ? reviewUrlEl.href : null;
      const reviewerPhotoEl = revEl.querySelector("img") as HTMLImageElement;
      const reviewerPhotoUrl = reviewerPhotoEl ? reviewerPhotoEl.src : null;
      const isLocalGuide = revEl.innerHTML.toLowerCase().includes("local guide");

      reviews.push({
        name,
        text,
        textTranslated: null,
        publishAt,
        publishedAtDate: null,
        likesCount,
        reviewId: "",
        reviewUrl,
        reviewerId: null,
        reviewerUrl: null,
        reviewerPhotoUrl,
        reviewerNumberOfReviews: null,
        isLocalGuide,
        reviewOrigin: "google",
        stars,
        rating: null,
        responseFromOwnerDate: null,
        responseFromOwnerText: null,
        reviewImageUrls: [],
        reviewContext: {},
        reviewDetailedRating: null,
      });
    });
    if (reviews.length > 0) result.reviews = reviews;

    // Restaurant data
    const restaurantData: Record<string, any> = {};
    const menuEl = document.querySelector('a[data-item-id="menu"]');
    if (menuEl) restaurantData.menuUrl = (menuEl as HTMLAnchorElement).href;
    const resEl = document.querySelector('a[data-item-id="reservation"]');
    if (resEl) restaurantData.reservationUrl = (resEl as HTMLAnchorElement).href;
    const orderEl = document.querySelector('a[data-item-id="order"]');
    if (orderEl) restaurantData.orderUrl = (orderEl as HTMLAnchorElement).href;
    if (Object.keys(restaurantData).length > 0) result.restaurantData = restaurantData;

    return result;
  });
}

/* ── Main scraper ── */
export async function* scrapeGoogleMaps(
  searchQueryOrUrl: string,
  options: MapsScrapeOptions = {}
): AsyncGenerator<MapsProgress> {
  const {
    maxCrawledPlacesPerSearch = 100,
    scrapePlaceDetailPage = true,
    placeMinimumStars = 0,
    website = "allPlaces",
    skipClosedPlaces = false,
    searchStringsArray,
    language = "en",
  } = options;

  const browser = await getBrowser({ host: "", port: "" });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Google Chrome";v="125"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  });

  const allResults: MapsResult[] = [];
  const seenUrls = new Set<string>();

  try {
    yield {
      type: "progress",
      current: 0,
      total: maxCrawledPlacesPerSearch,
      page: 0,
      message: "Loading Google Maps...",
    };

    let url = searchQueryOrUrl;
    if (!url.startsWith("http")) {
      url = `https://www.google.com/maps/search/${encodeURIComponent(searchQueryOrUrl)}`;
    }

    await withRetry(
      () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }),
      3,
      1500
    );

    // Accept cookies
    try {
      const acceptBtn = await page.waitForSelector('form[action*="consent"] button', { timeout: 4000 });
      if (acceptBtn) {
        await acceptBtn.click();
        await sleep(1500);
      }
    } catch {}

    yield {
      type: "progress",
      current: 0,
      total: maxCrawledPlacesPerSearch,
      page: 0,
      message: "Waiting for results to load...",
    };

    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
    } catch {
      yield {
        type: "error",
        current: 0,
        total: maxCrawledPlacesPerSearch,
        page: 0,
        message: "Could not find search results. Try a different query or URL.",
      };
      return;
    }

    await sleep(2000);

    let previousHeight = 0;
    let scrollAttempts = 0;
    let pageNum = 0;

    while (allResults.length < maxCrawledPlacesPerSearch) {
      pageNum++;

      yield {
        type: "progress",
        current: allResults.length,
        total: maxCrawledPlacesPerSearch,
        page: pageNum,
        message: `Scrolling page ${pageNum}...`,
      };

      const currentUrl = page.url();
      const pageRows = await extractResultsFast(page, options, searchQueryOrUrl, currentUrl);

      let added = 0;
      for (const row of pageRows) {
        if (!row.url || seenUrls.has(row.url) || !row.title) continue;

        // Apply filters
        if (placeMinimumStars > 0 && row.totalScore !== null && row.totalScore < placeMinimumStars) continue;
        if (skipClosedPlaces && (row.permanentlyClosed || row.temporarilyClosed)) continue;
        if (website === "withWebsite" && !row.website) continue;
        if (website === "withoutWebsite" && row.website) continue;

        seenUrls.add(row.url);

        // Parse address components
        const addrComponents = parseAddressComponents(row.address || "");
        row.street = addrComponents.street;
        row.city = addrComponents.city;
        row.state = addrComponents.state;
        row.postalCode = addrComponents.postalCode;
        row.countryCode = addrComponents.countryCode;
        row.neighborhood = addrComponents.neighborhood;

        // Scrape details (default true)
        if (scrapePlaceDetailPage && row.placeId) {
          try {
            const linkHandle = await page.$(`a[href*="${row.placeId}"]`);
            if (linkHandle) {
              await linkHandle.click();
              await sleep(1500 + Math.random() * 500);

              const details = await extractDetailPanel(page);
              Object.assign(row, details);

              // Re-parse address if detail panel gave us a better one
              if (details.address && details.address !== row.address) {
                const newAddr = parseAddressComponents(details.address);
                row.street = newAddr.street;
                row.city = newAddr.city;
                row.state = newAddr.state;
                row.postalCode = newAddr.postalCode;
                row.countryCode = newAddr.countryCode;
                row.neighborhood = newAddr.neighborhood;
              }

              // Go back
              const backSelectors = [
                'button[aria-label*="Back"]', 'button[aria-label*="back"]',
                '.VfPpkd-icon-LgbsSe', '[data-tooltip="Back"]',
              ];
              let wentBack = false;
              for (const sel of backSelectors) {
                const backBtn = await page.$(sel);
                if (backBtn) { await backBtn.click(); wentBack = true; break; }
              }
              await sleep(wentBack ? 800 : 400);
            }
          } catch (detailErr) {
            // Continue without details
          }
        }

        allResults.push(row);
        added++;
        if (allResults.length >= maxCrawledPlacesPerSearch) break;
      }

      if (added > 0) {
        yield {
          type: "page_done",
          current: allResults.length,
          total: maxCrawledPlacesPerSearch,
          page: pageNum,
          message: `Found ${allResults.length} locations...`,
          data: allResults.slice(allResults.length - added),
        };
      }

      if (allResults.length >= maxCrawledPlacesPerSearch) break;

      const hasMore = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) return false;
        feed.scrollTop = feed.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        const endTexts = [
          "You've reached the end of the list", "No more results",
          "No more places", "Looks like you've reached the end", "End of list",
        ];
        const spans = document.querySelectorAll("span, div");
        for (const span of spans) {
          const text = (span as HTMLElement).innerText || "";
          for (const endText of endTexts) {
            if (text.includes(endText)) return false;
          }
        }
        return true;
      });

      if (!hasMore) {
        yield { type: "progress", current: allResults.length, total: maxCrawledPlacesPerSearch, page: pageNum, message: "Reached end of list." };
        break;
      }

      await sleep(1200 + Math.random() * 800);

      const currentHeight = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        return feed ? feed.scrollHeight : document.body.scrollHeight;
      });

      if (currentHeight === previousHeight) {
        scrollAttempts++;
        if (scrollAttempts > 3) {
          yield { type: "progress", current: allResults.length, total: maxCrawledPlacesPerSearch, page: pageNum, message: "No more items loading." };
          break;
        }
      } else {
        scrollAttempts = 0;
      }
      previousHeight = currentHeight;
    }

    yield {
      type: "done",
      current: allResults.length,
      total: maxCrawledPlacesPerSearch,
      page: pageNum,
      message: `Done! Scraped ${allResults.length} map results.`,
    };
  } catch (err: unknown) {
    yield {
      type: "error",
      current: allResults.length,
      total: maxCrawledPlacesPerSearch,
      page: 0,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    await page.close();
    try { await browser.close(); } catch {}
  }
}
