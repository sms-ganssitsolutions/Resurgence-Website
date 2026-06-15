# RESURGENCE • Official Public Storefront
**resurgence-dx.biz** — Powered by DesignXpress

Premium custom sublimation uniforms and high-detail DTF teamwear.  
Built to Dominate.

## Official Repository
This is the **official public-facing storefront** repository for Resurgence Powered by DesignXpress.

- **Live Site**: https://resurgence-dx.biz (Cloudflare Pages)
- **Tech**: Pure Vanilla HTML5 + Tailwind CSS (CDN) + ES6 JavaScript
- **Performance Target**: Sub-1.5s mobile load time (achieved via zero-framework + edge delivery)
- **Deployment**: Cloudflare Pages (direct from this repo, root `index.html`)

## Why Vanilla?
- Zero framework overhead on the money pages
- Maximum conversion speed and Core Web Vitals
- Direct R2 uploads ready (presigned URL pattern prepared)
- Mobile-rigid interactions (`touch-action: manipulation`)
- Easy for any developer to audit and extend

**Admin dashboard, role system, and backend live in separate infrastructure** (Supabase + Cloudflare Workers recommended per VinAI priorities).

## Key Features (Current)
- Dynamic product grid with category filtering (Sublimation / DTF)
- Live Customizer modal with Canvas jersey preview + drag-to-position logos
- **Direct R2 uploads** via Cloudflare Worker (presigned PUT URLs)
- Real-time brand color updates
- Multi-logo upload (max 4) with client-side preview
- Quote request payload ready (includes R2 keys)
- Dynamic branding injection point (ready for Cloudflare KV)
- Multi-currency foundation prepared

## Current Status (June 15, 2026)
- **R2 Direct Upload Worker** — ✅ Completed & production-ready
- Supabase schema + RLS — Pending
- Dynamic branding via KV — Pending
- Admin dashboard — Pending

## Immediate Next Priorities (VinAI Order)
1. Integrate R2 Worker into customizer (client-side patch ready)
2. Supabase schema design + RLS policies for quotes/orders
3. Dynamic branding system via Cloudflare KV
4. Campaign Studio (9:16 video prompt generator)

## Local Development
Just open `index.html` in any browser. No build step required.

For Tailwind customization later (optional):
```bash
npm install -D tailwindcss
npx tailwindcss -i ./input.css -o ./styles.css --watch
```

## Deployment
1. Connect this repo to Cloudflare Pages
2. Build command: (leave empty — static)
3. Output directory: `/` (root)
4. Add custom domain `resurgence-dx.biz`

## Branding & Legal
- Company: RESURGENCE
- Tagline: POWERED BY DESIGNXPRESS
- Official domain: resurgence-dx.biz
- All assets uploaded directly to Cloudflare R2

© 2026 Resurgence Powered by DesignXpress. All rights reserved.
Maintained by VinAI under strict performance-first mandate.