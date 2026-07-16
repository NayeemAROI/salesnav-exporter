import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { scrapeMaps } from "./scraper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "public")));

// Single-flight guard: this box runs one Chromium at a time.
let busy = false;

app.post("/api/scrape", async (req, res) => {
  if (busy) return res.status(429).json({ error: "A scrape is already running. Try again shortly." });
  const body = req.body || {};
  const searches = Array.isArray(body.searches) ? body.searches : [body.query];
  const options = {
    searches,
    location: typeof body.location === "string" ? body.location.slice(0, 200) : "",
    limit: body.limit,
    minStars: Number(body.minStars) || 0,
    website: ["allPlaces", "withWebsite", "withoutWebsite"].includes(body.website) ? body.website : "allPlaces",
    skipClosed: body.skipClosed === true,
    details: body.details !== false,
    language: /^[a-z-]{2,5}$/i.test(body.language || "") ? body.language : "en",
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  busy = true;
  try {
    await scrapeMaps(options, send);
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Scrape failed" });
  } finally {
    busy = false;
    res.end();
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, busy }));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`[maps-scraper] listening on ${port}`));
