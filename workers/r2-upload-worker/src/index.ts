/**
 * Resurgence R2 Direct Upload Worker - DEBUG VERSION
 * This version returns the real error message for easier debugging.
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return handleCORS(request, env);
    }

    if (pathname === '/health' || pathname === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'resurgence-r2-upload',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json', ...getCORSHeaders(request, env) }
      });
    }

    if (pathname === '/api/r2/presign' && request.method === 'POST') {
      return handlePresign(request, env);
    }

    return new Response('Not Found', { status: 404, headers: getCORSHeaders(request, env) });
  }
};

async function handlePresign(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as PresignRequest;
    const { filename, contentType } = body;

    if (!filename || !contentType) {
      return jsonError('filename and contentType are required', 400, request, env);
    }
    if (!contentType.startsWith('image/')) {
      return jsonError('Only image uploads are allowed', 400, request, env);
    }

    const safeFilename = filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();

    const timestamp = Date.now();
    const key = `logos/${timestamp}-${safeFilename}`;

    console.log(`[DEBUG] Creating presigned URL for key: ${key}`);

    const uploadUrl = await env.BUCKET.createPresignedUrl({
      method: 'PUT',
      key,
      expiresIn: 3600,
    });

    const response = {
      success: true,
      uploadUrl,
      key,
      expiresIn: 3600,
      instructions: 'PUT the file directly to uploadUrl with Content-Type header'
    };

    console.log(`[DEBUG] Presigned URL created successfully for ${key}`);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCORSHeaders(request, env) }
    });

  } catch (error: any) {
    console.error('[R2 Worker] Presign error:', error);
    // Return the REAL error message for debugging
    return jsonError(`Failed to generate upload URL: ${error?.message || error}`, 500, request, env);
  }
}

function handleCORS(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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
  return allowed.includes(origin) ? origin : (allowed[0] || 'https://resurgence-dx.biz');
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
