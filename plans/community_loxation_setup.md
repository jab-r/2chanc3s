# Setup: community.loxation.com

Deploy the existing 2chanc3s website to `community.loxation.com` as an identical mirror.

## Prerequisites

- Cloudflare account with `loxation.com` domain
- Existing Cloudflare Pages project serving `www.2chanc3s.com`

---

## Step 1: Add DNS Record

1. Go to **Cloudflare Dashboard** → **loxation.com** → **DNS** → **Records**
2. Click **Add record**
3. Configure:
   - **Type**: `CNAME`
   - **Name**: `community`
   - **Target**: Your Pages project URL (e.g., `your-project.pages.dev`)
   - **Proxy status**: Proxied (orange cloud)
4. Click **Save**

---

## Step 2: Add Custom Domain to Pages

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → Your project
2. Click **Custom domains** tab
3. Click **Set up a custom domain**
4. Enter: `community.loxation.com`
5. Click **Continue** → **Activate domain**
6. Cloudflare will auto-provision SSL (may take a few minutes)

---

## Step 3: Verify

1. Wait 2-5 minutes for DNS propagation
2. Visit `https://community.loxation.com`
3. Should see identical content to `www.2chanc3s.com`

---

## API Proxy (if needed)

If your API calls go through `/api/*` paths, ensure your Cloudflare Worker or Pages function also handles requests from `community.loxation.com`.

**Option A: Pages Functions**
- If using Pages Functions in `functions/api/*`, they work automatically on all custom domains

**Option B: Cloudflare Worker**
- Add route: `community.loxation.com/api/*` → your API proxy worker

Check your existing setup in `cloudflare/workers/api-proxy/wrangler.toml`:
```toml
routes = [
  { pattern = "www.2chanc3s.com/api/*", zone_name = "2chanc3s.com" },
  { pattern = "community.loxation.com/api/*", zone_name = "loxation.com" }  # Add this
]
```

---

## Deep Links

Reply links from `community.loxation.com` already point to `public.loxation.com`, so:

| Platform | Deep Link Works? |
|----------|------------------|
| iOS Safari | ✅ Universal Links via public.loxation.com |
| iOS Chrome/Brave/etc. | ✅ Custom scheme loxation:// via onclick |
| Android | ✅ Intent URL with fallback |

No code changes needed - the site is already configured correctly.

---

## Future: Wildcard Subdomains

If you later want `hiking.loxation.com`, `music.loxation.com`, etc.:

1. Add wildcard DNS: `*.loxation.com` → Worker
2. Create Cloudflare Worker to extract subdomain and serve filtered content
3. Exclude reserved subdomains: `public`, `api`, `messaging`, `www`, `community`

See `plans/community_subdomain_routing_plan.md` for detailed wildcard implementation.
