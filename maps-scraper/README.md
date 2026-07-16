# Google Maps Collector (standalone)

A self-contained Google Maps scraping service. No authentication, no shared job
store, no dependency on the `website/` app. Deploy it as its own Railway service
with the root directory set to `maps-scraper`.

## What it does

- Runs a single Chromium at a time (one job per instance).
- Scrolls the Maps results feed, then opens each place for details.
- Extracts title, address, category, rating, reviews, phone, website, price,
  and open/closed status.
- Deduplicates by place URL and caps results (1-500).
- Streams progress and results to the browser over Server-Sent Events.
- Ships a built-in UI at `/` and exports results to CSV client-side.

## Endpoints

- `GET /` : the collector UI.
- `POST /api/scrape` : start a scrape (SSE stream). Body:
  `{ query, location, limit, minStars, website, details, skipClosed, language }`
  or `{ searches: [...] }` for a batch.
- `GET /health` : `{ ok, busy }`.

## Local run

```bash
cd maps-scraper
npm install
PUPPETEER_EXECUTABLE_PATH=$(which chromium) node server.js
# open http://localhost:3000
```

## Deploy on Railway

1. New service from this repo.
2. Set the service root / build context to `maps-scraper` (it has its own Dockerfile).
3. Deploy. No environment variables are required; `PORT` is provided by Railway.

## Notes

This service is intentionally open (no auth). Put it behind a private network,
Railway's access controls, or a reverse proxy if you need to restrict it.
