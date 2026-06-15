// ==UserScript==
// @name         Grok Imagine Downloader - Bulk Save High-Quality Media (Fork)
// @namespace    https://grok.com
// @version      1.1.1
// @description  Updated fork of the original Grok Imagine Downloader for the current Grok UI. Downloads photos and videos, supports bulk save, ZIP export, and JSON metadata sidecars.
// @author       Maksim Aleksandrovich Morozov
// @license      MIT
// @match        https://grok.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @connect      grok.com
// @connect      cdn.grok.com
// @connect      assets.grok.com
// @connect      imagine-public.x.ai
// @downloadURL https://update.greasyfork.org/scripts/573072/Grok%20Imagine%20Downloader%20-%20Bulk%20Save%20High-Quality%20Media%20%28Fork%29.user.js
// @updateURL https://update.greasyfork.org/scripts/573072/Grok%20Imagine%20Downloader%20-%20Bulk%20Save%20High-Quality%20Media%20%28Fork%29.meta.js
// ==/UserScript==

/*
Based on the original script:
https://greasyfork.org/en/scripts/556188-grok-imagine-downloader-bulk-save-high-quality-media

Original author: Mykyta Shcherbyna
License: MIT

This fork updates compatibility for Grok Imagine saved/favorites and post views and adds:
- ZIP export
- JSON metadata sidecars
*/

