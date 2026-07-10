import { NextRequest } from "next/server";
import { scrapeGoogleMaps, MapsScrapeOptions } from "@/lib/maps-scraper";
import { acquireScrapeJob, ApiInputError, apiError, assertBodySize, boundedNumber, boundedStrings, googleMapsUrl, safeError, sseHeaders } from "@/lib/api-security";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const LANGUAGES = new Set(["en", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "zh-CN", "ar", "hi", "bn"]);

export async function POST(req: NextRequest) {
  let release: (() => void) | undefined;
  try {
    assertBodySize(req);
    const body = await req.json();
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
    release = acquireScrapeJob();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let totalScraped = 0;
          for (let index = 0; index < queries.length; index++) {
            if (req.signal.aborted) break;
            const query = queries[index];
            for await (const progress of scrapeGoogleMaps(query, options)) {
              if (req.signal.aborted) break;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
              if (progress.type === "page_done" && progress.data) totalScraped += progress.data.length;
            }
            if (totalScraped >= maxResults * queries.length) break;
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", current: 0, total: maxResults * queries.length, page: 0, message: safeError(error) })}\n\n`));
        } finally {
          release?.();
          try { controller.close(); } catch {}
        }
      },
      cancel() { release?.(); },
    });
    return new Response(stream, { headers: sseHeaders() });
  } catch (error) {
    release?.();
    return apiError(error);
  }
}
