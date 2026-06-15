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
- Live Customizer modal with Canvas jersey preview
- Drag-to-position logo layers (DOM overlay for performance)
- Real-time brand color updates
- Multi-logo upload (max 4) with client-side preview
- Quote request payload ready for R2 + Supabase/Worker
- Dynamic branding injection point (ready for Cloudflare KV)
- Multi-currency foundation prepared

## Immediate Next Priorities (VinAI Order)
1. Cloudflare Worker for R2 direct presigned uploads (logo assets)
2. Supabase schema + RLS for quotes/orders
3. Dynamic branding via KV (admin controllable, edge-served)
4. Campaign Studio (9:16 video prompt generator for Super Admin)

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