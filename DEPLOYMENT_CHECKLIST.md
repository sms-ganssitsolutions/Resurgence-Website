# RESURGENCE • Final Deployment Checklist
**resurgence-dx.biz** — Production Launch

**Date**: June 15, 2026  
**Status**: Ready to Deploy

---

## 1. Prerequisites

- [ ] GitHub repo is up to date (`sms-ganssitsolutions/Resurgence-Website`)
- [ ] Latest files extracted to `D:\Resurgence Website\`
- [ ] Wrangler CLI installed and logged in (`wrangler login`)
- [ ] Cloudflare account access confirmed

---

## 2. Deploy R2 Upload Worker (Highest Priority)

```bash
cd D:\Resurgence Website\workers\r2-upload-worker

# Create R2 bucket (only once)
wrangler r2 bucket create resurgence-logos

# Deploy the Worker
wrangler deploy
```

**After deployment**:
- [ ] Note the Worker URL (`https://resurgence-r2-upload.xxxxx.workers.dev`)
- [ ] Add Custom Domain: `uploads.resurgence-dx.biz`
  - Workers & Pages → `resurgence-r2-upload` → Triggers → Custom Domains

---

## 3. Deploy Cloudflare Pages (Public Storefront)

1. Go to [Cloudflare Pages](https://dash.cloudflare.com)
2. Create new project → Connect to Git
3. Select repo: `sms-ganssitsolutions/Resurgence-Website`
4. **Build settings**:
   - Framework: **None**
   - Build command: *(leave empty)*
   - Output directory: `/`
5. Click **Save and Deploy**

---

## 4. DNS Configuration (Critical)

Follow `DNS_SETUP.md` exactly.

**Required Actions**:
- [ ] Delete the two existing **A records** pointing to `216.150.0.x`
- [ ] Add **CNAME** record:
  - Type: `CNAME`
  - Name: `@`
  - Target: `your-pages-project.pages.dev`
  - Proxy: **Proxied** (orange cloud)
- [ ] (Recommended) Add `www` CNAME record

---

## 5. Add Custom Domains

### Main Site
- [ ] Pages project → **Custom domains** → Add `resurgence-dx.biz`

### R2 Worker
- [ ] Worker `resurgence-r2-upload` → **Triggers** → **Custom Domains** → Add `uploads.resurgence-dx.biz`

---

## 6. Final Verification

After DNS propagation (usually 1–5 mins):

- [ ] `https://resurgence-dx.biz` loads correctly (green lock)
- [ ] `https://www.resurgence-dx.biz` works (if added)
- [ ] Customizer opens without errors
- [ ] Logo upload flow works end-to-end (test with small PNG)
- [ ] Browser console shows: `✓ Logo uploaded directly to R2`

---

## 7. Post-Deployment (Recommended)

- [ ] Enable **Cache Everything** page rule for `/*`
- [ ] Turn on **Always Use HTTPS**
- [ ] Enable **Brotli** compression
- [ ] Update `R2_WORKER_URL` in `index.html` to `https://uploads.resurgence-dx.biz` (if not already)
- [ ] Monitor Worker logs for first few uploads

---

## Quick Commands Reference

```bash
# Deploy R2 Worker
cd D:\Resurgence Website\workers\r2-upload-worker && wrangler deploy

# Test presign endpoint (after deployment)
curl -X POST https://uploads.resurgence-dx.biz/api/r2/presign \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.png","contentType":"image/png"}'
```

---

**You are now ready to launch.**

Follow this checklist in order. Most steps take 2–5 minutes each.

**Ready to dominate.**