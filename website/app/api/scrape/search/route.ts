import { NextRequest } from "next/server";
import { scrapeSalesNavSearch } from "@/lib/salesnav-scraper";
import { acquireScrapeJob, apiError, assertBodySize, boundedNumber, linkedinUrl, safeError, sanitizeLinkedInCookies, serverProxy, sseHeaders } from "@/lib/api-security";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let release: (() => void) | undefined;
  try {
    assertBodySize(req);
    const body = await req.json();
    const searchUrl = linkedinUrl(body.searchUrl, "sales");
    const cookies = sanitizeLinkedInCookies(body.cookies);
    const maxResults = boundedNumber(body.maxResults, 100, 1, 500);
    const actualMode = new URL(searchUrl).pathname.includes("company") ? "companies" : "leads";
    const proxy = serverProxy(body.proxyCountry);
    release = acquireScrapeJob();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const progress of scrapeSalesNavSearch(searchUrl, cookies, maxResults, actualMode, proxy)) {
            if (req.signal.aborted) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", current: 0, total: maxResults, page: 0, message: safeError(error) })}\n\n`));
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
