import { NextRequest } from "next/server";
import { scrapeSalesNavSearch, LeadResult, CompanyResult } from "@/lib/salesnav-scraper";
import { LinkedInCookie, ProxyConfig } from "@/lib/linkedin-scraper";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { searchUrl, cookies, maxResults = 100, mode = "leads", proxy, proxyCountry } = body as {
      searchUrl: string;
      cookies: LinkedInCookie[];
      maxResults: number;
      mode: "leads" | "companies";
      proxy?: ProxyConfig;
      proxyCountry?: string;
    };

    if (!searchUrl) {
      return Response.json({ error: "No search URL provided" }, { status: 400 });
    }
    if (!cookies?.some((c: LinkedInCookie) => c.name === "li_at")) {
      return Response.json({ error: "Missing li_at cookie" }, { status: 400 });
    }

    // Validate URL
    const isLeadSearch = searchUrl.includes("/sales/search/people") || searchUrl.includes("/sales/lists/people");
    const isCompanySearch = searchUrl.includes("/sales/search/company") || searchUrl.includes("/sales/lists/company");
    if (!isLeadSearch && !isCompanySearch) {
      return Response.json(
        { error: "URL must be a Sales Navigator search or list URL (/sales/search/people or /sales/search/company)" },
        { status: 400 }
      );
    }

    const actualMode = isCompanySearch ? "companies" : "leads";
    const cappedMax = Math.min(maxResults, 500);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Add country code if provided to the proxy config
          const finalProxy = proxy || (proxyCountry ? { host: "", port: "", countryCode: proxyCountry } : undefined);

          for await (const progress of scrapeSalesNavSearch(searchUrl, cookies, cappedMax, actualMode, finalProxy)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
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
