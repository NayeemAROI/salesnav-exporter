import { NextRequest } from "next/server";
import { scanProfiles } from "@/lib/profile-scanner";
import { acquireScrapeJob, ApiInputError, apiError, assertBodySize, boundedNumber, linkedinUrl, safeError, sanitizeLinkedInCookies, serverProxy, sseHeaders } from "@/lib/api-security";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let release: (() => void) | undefined;
  try {
    assertBodySize(req);
    const body = await req.json();
    if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 50) throw new ApiInputError("Provide between 1 and 50 profile URLs");
    const urls = [...new Set(body.urls.map((url: unknown) => linkedinUrl(url, "profile")))];
    const cookies = sanitizeLinkedInCookies(body.cookies);
    const minConnections = boundedNumber(body.minConnections, 0, 0, 100_000_000);
    const minActivityMonths = boundedNumber(body.minActivityMonths, 3, 1, 120);
    const proxy = serverProxy(body.proxyCountry);
    release = acquireScrapeJob();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const progress of scanProfiles(urls, cookies, { minConnections, minActivityMonths, proxy })) {
            if (req.signal.aborted) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", current: 0, total: urls.length, message: safeError(error) })}\n\n`));
        } finally { release?.(); try { controller.close(); } catch {} }
      },
      cancel() { release?.(); },
    });
    return new Response(stream, { headers: sseHeaders() });
  } catch (error) { release?.(); return apiError(error); }
}
