# SalesNav Exporter — Cloud Scraper Dashboard

A Next.js web application that provides a cloud-based scraping dashboard for LinkedIn Sales Navigator and Google Maps.

## Features

### 🔍 Sales Navigator Search Export
- Scrape Lead and Company search results from Sales Navigator
- Auto-detection of search mode (leads vs companies)
- Real-time streaming progress
- CSV and JSON export

### 👤 Profile Scanner
- Batch analysis of LinkedIn profiles
- Activity detection (reactions, comments, posts)
- Premium badge detection
- Connection count filtering
- CSV export with activity status

### 🗺️ Google Maps Scraper
- Business data extraction with Apify-compatible output schema
- Support for search queries, direct URLs, batch queries
- Rich data extraction: ratings, reviews, hours, photos, amenities
- Location-based filtering
- Pagination (10 results per page)

## Tech Stack

- **Framework:** Next.js 16 with App Router
- **Frontend:** React 19, TypeScript, CSS Modules
- **Scraping Engine:** Puppeteer with Stealth Plugin
- **Deployment:** Docker support included

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

```bash
cd website
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and navigate to `/dashboard`.

### Production Build

```bash
npm run build
npm start
```

## Environment Variables

Create a `.env.local` file:

```env
# Proxy configuration (optional but recommended)
PROXY_HOST=your-proxy-host
PROXY_PORT=your-proxy-port
PROXY_USER=your-proxy-username
PROXY_PASS=your-proxy-password

# Puppeteer executable path (for production)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## Docker Deployment

```bash
docker build -t salesnav-exporter .
docker run -p 3000:3000 salesnav-exporter
```

## Usage

1. Open the dashboard at `/dashboard`
2. Select a tab: Search Export, Profile Scanner, or Google Maps
3. Configure your search parameters
4. Click "Start Export" to begin scraping
5. Download results as CSV or JSON when complete

## Notes

- The scraper requires valid LinkedIn cookies (`li_at`) for Sales Navigator features
- Google Maps scraper does not require authentication
- Max 500 results per scrape to prevent rate limiting
- Built-in retry logic and anti-detection measures

## Disclaimer

Use responsibly. Excessive automation may trigger platform restrictions.