(function () {
    'use strict';

    // Card/button selectors for the current Grok UI.
    const CARD_SELECTOR = [
        '[data-testid*="media-post"]:not([data-downloader-added])',
        'div.relative.cursor-pointer:not([data-downloader-added])',
        'div[class*="group/"]:not([data-downloader-added])',
        'article:not([data-downloader-added])',
        'a[href*="/imagine/"]:not([data-downloader-added])',
        'div[data-post-id]:not([data-downloader-added])'
    ].join(', ');

    const BUTTON_CONTAINER_SELECTOR = [
        '.absolute.bottom-2.right-2',
        '.absolute.bottom-2',
        '.absolute.right-2',
        '[class*="bottom-2"][class*="right-2"]',
        '[class*="absolute"][class*="bottom"][class*="right"]'
    ].join(', ');

    const BUTTON_CLASSES = 'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium leading-[normal] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-100 select-none rounded-full overflow-hidden h-10 w-10 p-2 bg-black/25 hover:bg-white/10 border border-white/15 text-white text-xs font-bold';
    const ZIP_BUTTON_CLASSES = 'inline-flex items-center justify-center gap-2 whitespace-nowrap text-[10px] font-bold leading-[normal] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-100 select-none rounded-full overflow-hidden h-10 min-w-10 px-2 bg-black/25 hover:bg-white/10 border border-white/15 text-white';
    const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download size-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`;

    /*
    User-configurable options:
    - ZIP_CONCURRENCY: number of files fetched in parallel when building a ZIP.
    - INCLUDE_METADATA_SIDECARS: save per-file JSON sidecars and post_metadata.json in ZIPs.
    - DETAIL_MEDIA_WAIT_TIMEOUT: wait time for media to update after clicking a thumbnail.
    - DETAIL_PROMPT_WAIT_TIMEOUT: wait time for prompt text/meta to update after thumbnail clicks.
    - API_URL_HINTS: JSON endpoints worth scanning for post/media structure updates.
    - DEBUG: prints debug logs to the browser console.
    */
    const ZIP_CONCURRENCY = 3;
    const INCLUDE_METADATA_SIDECARS = true;
    const DETAIL_MEDIA_WAIT_TIMEOUT = 1800;
    const DETAIL_PROMPT_WAIT_TIMEOUT = 1400;
    const API_URL_HINTS = ['/rest/', '/api/', '/media/', '/imagine', '/_next/', '/_data/'];
    const DEBUG = false;

    // Main in-memory stores:
    // - mediaDatabase: grouped media objects by post id
    // - mediaMetadataIndex: exact URL -> metadata mapping
    const mediaDatabase = new Map();
    const mediaMetadataIndex = new Map();

    const textEncoder = new TextEncoder();
    let crc32Table = null;

    function log() {
        if (DEBUG) console.log('[GrokDL]', ...arguments);
    }

    // -----------------------------
    // Generic helpers
    // -----------------------------

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function waitFor(checkFn, timeoutMs, intervalMs) {
        const timeout = timeoutMs || 8000;
        const interval = intervalMs || 120;
        const start = Date.now();

        while ((Date.now() - start) < timeout) {
            const value = checkFn();
            if (value) return value;
            await sleep(interval);
        }

        return null;
    }

    function extractPostIdFromUrl(url) {
        if (!url) return null;
        const matches = [...String(url).matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g)];
        return matches.length > 0 ? matches[matches.length - 1][0] : null;
    }

    function normalizeComparableUrl(url) {
        return String(url || '').trim().replace(/#.*$/, '');
    }

    function looksLikeMediaUrl(url) {
        const str = String(url || '');
        if (!str) return false;
        return /(assets\.grok\.com|imagine-public\.x\.ai|\/generated\/|preview_image|_thumbnail\.jpg|\.mp4(?:\?|$)|\.webm(?:\?|$)|\.png(?:\?|$)|\.jpe?g(?:\?|$)|\.webp(?:\?|$))/i.test(str);
    }

    function inferMimeTypeFromUrl(url) {
        if (!url) return '';
        const clean = String(url).split('?')[0].toLowerCase();
        if (clean.endsWith('.mp4')) return 'video/mp4';
        if (clean.endsWith('.webm')) return 'video/webm';
        if (clean.endsWith('.png')) return 'image/png';
        if (clean.endsWith('.webp')) return 'image/webp';
        if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
        return '';
    }

    function sanitizeForFilename(str) {
        return (str || '').replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
    }

    function hashString(str) {
        const input = String(str || '');
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;

        for (let i = 0; i < input.length; i++) {
            const ch = input.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }

        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

        return ((h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)).slice(0, 10);
    }

    function utf8Encode(str) {
        return textEncoder.encode(String(str || ''));
    }

    function coalesceNonEmpty() {
        for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (value === 0 || value === false) return value;
            if (typeof value === 'string') {
                if (value.trim()) return value;
                continue;
            }
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return '';
    }

    // -----------------------------
    // Prompt normalization/filtering
    // -----------------------------

    function normalizePrompt(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function isGenericGrokDescription(text) {
        const value = normalizePrompt(text).toLowerCase();
        if (!value) return true;
        return value.includes('grok is an ai assistant') || value === 'imagine - grok';
    }

    function countUiControlTokens(text) {
        const value = normalizePrompt(text).toLowerCase();
        if (!value) return 0;

        const tokens = [
            'your browser does not support the video tag',
            'make video',
            'unmute',
            'extend from frame',
            'zip',
            '720p',
            'video',
            'image',
            'more'
        ];

        return tokens.reduce(function (count, token) {
            return count + (value.includes(token) ? 1 : 0);
        }, 0);
    }

    function isLikelyInternalPromptSlug(prompt) {
        const value = normalizePrompt(prompt);
        if (!value) return true;

        const lower = value.toLowerCase();

        if (/^(imagine(?:[-_][a-z0-9]+)*|overriden|override(?:n)?|rewrite|rewritten)$/i.test(value)) {
            return true;
        }

        if (/^[a-z0-9_-]{1,32}$/i.test(value)) {
            return true;
        }

        if (
            (lower.startsWith('imagine') || lower.startsWith('flux') || lower.startsWith('model')) &&
            value.length < 40 &&
            !/\s/.test(value)
        ) {
            return true;
        }

        return false;
    }

    function isLikelyRealPrompt(prompt) {
        const value = normalizePrompt(prompt);
        if (!value) return false;
        if (value.length < 12) return false;
        if (isGenericGrokDescription(value)) return false;
        if (isLikelyInternalPromptSlug(value)) return false;
        if (countUiControlTokens(value) >= 2) return false;
        return true;
    }

    // -----------------------------
    // Media identity and filenames
    // -----------------------------

    function buildFilename(item) {
        const time = item.createTime ? String(item.createTime).slice(0, 19).replace(/:/g, '-') : 'unknown';
        const model = item.modelName ? `_${sanitizeForFilename(item.modelName)}` : '';
        const promptHash = item.prompt ? `_p${hashString(item.prompt)}` : '';

        let ext = item.isVideo ? 'mp4' : 'jpg';
        if (item.mimeType) {
            if (item.mimeType === 'video/mp4') ext = 'mp4';
            else if (item.mimeType === 'video/webm') ext = 'webm';
            else if (item.mimeType === 'image/png') ext = 'png';
            else if (item.mimeType === 'image/jpeg') ext = 'jpg';
            else if (item.mimeType === 'image/webp') ext = 'webp';
        }

        return `${time}_${item.id}${model}${promptHash}.${ext}`;
    }

    function getMediaIdentity(item) {
        if (!item) return '';
        const comparableUrl = normalizeComparableUrl(item.url);
        if (comparableUrl) return 'url:' + comparableUrl;
        return [
            'fallback',
            item.parentPostId || '',
            item.id || '',
            item.filename || '',
            item.mimeType || '',
            item.isVideo ? 'video' : 'image'
        ].join('|');
    }

    function hasMediaItem(list, item) {
        if (!Array.isArray(list) || !item) return false;
        const target = getMediaIdentity(item);
        return list.some(function (existing) {
            return getMediaIdentity(existing) === target;
        });
    }

    function mergeMediaFields(existing, incoming, forcedPostId) {
        const merged = {
            id: coalesceNonEmpty(
                existing && existing.id,
                incoming && incoming.id,
                forcedPostId,
                extractPostIdFromUrl((incoming && incoming.url) || (existing && existing.url)) || ('media_' + Date.now())
            ),
            parentPostId: coalesceNonEmpty(
                forcedPostId,
                existing && existing.parentPostId,
                incoming && incoming.parentPostId,
                existing && existing.id,
                incoming && incoming.id,
                extractPostIdFromUrl((incoming && incoming.url) || (existing && existing.url))
            ),
            url: coalesceNonEmpty(incoming && incoming.url, existing && existing.url),
            createTime: coalesceNonEmpty(existing && existing.createTime, incoming && incoming.createTime),
            modelName: coalesceNonEmpty(existing && existing.modelName, incoming && incoming.modelName),
            prompt: coalesceNonEmpty(existing && existing.prompt, incoming && incoming.prompt),
            isVideo: Boolean((existing && existing.isVideo) || (incoming && incoming.isVideo)),
            mimeType: coalesceNonEmpty(existing && existing.mimeType, incoming && incoming.mimeType)
        };

        if (!merged.mimeType && merged.url) merged.mimeType = inferMimeTypeFromUrl(merged.url);
        if (!merged.isVideo && merged.mimeType) merged.isVideo = merged.mimeType.startsWith('video/');
        merged.filename = buildFilename(merged);
        return merged;
    }

    function upsertMediaItems(postId, items) {
        if (!postId || !Array.isArray(items) || items.length === 0) {
            return postId ? (mediaDatabase.get(postId) || null) : null;
        }

        const existing = mediaDatabase.get(postId) || {
            id: postId,
            object: []
        };
        const currentItems = Array.isArray(existing.object) ? existing.object.slice() : [];
        let changed = false;

        for (const incoming of items) {
            if (!incoming || !incoming.url) continue;

            const normalizedIncoming = mergeMediaFields(null, incoming, incoming.parentPostId || postId);
            const incomingIdentity = getMediaIdentity(normalizedIncoming);
            const index = currentItems.findIndex(function (item) {
                return getMediaIdentity(item) === incomingIdentity;
            });

            if (index >= 0) {
                const merged = mergeMediaFields(
                    currentItems[index],
                    normalizedIncoming,
                    normalizedIncoming.parentPostId || currentItems[index].parentPostId || postId
                );

                if (JSON.stringify(merged) !== JSON.stringify(currentItems[index])) {
                    currentItems[index] = merged;
                    changed = true;
                }
            } else {
                currentItems.push(normalizedIncoming);
                changed = true;
            }
        }

        const next = Object.assign({}, existing, {
            id: existing.id || postId,
            _isFallback: false,
            object: currentItems
        });

        if (changed || !mediaDatabase.has(postId)) {
            mediaDatabase.set(postId, next);
            log('media database upsert', postId, currentItems.length, 'items');
        }

        return mediaDatabase.get(postId) || next;
    }

    // -----------------------------
    // Exact metadata index
    // -----------------------------

    function getPostSeedMetadata(postId) {
        const media = mediaDatabase.get(postId);
        const list = media && Array.isArray(media.object) ? media.object : [];
        for (const item of list) {
            if (item && (item.modelName || item.createTime || item.prompt)) return item;
        }
        return null;
    }

    function getExactMetadataForUrl(url) {
        const key = normalizeComparableUrl(url);
        return key ? mediaMetadataIndex.get(key) || null : null;
    }

    function backfillExactMetadataIntoDatabase(urlKey, metadata) {
        if (!urlKey || !metadata) return false;

        let changed = false;

        for (const [postId, media] of mediaDatabase.entries()) {
            if (!media || !Array.isArray(media.object) || media.object.length === 0) continue;

            let localChanged = false;
            const nextItems = media.object.map(function (item) {
                if (normalizeComparableUrl(item.url) !== urlKey) return item;

                const merged = mergeMediaFields(item, {
                    id: metadata.id || item.id,
                    parentPostId: metadata.parentPostId || item.parentPostId || postId,
                    url: item.url,
                    createTime: metadata.createTime || item.createTime,
                    modelName: metadata.modelName || item.modelName,
                    prompt: metadata.prompt || item.prompt,
                    mimeType: metadata.mimeType || item.mimeType,
                    isVideo: typeof metadata.isVideo === 'boolean' ? metadata.isVideo : item.isVideo
                }, item.parentPostId || postId);

                if (JSON.stringify(merged) !== JSON.stringify(item)) {
                    localChanged = true;
                }

                return merged;
            });

            if (localChanged) {
                media.object = nextItems;
                mediaDatabase.set(postId, media);
                changed = true;
            }
        }

        return changed;
    }

    function rememberExactMediaMetadata(url, metadata, options) {
        const key = normalizeComparableUrl(url);
        if (!key || !looksLikeMediaUrl(key)) return false;

        const existing = mediaMetadataIndex.get(key) || null;
        const next = Object.assign({}, existing || {}, {
            url: key,
            id: coalesceNonEmpty(existing && existing.id, metadata && metadata.id, extractPostIdFromUrl(key)),
            parentPostId: coalesceNonEmpty(existing && existing.parentPostId, metadata && metadata.parentPostId),
            createTime: coalesceNonEmpty(existing && existing.createTime, metadata && metadata.createTime),
            modelName: coalesceNonEmpty(existing && existing.modelName, metadata && metadata.modelName),
            mimeType: coalesceNonEmpty(existing && existing.mimeType, metadata && metadata.mimeType, inferMimeTypeFromUrl(key)),
            isVideo: typeof (existing && existing.isVideo) === 'boolean'
                ? existing.isVideo
                : (typeof (metadata && metadata.isVideo) === 'boolean'
                    ? metadata.isVideo
                    : inferMimeTypeFromUrl(key).startsWith('video/')),
            prompt: existing && existing.prompt ? existing.prompt : '',
            promptConfidence: existing && existing.promptConfidence ? existing.promptConfidence : 0
        });

        const opts = options || {};
        const promptConfidence = opts.promptConfidence || 0;
        const incomingPrompt = normalizePrompt(metadata && metadata.prompt);

        if (incomingPrompt && isLikelyRealPrompt(incomingPrompt) && promptConfidence >= (next.promptConfidence || 0)) {
            next.prompt = incomingPrompt;
            next.promptConfidence = promptConfidence;
        }

        const before = existing ? JSON.stringify(existing) : '';
        const after = JSON.stringify(next);
        if (before === after) return false;

        mediaMetadataIndex.set(key, next);
        backfillExactMetadataIntoDatabase(key, next);
        log('exact metadata', key, next.prompt ? 'prompt' : 'no-prompt', next.modelName || '', next.createTime || '');
        return true;
    }

    // -----------------------------
    // Sidecar metadata
    // -----------------------------

    function buildMetadataObject(item, postId) {
        return {
            id: item.id || '',
            postId: item.parentPostId || postId || '',
            mediaUrl: item.url || '',
            filename: item.filename || '',
            mimeType: item.mimeType || '',
            isVideo: !!item.isVideo,
            createTime: item.createTime || '',
            modelName: item.modelName || '',
            prompt: item.prompt || '',
            promptHash: item.prompt ? hashString(item.prompt) : '',
            savedAt: new Date().toISOString(),
            source: 'Grok Imagine Downloader userscript'
        };
    }

    function getMetadataFilename(item) {
        return String(item.filename || ('media_' + (item.id || 'unknown'))).replace(/\.[^.]+$/, '') + '.json';
    }

    function saveBlob(blob, filename) {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            URL.revokeObjectURL(objectUrl);
        }, 30000);
    }

    function downloadMetadataSidecar(item, postId) {
        const blob = new Blob([JSON.stringify(buildMetadataObject(item, postId), null, 2)], { type: 'application/json' });
        saveBlob(blob, getMetadataFilename(item));
    }

    // -----------------------------
    // Raw file download helpers
    // -----------------------------

    function downloadFile(item, handlers) {
        const callbacks = handlers || {};
        GM_download({
            url: item.url,
            name: item.filename,
            onload: function () {
                if (typeof callbacks.onload === 'function') callbacks.onload();
            },
            onerror: function (error) {
                if (typeof callbacks.onerror === 'function') callbacks.onerror(error);
            },
            ontimeout: function () {
                if (typeof callbacks.ontimeout === 'function') callbacks.ontimeout();
            }
        });
    }

    function fetchBinary(url) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: 90000,
                onload: function (resp) {
                    if (resp.status >= 200 && resp.status < 300 && resp.response) resolve(resp.response);
                    else reject(new Error('HTTP ' + resp.status + ' for ' + url));
                },
                onerror: function () { reject(new Error('Network error for ' + url)); },
                ontimeout: function () { reject(new Error('Timeout for ' + url)); }
            });
        });
    }

    async function runWithConcurrency(items, limit, worker) {
        const queue = items.slice();
        const workers = [];
        const size = Math.max(1, Math.min(limit || 3, queue.length || 1));

        for (let i = 0; i < size; i++) {
            workers.push((async function () {
                while (queue.length > 0) {
                    const item = queue.shift();
                    if (!item) break;
                    await worker(item);
                }
            })());
        }

        await Promise.all(workers);
    }

    function ensureUniqueFilename(filename, usedNames) {
        const original = String(filename || 'file');
        if (!usedNames.has(original)) {
            usedNames.add(original);
            return original;
        }

        const base = original.replace(/\.[^.]+$/, '');
        const extMatch = original.match(/(\.[^.]+)$/);
        const ext = extMatch ? extMatch[1] : '';
        let index = 2;
        let candidate = '';

        do {
            candidate = `${base}_${index}${ext}`;
            index++;
        } while (usedNames.has(candidate));

        usedNames.add(candidate);
        return candidate;
    }

    function prepareDownloadItems(items) {
        const usedNames = new Set();
        return (items || []).map(function (item, index) {
            const fallbackName = item && item.filename ? item.filename : ('file_' + (index + 1));
            return Object.assign({}, item, {
                filename: ensureUniqueFilename(fallbackName, usedNames)
            });
        });
    }

    // -----------------------------
    // ZIP creation
    // -----------------------------

    function getCrc32Table() {
        if (crc32Table) return crc32Table;

        crc32Table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
            }
            crc32Table[i] = crc >>> 0;
        }

        return crc32Table;
    }

    function crc32(bytes) {
        const table = getCrc32Table();
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function writeUint16LE(target, offset, value) {
        target[offset] = value & 0xff;
        target[offset + 1] = (value >>> 8) & 0xff;
    }

    function writeUint32LE(target, offset, value) {
        target[offset] = value & 0xff;
        target[offset + 1] = (value >>> 8) & 0xff;
        target[offset + 2] = (value >>> 16) & 0xff;
        target[offset + 3] = (value >>> 24) & 0xff;
    }

    function toZipBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        return utf8Encode(value);
    }

    function getDosDateTime(date) {
        const safeDate = date instanceof Date ? date : new Date();
        const year = Math.min(Math.max(safeDate.getFullYear(), 1980), 2107);
        const month = safeDate.getMonth() + 1;
        const day = safeDate.getDate();
        const hours = safeDate.getHours();
        const minutes = safeDate.getMinutes();
        const seconds = Math.floor(safeDate.getSeconds() / 2);

        return {
            date: ((year - 1980) << 9) | (month << 5) | day,
            time: (hours << 11) | (minutes << 5) | seconds
        };
    }

    function concatUint8Arrays(chunks, totalLength) {
        const size = typeof totalLength === 'number'
            ? totalLength
            : chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);

        const output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.length;
        }
        return output;
    }

    // Create a simple ZIP archive using the STORE method.
    function createStoredZip(files) {
        const entries = Object.entries(files || {});
        const localChunks = [];
        const centralChunks = [];
        let localSize = 0;
        let centralSize = 0;
        let offset = 0;
        const now = getDosDateTime(new Date());

        for (const [name, value] of entries) {
            const nameBytes = utf8Encode(name);
            const data = toZipBytes(value);
            const crc = crc32(data);

            const localHeader = new Uint8Array(30 + nameBytes.length);
            writeUint32LE(localHeader, 0, 0x04034b50);
            writeUint16LE(localHeader, 4, 20);
            writeUint16LE(localHeader, 6, 0x0800);
            writeUint16LE(localHeader, 8, 0);
            writeUint16LE(localHeader, 10, now.time);
            writeUint16LE(localHeader, 12, now.date);
            writeUint32LE(localHeader, 14, crc);
            writeUint32LE(localHeader, 18, data.length);
            writeUint32LE(localHeader, 22, data.length);
            writeUint16LE(localHeader, 26, nameBytes.length);
            writeUint16LE(localHeader, 28, 0);
            localHeader.set(nameBytes, 30);

            localChunks.push(localHeader, data);
            localSize += localHeader.length + data.length;

            const centralHeader = new Uint8Array(46 + nameBytes.length);
            writeUint32LE(centralHeader, 0, 0x02014b50);
            writeUint16LE(centralHeader, 4, 20);
            writeUint16LE(centralHeader, 6, 20);
            writeUint16LE(centralHeader, 8, 0x0800);
            writeUint16LE(centralHeader, 10, 0);
            writeUint16LE(centralHeader, 12, now.time);
            writeUint16LE(centralHeader, 14, now.date);
            writeUint32LE(centralHeader, 16, crc);
            writeUint32LE(centralHeader, 20, data.length);
            writeUint32LE(centralHeader, 24, data.length);
            writeUint16LE(centralHeader, 28, nameBytes.length);
            writeUint16LE(centralHeader, 30, 0);
            writeUint16LE(centralHeader, 32, 0);
            writeUint16LE(centralHeader, 34, 0);
            writeUint16LE(centralHeader, 36, 0);
            writeUint32LE(centralHeader, 38, 0);
            writeUint32LE(centralHeader, 42, offset);
            centralHeader.set(nameBytes, 46);

            centralChunks.push(centralHeader);
            centralSize += centralHeader.length;
            offset += localHeader.length + data.length;
        }

        const endRecord = new Uint8Array(22);
        writeUint32LE(endRecord, 0, 0x06054b50);
        writeUint16LE(endRecord, 4, 0);
        writeUint16LE(endRecord, 6, 0);
        writeUint16LE(endRecord, 8, entries.length);
        writeUint16LE(endRecord, 10, entries.length);
        writeUint32LE(endRecord, 12, centralSize);
        writeUint32LE(endRecord, 16, localSize);
        writeUint16LE(endRecord, 20, 0);

        return concatUint8Arrays(localChunks.concat(centralChunks, endRecord), localSize + centralSize + endRecord.length);
    }

    async function startZipDownload(media, postId, button) {
        const all = prepareDownloadItems(Array.isArray(media && media.object) ? media.object : []);
        if (all.length === 0) return;

        const zipName = 'post_' + (postId || 'unknown') + '.zip';
        let completed = 0;
        let failed = 0;
        const total = all.length;
        const originalText = button.textContent;
        const files = {};
        const savedItems = [];

        button.textContent = 'ZIP';
        button.style.pointerEvents = 'none';
        button.disabled = true;

        await runWithConcurrency(all, ZIP_CONCURRENCY, async function (item) {
            try {
                const binary = await fetchBinary(item.url);
                files[item.filename] = new Uint8Array(binary);

                if (INCLUDE_METADATA_SIDECARS) {
                    files[getMetadataFilename(item)] = utf8Encode(JSON.stringify(buildMetadataObject(item, postId), null, 2));
                }

                savedItems.push(item);
                completed++;
                button.textContent = completed + '/' + total;
            } catch (err) {
                failed++;
                console.error('ZIP fetch error:', err);
                button.textContent = completed + '/' + total;
            }
        });

        if (INCLUDE_METADATA_SIDECARS) {
            files['post_metadata.json'] = utf8Encode(JSON.stringify({
                postId: postId || '',
                itemCount: savedItems.length,
                savedAt: new Date().toISOString(),
                items: savedItems.map(function (item) {
                    return buildMetadataObject(item, postId);
                })
            }, null, 2));
        }

        try {
            const zipped = createStoredZip(files);
            const blob = new Blob([zipped], { type: 'application/zip' });
            saveBlob(blob, zipName);
            button.textContent = failed > 0 ? 'ZIP!' : 'OK!';
        } catch (err) {
            console.error('ZIP build error:', err);
            button.textContent = 'ERR';
        } finally {
            setTimeout(function () {
                button.disabled = false;
                button.style.pointerEvents = 'auto';
                button.textContent = originalText || 'ZIP';
            }, 1800);
        }
    }

    function startDownloads(media, postId, button) {
        const all = prepareDownloadItems(Array.isArray(media && media.object) ? media.object : []);
        if (all.length === 0) return;

        const originalMarkup = button.innerHTML;
        let settled = 0;
        let failed = 0;
        const total = all.length;

        button.textContent = `0/${total}`;
        button.style.pointerEvents = 'none';
        button.disabled = true;

        const onSettled = function (didFail) {
            settled++;
            if (didFail) failed++;
            button.textContent = `${settled}/${total}`;
            if (settled === total) {
                setTimeout(function () {
                    button.textContent = failed > 0 ? 'ERR' : 'OK!';
                    setTimeout(function () {
                        button.disabled = false;
                        button.style.pointerEvents = 'auto';
                        button.innerHTML = originalMarkup;
                    }, 1200);
                }, 500);
            }
        };

        all.forEach(function (item) {
            downloadFile(item, {
                onload: function () {
                    if (INCLUDE_METADATA_SIDECARS) {
                        try {
                            downloadMetadataSidecar(item, postId);
                        } catch (err) {
                            console.error('Metadata sidecar error:', err);
                        }
                    }
                    onSettled(false);
                },
                onerror: function (error) {
                    console.error('Download error:', error, item && item.url);
                    onSettled(true);
                },
                ontimeout: function () {
                    console.error('Download timeout:', item && item.url);
                    onSettled(true);
                }
            });
        });
    }

    // -----------------------------
    // API response processing
    // -----------------------------

    function createMediaObject(source, fallbackParent) {
        if (!source) return null;

        const url = source.hdMediaUrl || source.mediaUrl || source.url || source.originalUrl || source.downloadUrl || source.assetUrl;
        if (!url) return null;

        const mimeType = source.mimeType || inferMimeTypeFromUrl(url);
        const isVideo =
            (source.mediaType || source.type || '') === 'MEDIA_POST_TYPE_VIDEO' ||
            (source.mediaType || source.type || '') === 'video' ||
            mimeType.startsWith('video/');

        const parentPostId =
            fallbackParent?.id ||
            source.postId ||
            source.id ||
            extractPostIdFromUrl(url) ||
            ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('media_' + Date.now()));

        const rawPrompt = source.originalPrompt || source.prompt || source.textPrompt || '';
        const directPrompt = isLikelyRealPrompt(rawPrompt) ? normalizePrompt(rawPrompt) : '';

        const item = mergeMediaFields(getExactMetadataForUrl(url) || null, {
            id: source.id || source.postId || source.mediaId || extractPostIdFromUrl(url) || parentPostId,
            parentPostId: parentPostId,
            url: url,
            createTime: source.createTime || source.createdAt || fallbackParent?.createTime || fallbackParent?.createdAt || '',
            modelName: source.modelName || source.model || fallbackParent?.modelName || fallbackParent?.model || '',
            prompt: directPrompt,
            isVideo: isVideo,
            mimeType: mimeType
        }, parentPostId);

        if (directPrompt || item.modelName || item.createTime) {
            rememberExactMediaMetadata(url, {
                id: item.id,
                parentPostId: item.parentPostId,
                createTime: item.createTime,
                modelName: item.modelName,
                prompt: directPrompt,
                mimeType: item.mimeType,
                isVideo: item.isVideo
            }, {
                promptConfidence: directPrompt ? 6 : 0
            });
        }

        return item;
    }

    function looksLikePostObject(obj) {
        return !!obj && typeof obj === 'object' && (
            !!obj.mediaUrl ||
            !!obj.hdMediaUrl ||
            !!obj.url ||
            !!obj.originalUrl ||
            !!obj.downloadUrl ||
            !!obj.assetUrl ||
            Array.isArray(obj.childPosts) ||
            Array.isArray(obj.children) ||
            Array.isArray(obj.variations) ||
            Array.isArray(obj.items) ||
            Array.isArray(obj.media)
        );
    }

    function hasRelevantApiShape(node, depth) {
        if (!node || typeof node !== 'object' || depth > 5) return false;
        if (looksLikePostObject(node)) return true;

        if (Array.isArray(node)) {
            const limit = Math.min(node.length, 6);
            for (let i = 0; i < limit; i++) {
                if (hasRelevantApiShape(node[i], depth + 1)) return true;
            }
            return false;
        }

        const shallowKeys = ['posts', 'items', 'results', 'data', 'media', 'childPosts', 'children', 'variations'];
        for (const key of shallowKeys) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            const value = node[key];
            if (looksLikePostObject(value)) return true;
            if (Array.isArray(value) && value.length > 0) return true;
        }

        return false;
    }

    function collectCandidatePosts(node, results, seen, depth) {
        if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
        seen.add(node);

        if (Array.isArray(node)) {
            for (const item of node) collectCandidatePosts(item, results, seen, depth + 1);
            return;
        }

        if (looksLikePostObject(node)) results.push(node);
        for (const value of Object.values(node)) collectCandidatePosts(value, results, seen, depth + 1);
    }

    function processSinglePost(post) {
        if (!post) return false;

        const postId = post.id || post.postId || extractPostIdFromUrl(post.mediaUrl) || extractPostIdFromUrl(post.url);
        if (!postId) return false;

        const items = [];

        if (post.mediaUrl || post.hdMediaUrl || post.url) {
            const item = createMediaObject(post, null);
            if (item) items.push(item);
        }

        const childCollections = [post.childPosts, post.children, post.variations, post.items, post.media].filter(Array.isArray);
        for (const children of childCollections) {
            for (const child of children) {
                const item = createMediaObject(child, post);
                if (item) items.push(item);
            }
        }

        const before = JSON.stringify(mediaDatabase.get(postId)?.object || []);
        upsertMediaItems(postId, items);
        const after = JSON.stringify(mediaDatabase.get(postId)?.object || []);
        return before !== after;
    }

    function processApiData(apiData) {
        if (!apiData || !hasRelevantApiShape(apiData, 0)) return false;

        const candidates = [];
        collectCandidatePosts(apiData, candidates, new WeakSet(), 0);

        const seenIds = new Set();
        let changed = false;

        for (const post of candidates) {
            const key = (post && (post.id || post.postId || post.mediaUrl || post.hdMediaUrl || post.url)) || '';
            if (!key || seenIds.has(key)) continue;
            seenIds.add(key);
            if (processSinglePost(post)) changed = true;
        }

        return changed;
    }

    function shouldInspectJsonResponse(url, contentType) {
        if (!contentType || !contentType.includes('application/json')) return false;
        if (!url) return true;
        if (url.startsWith('blob:') || url.startsWith('data:')) return false;
        if (API_URL_HINTS.some(function (hint) { return url.includes(hint); })) return true;
        if (url.startsWith('/')) return true;
        return /https?:\/\/(?:[^/]+\.)?(grok\.com|x\.ai)\//i.test(url);
    }

    // -----------------------------
    // Detail page prompt scraping
    // -----------------------------

    function getDetailPagePostId() {
        const canonical = document.querySelector('link[rel="canonical"]');
        const fromCanonical = canonical && extractPostIdFromUrl(canonical.href || '');
        if (fromCanonical) return fromCanonical;
        return extractPostIdFromUrl(location.pathname);
    }

    function createDomMediaItem(url, postId) {
        if (!url) return null;

        const exactMeta = getExactMetadataForUrl(url) || {};
        const seed = getPostSeedMetadata(postId) || {};
        const mimeType = exactMeta.mimeType || inferMimeTypeFromUrl(url);
        const isVideo = typeof exactMeta.isVideo === 'boolean' ? exactMeta.isVideo : mimeType.startsWith('video/');

        return mergeMediaFields(exactMeta, {
            id: exactMeta.id || extractPostIdFromUrl(url) || postId,
            parentPostId: exactMeta.parentPostId || postId,
            url: url,
            createTime: exactMeta.createTime || seed.createTime || '',
            modelName: exactMeta.modelName || seed.modelName || '',
            prompt: exactMeta.prompt || '',
            isVideo: isVideo,
            mimeType: mimeType
        }, postId);
    }

    // Collect only the currently visible full-size media from the detail page.
    function collectCurrentDetailMedia(postId) {
        const root = document.querySelector('main article') || document.querySelector('article') || document;
        const urls = new Set();

        for (const video of Array.from(root.querySelectorAll('video'))) {
            const src = video.currentSrc || video.src || '';
            if (src && !src.includes('preview_image')) urls.add(src);

            const poster = video.poster || '';
            if (poster && !poster.includes('_thumbnail.jpg')) urls.add(poster);
        }

        for (const img of Array.from(root.querySelectorAll('img'))) {
            const src = img.currentSrc || img.src || '';
            if (!src || src.includes('preview_image') || src.includes('_thumbnail.jpg')) continue;
            urls.add(src);
        }

        return Array.from(urls).map(function (url) {
            return createDomMediaItem(url, postId);
        }).filter(Boolean);
    }

    function getDetailMediaSnapshot() {
        const current = collectCurrentDetailMedia(getDetailPagePostId() || '');
        return current.map(function (item) { return getMediaIdentity(item); }).filter(Boolean).sort().join('|');
    }

    // Build prompt candidates from the detail page only.
    function getDetailPromptCandidates() {
        const candidates = [];

        const metaDescription = document.querySelector('meta[name="description"]');
        const metaDescriptionText = normalizePrompt((metaDescription && metaDescription.content) || '');
        if (metaDescriptionText && !isGenericGrokDescription(metaDescriptionText)) {
            candidates.push(metaDescriptionText);
        }

        const ogDescription = document.querySelector('meta[property="og:description"]');
        const ogDescriptionText = normalizePrompt((ogDescription && ogDescription.content) || '');
        if (ogDescriptionText && !isGenericGrokDescription(ogDescriptionText)) {
            candidates.push(ogDescriptionText);
        }

        const article = document.querySelector('main article') || document.querySelector('article');
        if (article) {
            const selector = [
                'p',
                '[data-testid*="prompt"]',
                '[class*="prompt"]',
                '[class*="whitespace-pre-wrap"]',
                '[class*="break-words"]'
            ].join(', ');

            for (const node of Array.from(article.querySelectorAll(selector))) {
                const text = normalizePrompt(node.textContent || '');
                if (!text) continue;
                if (text.length < 12 || text.length > 3000) continue;
                if (isGenericGrokDescription(text)) continue;
                if (countUiControlTokens(text) >= 2) continue;
                if (/^(grok|download|zip|share|copy|retry|edit|delete|home|search|more|video|image|unmute)$/i.test(text)) continue;
                candidates.push(text);
            }
        }

        const title = normalizePrompt(document.title || '');
        if (title && !isGenericGrokDescription(title)) {
            candidates.push(title);
        }

        return Array.from(new Set(candidates.map(normalizePrompt).filter(Boolean)));
    }

    function pickBestDetailPrompt() {
        const metaDescription = document.querySelector('meta[name="description"]');
        const metaDescriptionText = normalizePrompt((metaDescription && metaDescription.content) || '');
        if (isLikelyRealPrompt(metaDescriptionText)) {
            return metaDescriptionText;
        }

        const candidates = getDetailPromptCandidates();
        const real = candidates.filter(isLikelyRealPrompt);
        if (real.length === 0) return '';

        real.sort(function (a, b) {
            const scoreA = countUiControlTokens(a) * 1000 + a.length;
            const scoreB = countUiControlTokens(b) * 1000 + b.length;
            return scoreA - scoreB;
        });

        return real[0];
    }

    // Map the current visible prompt to the current visible media URLs.
    function captureDetailPromptForVisibleMedia(postId) {
        if (!/\/imagine\/post\//.test(location.pathname)) return false;

        const prompt = pickBestDetailPrompt();
        if (!isLikelyRealPrompt(prompt)) return false;

        const current = collectCurrentDetailMedia(postId);
        const detailPostId = getDetailPagePostId() || postId;
        let changed = false;

        for (const item of current) {
            if (!item || !item.url) continue;

            if (rememberExactMediaMetadata(item.url, {
                id: item.id || extractPostIdFromUrl(item.url) || detailPostId,
                parentPostId: detailPostId,
                createTime: item.createTime || '',
                modelName: item.modelName || '',
                prompt: prompt,
                mimeType: item.mimeType || inferMimeTypeFromUrl(item.url),
                isVideo: item.isVideo
            }, {
                promptConfidence: 10
            })) {
                changed = true;
            }
        }

        if (changed) log('detail prompt mapped', detailPostId, prompt.slice(0, 80));
        return changed;
    }

    async function waitForDetailPromptOrMedia(previousSnapshot, previousPrompt, postId) {
        const timeout = Date.now() + Math.max(DETAIL_MEDIA_WAIT_TIMEOUT, DETAIL_PROMPT_WAIT_TIMEOUT);
        let snapshot = previousSnapshot;
        let prompt = previousPrompt;

        while (Date.now() < timeout) {
            const currentSnapshot = getDetailMediaSnapshot();
            const currentPrompt = pickBestDetailPrompt();

            if (currentSnapshot && currentSnapshot !== snapshot) {
                snapshot = currentSnapshot;
                await sleep(80);
                captureDetailPromptForVisibleMedia(postId);
                return {
                    snapshot: currentSnapshot,
                    prompt: pickBestDetailPrompt() || currentPrompt
                };
            }

            if (currentPrompt && currentPrompt !== prompt && isLikelyRealPrompt(currentPrompt)) {
                prompt = currentPrompt;
                captureDetailPromptForVisibleMedia(postId);
                return {
                    snapshot: currentSnapshot || snapshot,
                    prompt: currentPrompt
                };
            }

            await sleep(80);
        }

        captureDetailPromptForVisibleMedia(postId);
        return {
            snapshot: getDetailMediaSnapshot() || snapshot,
            prompt: pickBestDetailPrompt() || prompt
        };
    }

    function mergeMediaIntoDatabase(postId, items) {
        if (!postId || !Array.isArray(items) || items.length === 0) return null;
        return upsertMediaItems(postId, items) || mediaDatabase.get(postId) || null;
    }

    async function collectAllDetailMedia(postId) {
        const detailPostId = getDetailPagePostId() || postId;
        const collected = [];

        function addCurrent() {
            const current = collectCurrentDetailMedia(detailPostId);
            for (const item of current) {
                if (!hasMediaItem(collected, item)) collected.push(item);
            }
        }

        captureDetailPromptForVisibleMedia(detailPostId);
        addCurrent();

        const thumbButtons = Array.from(new Set(
            Array.from(document.querySelectorAll('button img[alt^="Thumbnail"], button img[src*="/generated/"]'))
                .map(function (img) { return img.closest('button'); })
                .filter(Boolean)
        ));

        let snapshot = getDetailMediaSnapshot();
        let prompt = pickBestDetailPrompt();

        for (const thumb of thumbButtons) {
            thumb.click();
            const settled = await waitForDetailPromptOrMedia(snapshot, prompt, detailPostId);
            snapshot = settled.snapshot || snapshot;
            prompt = settled.prompt || prompt;
            captureDetailPromptForVisibleMedia(detailPostId);
            addCurrent();
        }

        captureDetailPromptForVisibleMedia(detailPostId);
        addCurrent();
        return mergeMediaIntoDatabase(detailPostId, collected) || mediaDatabase.get(detailPostId);
    }

    function getLargestKnownBundleForIds(ids) {
        let best = null;
        for (const id of ids) {
            if (!id) continue;
            const media = mediaDatabase.get(id);
            if (!media || !Array.isArray(media.object) || media.object.length === 0) continue;
            if (!best || media.object.length > best.object.length) best = media;
        }
        return best;
    }

    function getDetailCandidateIds(originalPostId) {
        const ids = new Set();
        if (originalPostId) ids.add(originalPostId);

        const canonicalId = getDetailPagePostId();
        if (canonicalId) ids.add(canonicalId);

        for (const el of Array.from(document.querySelectorAll('main article img, main article video, button img[alt^="Thumbnail"], button img[src*="/generated/"]'))) {
            const src = el.currentSrc || el.src || el.poster || '';
            const id = extractPostIdFromUrl(src);
            if (id) ids.add(id);
        }

        return Array.from(ids);
    }

    function aliasBundleToIds(bundle, ids) {
        if (!bundle || !Array.isArray(bundle.object) || bundle.object.length === 0) return bundle;
        for (const id of ids) {
            if (!id) continue;
            mergeMediaIntoDatabase(id, bundle.object);
        }
        return bundle;
    }

    // Open detail page if needed, walk thumbnails, capture prompt/media mappings, then go back.
    async function resolveMediaFromDetailView(card, postId) {
        const alreadyOnDetailPage = /\/imagine\/post\//.test(location.pathname);
        const previousPath = location.pathname + location.search + location.hash;

        if (!alreadyOnDetailPage) {
            log('detail resolve: opening card', postId);
            card.click();
            await waitFor(function () {
                return /\/imagine\/post\//.test(location.pathname) || document.querySelector('main article video, main article img');
            }, 8000, 100);
        }

        const detailReady = await waitFor(function () {
            return document.querySelector('main article video, main article img');
        }, 8000, 120);

        if (!detailReady) {
            log('detail resolve: detail not ready', postId);
            return mediaDatabase.get(postId) || null;
        }

        const detailPostId = getDetailPagePostId() || postId;
        captureDetailPromptForVisibleMedia(detailPostId);

        const candidateIdsBefore = getDetailCandidateIds(detailPostId);
        let resolved = getLargestKnownBundleForIds(candidateIdsBefore);

        if (!resolved || !Array.isArray(resolved.object) || resolved.object.length <= 1) {
            resolved = await collectAllDetailMedia(detailPostId);
        }

        captureDetailPromptForVisibleMedia(detailPostId);

        const candidateIdsAfter = getDetailCandidateIds(detailPostId);
        const allCandidateIds = Array.from(new Set([].concat(candidateIdsBefore, candidateIdsAfter, [detailPostId, postId])));
        const largestResolved = getLargestKnownBundleForIds(allCandidateIds) || resolved;

        if (largestResolved && Array.isArray(largestResolved.object) && largestResolved.object.length > 0) {
            aliasBundleToIds(largestResolved, allCandidateIds);
            resolved = mediaDatabase.get(detailPostId) || mediaDatabase.get(postId) || largestResolved;
        }

        if (!alreadyOnDetailPage) {
            const backLink = document.querySelector('a[href="/imagine/saved"]');
            if (backLink) {
                backLink.click();
                await waitFor(function () {
                    return location.pathname === '/imagine/saved' || (location.pathname + location.search + location.hash) === previousPath;
                }, 5000, 100);
            } else {
                history.back();
                await waitFor(function () {
                    return location.pathname === '/imagine/saved' || (location.pathname + location.search + location.hash) === previousPath;
                }, 5000, 100);
            }
        }

        log('detail resolve: done', detailPostId, resolved && resolved.object && resolved.object.length);
        return mediaDatabase.get(detailPostId) || mediaDatabase.get(postId) || resolved || null;
    }

    function shouldResolveViaDetail(media) {
        if (location.pathname === '/imagine/saved') return true;
        if (!media || !Array.isArray(media.object) || media.object.length === 0) return true;
        if (media._isFallback) return true;
        if (media.object.some(function (item) { return !item.prompt; })) return true;
        return false;
    }

    // -----------------------------
    // Card UI injection
    // -----------------------------

    function processCards() {
        const cards = document.querySelectorAll(CARD_SELECTOR);
        log('cards found', cards.length, 'media db size', mediaDatabase.size, 'exact meta size', mediaMetadataIndex.size);

        for (const rawCard of cards) {
            const card = findBestCardElement(rawCard);
            if (!card || card.hasAttribute('data-downloader-added')) continue;

            const img = card.querySelector('img');
            const video = card.querySelector('video');
            if (!img && !video) continue;

            const postId = getPostIdFromCard(card);
            if (!postId) continue;

            let media = mediaDatabase.get(postId);

            // Fallback preview entry so buttons still appear before full metadata is known.
            if ((!media || !Array.isArray(media.object) || media.object.length === 0) && img && (img.currentSrc || img.src)) {
                const previewUrl = img.currentSrc || img.src;
                media = {
                    id: postId,
                    _isFallback: true,
                    object: [createDomMediaItem(previewUrl, postId)]
                };
                mediaDatabase.set(postId, media);
                log('fallback preview media created for', postId);
            }

            if (!media || !Array.isArray(media.object) || media.object.length === 0) continue;

            const container = ensureButtonContainer(card);
            if (!container) continue;
            card.setAttribute('data-downloader-added', 'true');

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = DOWNLOAD_ICON;
            btn.className = BUTTON_CLASSES;
            btn.style.position = 'relative';
            btn.style.zIndex = '10000';
            btn.title = 'Download media files';

            btn.addEventListener('click', async function (e) {
                e.preventDefault();
                e.stopPropagation();

                let latestMedia = mediaDatabase.get(postId) || media;

                if (shouldResolveViaDetail(latestMedia)) {
                    const originalMarkup = btn.innerHTML;
                    btn.textContent = '...';
                    btn.disabled = true;

                    try {
                        const resolvedMedia = await resolveMediaFromDetailView(card, postId);
                        if (resolvedMedia && Array.isArray(resolvedMedia.object) && resolvedMedia.object.length > 0) {
                            latestMedia = resolvedMedia;
                            btn.title = 'Download ' + latestMedia.object.length + ' media files';
                            zipBtn.title = 'Download ZIP of ' + latestMedia.object.length + ' media files';
                        }
                    } catch (err) {
                        console.error('Detail resolve error:', err);
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = originalMarkup;
                    }
                }

                startDownloads(latestMedia, postId, btn);
            });

            const zipBtn = document.createElement('button');
            zipBtn.type = 'button';
            zipBtn.textContent = 'ZIP';
            zipBtn.className = ZIP_BUTTON_CLASSES;
            zipBtn.style.position = 'relative';
            zipBtn.style.zIndex = '10000';
            zipBtn.title = 'Download ZIP';

            zipBtn.addEventListener('click', async function (e) {
                e.preventDefault();
                e.stopPropagation();

                let latestMedia = mediaDatabase.get(postId) || media;

                if (shouldResolveViaDetail(latestMedia)) {
                    const originalText = zipBtn.textContent;
                    zipBtn.textContent = 'OPEN';
                    zipBtn.disabled = true;

                    try {
                        const resolvedMedia = await resolveMediaFromDetailView(card, postId);
                        if (resolvedMedia && Array.isArray(resolvedMedia.object) && resolvedMedia.object.length > 0) {
                            latestMedia = resolvedMedia;
                            btn.title = 'Download ' + latestMedia.object.length + ' media files';
                            zipBtn.title = 'Download ZIP of ' + latestMedia.object.length + ' media files';
                        }
                    } catch (err) {
                        console.error('Detail resolve error:', err);
                    } finally {
                        zipBtn.disabled = false;
                        zipBtn.textContent = originalText || 'ZIP';
                    }
                }

                await startZipDownload(latestMedia, postId, zipBtn);
            });

            container.prepend(zipBtn);
            container.prepend(btn);
            log('button added for postId', postId, media.object.length);
        }
    }

    function findBestCardElement(node) {
        if (!(node instanceof Element)) return null;

        const selectors = [
            'div.relative.cursor-pointer',
            'div[class*="group/"]',
            'article',
            'a[href*="/imagine/"]',
            'div[data-post-id]'
        ].join(', ');

        const found = node.closest(selectors);
        if (!found) return null;
        if (!found.querySelector('img, video')) return null;
        return found;
    }

    function ensureButtonContainer(card) {
        let container = card.querySelector(BUTTON_CONTAINER_SELECTOR);
        if (container) return container;

        if (getComputedStyle(card).position === 'static') {
            card.style.position = 'relative';
        }

        container = document.createElement('div');
        container.className = 'grok-downloader-container';
        container.style.position = 'absolute';
        container.style.right = '8px';
        container.style.bottom = '8px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.pointerEvents = 'auto';
        card.appendChild(container);
        return container;
    }

    function getPostIdFromCard(card) {
        const img = card.querySelector('img');
        const video = card.querySelector('video');
        const link = card.closest('a[href*="/imagine/"]') || card.querySelector('a[href*="/imagine/"]');

        const candidates = [
            card.getAttribute('data-post-id'),
            card.getAttribute('data-id'),
            card.getAttribute('href'),
            link && link.href,
            img && img.src,
            img && img.currentSrc,
            img && img.dataset && img.dataset.src,
            img && img.dataset && img.dataset.lazy,
            video && video.poster,
            video && video.src,
            video && video.dataset && video.dataset.src,
            video && video.dataset && video.dataset.lazy,
            card.innerHTML
        ].filter(Boolean);

        for (const candidate of candidates) {
            const id = extractPostIdFromUrl(candidate);
            if (id) return id;
        }

        const generatedMatch = (img && (img.currentSrc || img.src || '') || '').match(/\/generated\/([a-f0-9-]{36})\//i);
        if (generatedMatch) return generatedMatch[1];

        return null;
    }

    // -----------------------------
    // Network interception
    // -----------------------------

    // Mirror Grok's JSON responses into the local media cache without altering page behavior.
    const origFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function (input, options) {
        const resp = await origFetch(input, options);

        try {
            const url = typeof input === 'string' ? input : input && input.url || '';
            const contentType = resp.headers.get('content-type') || '';

            if (shouldInspectJsonResponse(url, contentType)) {
                const clone = resp.clone();
                const data = await clone.json();
                const dbChanged = processApiData(data);
                if (dbChanged) {
                    debouncedProcessCards();
                    log('fetch matched', url);
                }
            }
        } catch (e) {
            console.error('API intercept error:', e);
        }

        return resp;
    };

    const origXHROpen = unsafeWindow.XMLHttpRequest && unsafeWindow.XMLHttpRequest.prototype.open;
    const origXHRSend = unsafeWindow.XMLHttpRequest && unsafeWindow.XMLHttpRequest.prototype.send;

    if (origXHROpen && origXHRSend) {
        unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
            this._grokUrl = url;
            return origXHROpen.apply(this, arguments);
        };

        unsafeWindow.XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                try {
                    const url = this._grokUrl || '';
                    const contentType = this.getResponseHeader('content-type') || '';

                    if (shouldInspectJsonResponse(url, contentType)) {
                        const data = JSON.parse(this.responseText);
                        const dbChanged = processApiData(data);
                        if (dbChanged) {
                            debouncedProcessCards();
                            log('xhr matched', url);
                        }
                    }
                } catch (e) {
                    console.error('XHR intercept error:', e);
                }
            });

            return origXHRSend.apply(this, arguments);
        };
    }

    // -----------------------------
    // DOM observation
    // -----------------------------

    let debounceTimer;
    const debouncedProcessCards = function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processCards, 120);
    };

    const observer = new MutationObserver(function () {
        debouncedProcessCards();

        // While on the detail page, keep refreshing prompt -> visible media mapping.
        if (/\/imagine\/post\//.test(location.pathname)) {
            const postId = getDetailPagePostId();
            if (postId) captureDetailPromptForVisibleMedia(postId);
        }
    });

    function startObserver() {
        const target = document.body || document.documentElement;
        if (!target) return false;

        observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data-src', 'data-lazy', 'poster', 'href', 'content']
        });

        debouncedProcessCards();

        if (/\/imagine\/post\//.test(location.pathname)) {
            const postId = getDetailPagePostId();
            if (postId) captureDetailPromptForVisibleMedia(postId);
        }

        log('observer started');
        return true;
    }

    if (!startObserver()) {
        window.addEventListener('DOMContentLoaded', function () {
            startObserver();
        }, { once: true });
    }
})();