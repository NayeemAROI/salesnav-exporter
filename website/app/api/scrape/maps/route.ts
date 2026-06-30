import { NextRequest } from "next/server";
import { scrapeGoogleMaps, MapsScrapeOptions } from "@/lib/maps-scraper";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      searchStringsArray,
      searchQueryOrUrl,
      locationQuery,
      maxCrawledPlacesPerSearch,
      language,
      categoryFilterWords,
      searchMatching,
      placeMinimumStars,
      website,
      skipClosedPlaces,
      scrapePlaceDetailPage,
      maxReviews,
      reviewsSort,
      maxImages,
      countryCode,
      city,
      state,
      postalCode,
      startUrls,
      placeIds,
      maxResults,
      scrapeDetails,
      minRating,
      priceLevel,
      openNow,
      batchQueries,
    } = body as {
      searchStringsArray?: string[];
      searchQueryOrUrl?: string;
      locationQuery?: string;
      maxCrawledPlacesPerSearch?: number;
      language?: string;
      categoryFilterWords?: string[];
      searchMatching?: string;
      placeMinimumStars?: number;
      website?: string;
      skipClosedPlaces?: boolean;
      scrapePlaceDetailPage?: boolean;
      maxReviews?: number;
      reviewsSort?: string;
      maxImages?: number;
      countryCode?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      startUrls?: string[];
      placeIds?: string[];
      maxResults?: number;
      scrapeDetails?: boolean;
      minRating?: number;
      priceLevel?: string;
      openNow?: boolean;
      batchQueries?: string[];
    };

    const queries: string[] = [];

    if (startUrls?.length) {
      queries.push(...startUrls.filter((u: string) => u.trim()));
    }

    if (placeIds?.length) {
      for (const placeId of placeIds) {
        queries.push(
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
        );
      }
    }

    const searchStrings = searchStringsArray?.length
      ? searchStringsArray
      : batchQueries?.length
        ? batchQueries
        : [];

    if (searchStrings.length) {
      for (const str of searchStrings.filter((q: string) => q.trim())) {
        const query = locationQuery ? `${str} ${locationQuery}` : str;
        queries.push(
          `https://www.google.com/maps/search/${encodeURIComponent(query)}`
        );
      }
    } else if (searchQueryOrUrl) {
      if (searchQueryOrUrl.startsWith("http")) {
        queries.push(searchQueryOrUrl);
      } else {
        const query = locationQuery
          ? `${searchQueryOrUrl} ${locationQuery}`
          : searchQueryOrUrl;
        queries.push(
          `https://www.google.com/maps/search/${encodeURIComponent(query)}`
        );
      }
    }

    if (queries.length === 0) {
      return Response.json(
        { error: "No search query, URL, startUrls, placeIds, or search strings provided" },
        { status: 400 }
      );
    }

    const cappedMax = Math.min(maxCrawledPlacesPerSearch ?? maxResults ?? 100, 500);

    const options: MapsScrapeOptions = {
      maxCrawledPlacesPerSearch: cappedMax,
      language,
      categoryFilterWords,
      searchMatching: searchMatching as "all" | "only_includes" | "only_exact" | undefined,
      placeMinimumStars: placeMinimumStars ?? minRating,
      website: website as "allPlaces" | "withWebsite" | "withoutWebsite" | undefined,
      skipClosedPlaces: skipClosedPlaces ?? false,
      scrapePlaceDetailPage: scrapePlaceDetailPage ?? scrapeDetails,
      maxReviews,
      reviewsSort: reviewsSort as "newest" | "mostRelevant" | "highestRanking" | "lowestRanking" | undefined,
      maxImages,
      countryCode,
      city,
      state,
      postalCode,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let totalScraped = 0;
          let queryIndex = 0;

          for (const query of queries) {
            queryIndex++;
            if (queries.length > 1) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "progress",
                    current: totalScraped,
                    total: cappedMax * queries.length,
                    page: queryIndex,
                    message: `Query ${queryIndex}/${queries.length}: ${query}`,
                  })}\n\n`
                )
              );
            }

            for await (const progress of scrapeGoogleMaps(query, options)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(progress)}\n\n`)
              );
              if (progress.type === "page_done" && progress.data) {
                totalScraped += progress.data.length;
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
