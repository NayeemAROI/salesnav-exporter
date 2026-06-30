FROM node:20-slim AS builder

WORKDIR /app

COPY website/package.json website/package-lock.json* ./
RUN npm ci

COPY website/ .
RUN npm run build

# ── Production image (minimal) ──
FROM node:20-slim

# Install only Chromium (minimal deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 libxss1 \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
# Limit Node.js memory to leave room for Chromium
ENV NODE_OPTIONS="--max-old-space-size=192"

WORKDIR /app

COPY website/package.json website/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./

EXPOSE 3000

CMD ["npm", "start"]
