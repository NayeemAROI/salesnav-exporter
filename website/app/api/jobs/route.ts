import { NextRequest } from "next/server";
import { MapsScrapeOptions } from "@/lib/maps-scraper";
import {
  ApiInputError, apiError, assertBodySize, boundedNumber, boundedStrings,
  googleMapsUrl, linkedinUrl, sanitizeLinkedInCookies, serverProxy,
} from "@/lib/api-security";
import { CompanyJobParams, MapsJobParams, ProfileJobParams, SearchJobParams, submitJob } from "@/lib/job-runner";
import { JobType, listJobs } from "@/lib/job-store";

export const dynamic = "force-dynamic";

const LANGUAGES = new Set(["en", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "zh-CN", "ar", "hi", "bn"]);
const JOB_TYPES = new Set<JobType>(["search", "profile", "company", "maps"]);

export async function GET() {
  const jobs = listJobs().map((job) => ({
    id: job.id, type: job.type, status: job.status, progress: job.progress, message: job.message,
    resultCount: job.results.length, error: job.error,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
  }));
  return Response.json({ jobs });
}

export async function POST(req: NextRequest) {
  try {
    assertBodySize(req);
    const body = await req.json();
    const type = body.type;
    if (!JOB_TYPES.has(type)) throw new ApiInputError("Invalid job type");

    if (type === "search") {
      const searchUrl = linkedinUrl(body.searchUrl, "sales");
      const cookies = sanitizeLinkedInCookies(body.cookies);
      const maxResults = boundedNumber(body.maxResults, 100, 1, 500);
      const mode = new URL(searchUrl).pathname.includes("company") ? "companies" : "leads";
      const params: SearchJobParams = { searchUrl, cookies, maxResults, mode, proxy: serverProxy(body.proxyCountry) };
      const job = submitJob("search", params);
      return Response.json({ jobId: job.id });
    }

    if (type === "profile") {
      if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 50) throw new ApiInputError("Provide between 1 and 50 profile URLs");
      const urls: string[] = [...new Set((body.urls as unknown[]).map((url): string => linkedinUrl(url, "profile")))];
      const cookies = sanitizeLinkedInCookies(body.cookies);
      const minConnections = boundedNumber(body.minConnections, 0, 0, 100_000_000);
      const minActivityMonths = boundedNumber(body.minActivityMonths, 3, 1, 120);
      const params: ProfileJobParams = { urls, cookies, minConnections, minActivityMonths, proxy: serverProxy(body.proxyCountry) };
      const job = submitJob("profile", params);
      return Response.json({ jobId: job.id });
    }

    if (type === "company") {
      if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 50) throw new ApiInputError("Provide between 1 and 50 company URLs");
      const urls: string[] = [...new Set((body.urls as unknown[]).map((url): string => linkedinUrl(url, "company")))];
      const cookies = sanitizeLinkedInCookies(body.cookies);
      const params: CompanyJobParams = { urls, cookies, proxy: serverProxy(body.proxyCountry) };
      const job = submitJob("company", params);
      return Response.json({ jobId: job.id });
    }

    // type === "maps"
    const queries: string[] = [];
    const startUrls = boundedStrings(body.startUrls, "startUrls", 20, 2_000).map(googleMapsUrl);
    queries.push(...startUrls);

    for (const placeId of boundedStrings(body.placeIds, "placeIds", 20, 200)) {
      if (!/^[\w:+-]+$/.test(placeId)) throw new ApiInputError("Invalid place ID");
      queries.push(`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`);
    }

    const strings = body.searchStringsArray?.length ? boundedStrings(body.searchStringsArray, "searchStringsArray", 20) : boundedStrings(body.batchQueries, "batchQueries", 20);
    const location = typeof body.locationQuery === "string" ? body.locationQuery.trim().slice(0, 200) : "";
    for (const value of strings) queries.push(`https://www.google.com/maps/search/${encodeURIComponent(location ? `${value} ${location}` : value)}`);

    if (!queries.length && body.searchQueryOrUrl) {
      const value = String(body.searchQueryOrUrl).trim();
      queries.push(/^https:/i.test(value) ? googleMapsUrl(value) : `https://www.google.com/maps/search/${encodeURIComponent(location ? `${value} ${location}` : value)}`);
    }
    if (!queries.length) throw new ApiInputError("No Maps query provided");

    const maxResults = boundedNumber(body.maxCrawledPlacesPerSearch ?? body.maxResults, 100, 1, 500);
    const language = LANGUAGES.has(body.language) ? body.language : "en";
    const options: MapsScrapeOptions = {
      maxCrawledPlacesPerSearch: maxResults,
      language,
      categoryFilterWords: boundedStrings(body.categoryFilterWords, "categoryFilterWords", 20, 80),
      placeMinimumStars: Math.min(5, Math.max(0, Number(body.placeMinimumStars ?? body.minRating) || 0)) || undefined,
      website: new Set(["allPlaces", "withWebsite", "withoutWebsite"]).has(body.website) ? body.website : "allPlaces",
      skipClosedPlaces: body.skipClosedPlaces === true,
      scrapePlaceDetailPage: body.scrapePlaceDetailPage === true || body.scrapeDetails === true,
      maxReviews: boundedNumber(body.maxReviews, 0, 0, 100),
      maxImages: boundedNumber(body.maxImages, 0, 0, 100),
    };
    const params: MapsJobParams = { queries, maxResults, options };
    const job = submitJob("maps", params);
    return Response.json({ jobId: job.id });
  } catch (error) {
    return apiError(error);
  }
}
