# 2chanc3s Cloud Run API (Express + TypeScript)

Implements read-only APIs for the public Cloudflare Pages site:

- `GET /api/feed`
- `GET /api/search`

It reads from Firestore `posts` as documented in [`../post.md`](../post.md:1) and skips posts missing `username`.

## Firestore indexes

`/api/feed` uses:

- `where('geolocator.h3', 'in', [...])`
- `orderBy('time', 'desc')`

This typically requires a composite index on:

- `geolocator.h3` (ascending)
- `time` (descending)

If Firestore prompts for a specific index creation link in logs, use that exact link.

`/api/search` (default path with no H3 tokens) uses:

- `orderBy('time','desc')`

which should not require a composite index.

## Local dev

From repo root:

```bash
cd api
npm i
npm run dev
```

Auth:

- Prefer `gcloud auth application-default login`.
- Or set `GOOGLE_APPLICATION_CREDENTIALS`.

## Deploy (Cloud Run)

Build container however you prefer (Dockerfile not included yet). The process entry is `npm run start`.

### Required env vars (recommended)

- `FIREBASE_PROJECT_ID=loxation-f8e1c` (or rely on ADC default project)
- `CORS_ALLOWED_ORIGINS=https://www.2chanc3s.com`
- `CORS_ALLOW_LOCALHOST=true`

Optional tuning:

- `FEED_DEFAULT_LIMIT=50`
- `FEED_MAX_LIMIT=100`
- `SEARCH_MAX_SCAN=500`
