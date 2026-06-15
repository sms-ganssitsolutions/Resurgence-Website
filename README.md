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

## Deployment to Cloudflare Pages (Production)

This site is optimized for **Cloudflare Pages** (zero build, maximum performance).

### Step-by-step Deployment

1. **Connect Repository**
   - Go to [Cloudflare Pages](https://dash.cloudflare.com)
   - Create a new project → Connect to Git
   - Select this repository: `sms-ganssitsolutions/Resurgence-Website`
   - **Production branch**: `main`

2. **Build Settings**
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: `/` (root)
   - Root directory: `/`

3. **Deploy**
   - Click **Save and Deploy**
   - Your site will be live at `https://<random>.pages.dev`

4. **Add Custom Domain**
   - Go to your Pages project → **Custom domains**
   - Add `resurgence-dx.biz`
   - Follow the prompts to update DNS at your registrar (or use Cloudflare Registrar)
   - Enable ** proxied** (orange cloud) for full security + performance

5. **Recommended Cloudflare Settings**
   - Enable **Cache Everything** page rule for `/*`
   - Turn on **Always Use HTTPS**
   - Enable **Brotli** compression

### R2 Worker Custom Domain (Separate)

For direct logo uploads, also add:
- `uploads.resurgence-dx.biz` → as Custom Domain on the `resurgence-r2-upload` Worker

This keeps upload traffic clean and professional.

## Branding & Legal
- Company: RESURGENCE
- Tagline: POWERED BY DESIGNXPRESS
- Official domain: resurgence-dx.biz
- All assets uploaded directly to Cloudflare R2

© 2026 Resurgence Powered by DesignXpress. All rights reserved.
Maintained by VinAI under strict performance-first mandate.