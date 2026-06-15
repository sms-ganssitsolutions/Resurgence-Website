/**
 * Resurgence R2 Direct Upload Worker
 * 
 * Purpose: Generate presigned PUT URLs so the browser can upload logos
 * directly to Cloudflare R2 with zero server proxying.
 * 
 * This is the highest priority infrastructure piece for production.
 * 
 * Usage from browser:
 *   POST /api/r2/presign
 *   Body: { filename: "logo.png", contentType: "image/png" }
 * 
 * Returns:
 *   { success: true, uploadUrl: "...", key: "logos/xxx-logo.png", expiresIn: 3600 }
 */

export interface Env {
  BUCKET: R2Bucket;
  ALLOWED_ORIGINS?: string;
  MAX_FILE_SIZE_MB?: string;
}

interface PresignRequest {
  filename: string;
  contentType: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request, env);
    }

    // Health check
    if (pathname === '/health' || pathname === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'resurgence-r2-upload',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json', ...getCORSHeaders(request, env) }
      });
    }

    // Main presign endpoint
    if (pathname === '/api/r2/presign' && request.method === 'POST') {
      return handlePresign(request, env);
    }

    return new Response('Not Found', { 
      status: 404,
      headers: getCORSHeaders(request, env)
    });
  }
};

/**
 * Generate a presigned PUT URL for direct R2 upload
 */
async function handlePresign(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as PresignRequest;
    const { filename, contentType } = body;

    // === VALIDATION ===
    if (!filename || !contentType) {
      return jsonError('filename and contentType are required', 400, request, env);
    }

    // Only allow images
    if (!contentType.startsWith('image/')) {
      return jsonError('Only image uploads are allowed', 400, request, env);
    }

    // Basic filename sanitization
    const safeFilename = filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();

    // Generate unique key
    const timestamp = Date.now();
    const key = `logos/${timestamp}-${safeFilename}`;

    // Create presigned PUT URL (1 hour expiry)
    const uploadUrl = await env.BUCKET.createPresignedUrl({
      method: 'PUT',
      key,
      expiresIn: 3600, // 1 hour
    });

    // Optional: You can also return a public URL if your bucket is public
    // const publicUrl = `https://r2.resurgence-dx.biz/${key}`;

    const response = {
      success: true,
      uploadUrl,
      key,
      expiresIn: 3600,
      // publicUrl, // uncomment if bucket is public
      instructions: 'PUT the file directly to uploadUrl with Content-Type header'
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(request, env)
      }
    });

  } catch (error: any) {
    console.error('[R2 Worker] Presign error:', error);
    return jsonError('Failed to generate upload URL', 500, request, env);
  }
}

/**
 * CORS handling
 */
function handleCORS(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}

function getCORSHeaders(request: Request, env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || 'https://resurgence-dx.biz,http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  if (allowed.includes(origin)) {
    return origin;
  }
  
  // Fallback to first allowed origin (usually production)
  return allowed[0] || 'https://resurgence-dx.biz';
}

function jsonError(message: string, status: number, request: Request, env: Env) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCORSHeaders(request, env)
    }
  });
}
