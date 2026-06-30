import { NextRequest } from "next/server";
import { scanProfiles } from "@/lib/profile-scanner";
import { LinkedInCookie, ProxyConfig } from "@/lib/linkedin-scraper";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, cookies, minConnections = 0, minActivityMonths = 3, proxy, proxyCountry } = body as {
      urls: string[];
      cookies: LinkedInCookie[];
      minConnections?: number;
      minActivityMonths?: number;
      proxy?: ProxyConfig;
      proxyCountry?: string;
    };

    if (!urls || urls.length === 0) {
      return Response.json({ error: "No URLs provided" }, { status: 400 });
    }
    if (!cookies?.some((c: LinkedInCookie) => c.name === "li_at")) {
      return Response.json({ error: "Missing li_at cookie" }, { status: 400 });
    }

    const validUrls = urls.map((u: string) => u.trim()).filter((u: string) => u.includes("linkedin.com/in/"));
    if (validUrls.length === 0) {
      return Response.json({ error: "No valid LinkedIn profile URLs" }, { status: 400 });
    }

    const cappedUrls = validUrls.slice(0, 100);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Add country code if provided to the proxy config
          const finalProxy = proxy || (proxyCountry ? { host: "", port: "", countryCode: proxyCountry } : undefined);

          for await (const progress of scanProfiles(cappedUrls, cookies, { minConnections, minActivityMonths, proxy: finalProxy })) {
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
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
