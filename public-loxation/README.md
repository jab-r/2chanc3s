# public.loxation.com

Static site for iOS Universal Links deep linking.

## Why this exists

iOS Universal Links don't work for same-domain navigation. When a user on `www.2chanc3s.com` taps a link to `www.2chanc3s.com/reply`, iOS keeps them in Safari (by design).

By using a **different domain** (`public.loxation.com`), iOS recognizes it as cross-domain navigation and triggers Universal Links, opening the app directly.

## Deploy to Cloudflare Pages

1. Create a new Cloudflare Pages project
2. Connect to this repo or deploy directly from the `public-loxation/public` folder
3. Set custom domain to `public.loxation.com`

### Direct upload

```bash
cd public-loxation/public
npx wrangler pages deploy . --project-name=public-loxation
```

### Via Git

Set build configuration:
- Build command: (none)
- Build output directory: `public-loxation/public`
- Root directory: `/`

## Files

- `.well-known/apple-app-site-association` - iOS Universal Links configuration
- `_headers` - Cloudflare Pages headers (Content-Type for AASA)
- `reply/index.html` - Fallback page if app doesn't open

## How it works

1. User on `2chanc3s.com` taps "Reply (in app)"
2. iOS user → link goes to `public.loxation.com/reply?...`
3. iOS fetches AASA from `public.loxation.com/.well-known/apple-app-site-association`
4. AASA matches `/reply` path → iOS opens Loxation app directly
5. If app not installed → falls back to web page with App Store link

## Requirements

The iOS app must have `public.loxation.com` in its Associated Domains:
```
applinks:public.loxation.com
```

This should already be configured alongside `2chanc3s.com`.
