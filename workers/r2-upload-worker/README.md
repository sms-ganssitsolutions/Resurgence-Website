# Resurgence R2 Direct Upload Worker

**Highest priority infrastructure component** for the public storefront.

This Worker enables **direct browser → R2 uploads** from the Live Customizer with zero backend proxying. This is critical for performance and cost.

## Why This Matters

- Browser uploads logos directly to R2 (no bandwidth cost on our origin)
- Presigned URLs are time-limited and scoped
- Keeps the vanilla storefront fast and lightweight
- Matches VinAI "Edge & Infrastructure" principle

## Architecture

```
Browser (Customizer)
    ↓ POST /api/r2/presign { filename, contentType }
Cloudflare Worker (this)
    ↓ validates + creates presigned URL
R2 Bucket (direct PUT from browser)
```

## Setup Instructions

### 1. Create the R2 Bucket

```bash
wrangler r2 bucket create resurgence-logos
```

### 2. Deploy the Worker

```bash
cd workers/r2-upload-worker

# Login if needed
wrangler login

# Deploy
wrangler deploy
```

After first deploy, note the Worker URL (e.g. `https://resurgence-r2-upload.your-subdomain.workers.dev`)

### 3. Update wrangler.toml (if needed)

- Change `bucket_name` if you used a different bucket name.
- Update `ALLOWED_ORIGINS` with your domains.

### 4. Bind to Custom Domain (Recommended)

For a clean production URL, add `uploads.resurgence-dx.biz`:

In Cloudflare dashboard:
1. Go to **Workers & Pages** → your worker (`resurgence-r2-upload`)
2. Go to **Triggers** → **Custom Domains**
3. Click **Add Custom Domain**
4. Enter: `uploads.resurgence-dx.biz`
5. Cloudflare will automatically create the necessary DNS record (CNAME)

After this is done, the frontend (`index.html`) already uses:
```js
const R2_WORKER_URL = 'https://uploads.resurgence-dx.biz';
```

No further changes needed in the storefront code.

## Integration with Frontend (index.html)

Replace the placeholder `uploadToR2` function and update `handleLogoUpload`.

### Updated `handleLogoUpload` function (paste into index.html):

```js
async function handleLogoUpload(index, input) {
    const file = input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please upload an image file.");
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert("File too large. Max 5MB.");
        return;
    }

    const nameEl = document.getElementById(`logo-name-${index}`);
    if (nameEl) nameEl.textContent = file.name.length > 18 ? file.name.substring(0, 15) + '...' : file.name;

    try {
        // 1. Get presigned URL from Worker
        const presignRes = await fetch('https://resurgence-r2-upload.your-subdomain.workers.dev/api/r2/presign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type
            })
        });

        if (!presignRes.ok) {
            throw new Error('Failed to get upload URL');
        }

        const { uploadUrl, key } = await presignRes.json();

        // 2. Upload directly to R2
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type,
            },
            body: file
        });

        if (!uploadRes.ok) {
            throw new Error('Direct upload to R2 failed');
        }

        // 3. Store successful upload info
        logoSlots[index] = {
            ...logoSlots[index],
            file,
            r2Key: key,
            uploaded: true
        };

        // 4. Show preview
        const reader = new FileReader();
        reader.onload = (e) => addLogoToPreview(index, e.target.result);
        reader.readAsDataURL(file);

        console.log('%c[VinAI] Logo uploaded directly to R2:', 'color:#22c55e', key);

    } catch (err) {
        console.error(err);
        alert('Upload failed. Please try again.');
        // Fallback to local preview only
        const reader = new FileReader();
        reader.onload = (e) => {
            logoSlots[index] = { ...logoSlots[index], file, url: e.target.result };
            addLogoToPreview(index, e.target.result);
        };
        reader.readAsDataURL(file);
    }
}
```

## Security Notes

- Only `image/*` content types allowed
- Filename is sanitized
- Presigned URLs expire after 1 hour
- CORS is locked to allowed origins
- For extra security later: add a short-lived JWT or simple secret header

## Next Improvements (Future)

- Add simple rate limiting (Workers KV)
- Support multiple file uploads in one request
- Return public CDN URL if bucket is public
- Add image optimization on upload (R2 + Image Resizing)

## Testing

You can test directly with curl:

```bash
curl -X POST https://your-worker.workers.dev/api/r2/presign \
  -H "Content-Type: application/json" \
  -d '{"filename":"test-logo.png","contentType":"image/png"}'
```

---

**This Worker unblocks real production logo uploads.**  
Once deployed and integrated, the customizer becomes fully functional end-to-end.

Maintained under VinAI performance-first mandate. Ready to dominate.