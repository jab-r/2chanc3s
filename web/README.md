# 2chanc3s Cloudflare Pages site

Static site that:

- Asks for browser geolocation
- Computes H3 buckets (res 7 + res 8) and neighbors
- Calls the Cloud Run API (`/api/feed`, `/api/search`)
- Renders a retro “missed connections” list
- Provides Reply deep links: `https://www.2chanc3s.com/reply?username=...&messageId=...`

Also hosts `/.well-known/*` as static files.

## Configure API base

Set `API_BASE` in [`web/public/app.js`](web/public/app.js:1) to your Cloud Run URL (or add a Pages env var injection step).

