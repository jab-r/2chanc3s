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

## Routes

- `GET /` feed UI
- `GET /reply?username=...&messageId=...` reply landing + install CTAs
- `GET /.well-known/apple-app-site-association` (static; fill `TEAM_ID.BUNDLE_ID`)
- `GET /.well-known/assetlinks.json` (static; fill signing cert fingerprints)

## Deployment notes (Cloudflare)

1) Point `www.2chanc3s.com` to Cloudflare Pages.
2) Configure a separate Cloud Run service URL for the API.
3) Update `API_BASE` in [`web/public/app.js`](web/public/app.js:1) (or implement a build-time replacement).

## Deep link behavior

The Reply link format is:

- `https://www.2chanc3s.com/reply?username=<u>&messageId=<id>`

If Universal Links / App Links are configured for `/reply`, tapping Reply should open Loxation. Otherwise the landing page provides install links.

Install targets:

- iOS: `https://apps.apple.com/app/id6743818003`
- Android: `https://play.google.com/store/apps/details?id=com.jabresearch.loxation`
