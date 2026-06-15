# DNS Setup Guide — resurgence-dx.biz

**Goal**: Make `https://resurgence-dx.biz` point to your Cloudflare Pages storefront and enable `https://uploads.resurgence-dx.biz` for direct R2 uploads.

---

## Current Problem (as of June 15, 2026)

Your domain `resurgence-dx.biz` currently has **A records** pointing to external IPs (`216.150.0.61` and `216.150.0.11`).  
These records prevent Cloudflare Pages from serving your site.

**Result**: Visitors see an error and cannot reach `resurgence-dx.biz`.

---

## Recommended DNS Configuration

### For the Main Site (`resurgence-dx.biz`)

Delete the existing A records and replace them with a **CNAME** record.

| Type   | Name | Target                              | Proxy Status | TTL  | Notes                              |
|--------|------|-------------------------------------|--------------|------|------------------------------------|
| CNAME  | @    | `your-project.pages.dev`            | Proxied      | Auto | Main domain (root)                 |
| CNAME  | www  | `your-project.pages.dev`            | Proxied      | Auto | Optional but recommended           |

> Replace `your-project.pages.dev` with your actual Cloudflare Pages domain (found in Workers & Pages → your project overview).

### For R2 Direct Uploads (Worker)

| Type   | Name              | Target                              | Proxy Status | TTL  | Notes                     |
|--------|-------------------|-------------------------------------|--------------|------|---------------------------|
| CNAME  | uploads           | `resurgence-r2-upload.your-subdomain.workers.dev` | Proxied | Auto | For logo uploads          |

After adding this, update (or keep) the following line in `index.html`:

```js
const R2_WORKER_URL = 'https://uploads.resurgence-dx.biz';
```

---

## Step-by-Step DNS Setup

### 1. Go to DNS Records

1. Log in to Cloudflare Dashboard
2. Select domain: **resurgence-dx.biz**
3. Go to **DNS** → **Records**

### 2. Remove Conflicting Records

Delete these two A records:

- `resurgence-dx.biz` → `216.150.0.61`
- `resurgence-dx.biz` → `216.150.0.11`

### 3. Add CNAME Record for Main Domain

1. Click **Add record**
2. Fill in:

   - **Type**: `CNAME`
   - **Name**: `@` (this represents the root domain)
   - **Target / Content**: `your-project.pages.dev`
   - **Proxy status**: **Proxied** (orange cloud)
   - **TTL**: `Auto`

3. Click **Save**

### 4. (Recommended) Add www Subdomain

Repeat the process:

- **Type**: `CNAME`
- **Name**: `www`
- **Target**: `your-project.pages.dev`
- **Proxy status**: **Proxied**

### 5. Add Custom Domain in Cloudflare Pages

1. Go to **Workers & Pages** → Your Pages project
2. Click **Custom domains**
3. Click **Add a Custom Domain**
4. Enter `resurgence-dx.biz`
5. Follow the prompts (Cloudflare will verify the CNAME)

### 6. (Optional but Clean) Add R2 Worker Custom Domain

1. Go to **Workers & Pages** → `resurgence-r2-upload`
2. Go to **Triggers** → **Custom Domains**
3. Add `uploads.resurgence-dx.biz`
4. Save

---

## After DNS Changes — Verification Checklist

- [ ] Old A records are deleted
- [ ] CNAME record for `@` is added and **Proxied**
- [ ] `resurgence-dx.biz` appears in Pages → Custom domains
- [ ] Site loads at `https://resurgence-dx.biz` (green lock)
- [ ] `www.resurgence-dx.biz` also works (if added)
- [ ] `uploads.resurgence-dx.biz` is added to the R2 Worker (for future logo uploads)

---

## Notes

- Cloudflare usually propagates DNS changes within **1–5 minutes**.
- Always keep **Proxy status = Proxied** for both performance and security.
- Do **not** use A records when using Cloudflare Pages — always use CNAME.
- The `uploads.resurgence-dx.biz` subdomain is prepared for direct R2 uploads (see `workers/r2-upload-worker/`).

---

**Status**: Ready to apply  
**Last Updated**: June 15, 2026

Follow this guide and your domain will be fully connected to Cloudflare Pages + R2. Ready to dominate.