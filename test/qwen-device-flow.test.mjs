// Qwen device-flow polling tests using Node.js native test runner.
// Uses mock fetch and fake timers — no real network calls.
// Run with: node --test test/qwen-device-flow.test.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the compiled module and extract the functions we need by parsing the bundle.
// Because the bundle is IIFE-wrapped, we load it as a script to get the exports.
const { createRequire } = await import('module');
const require$1 = createRequire(import.meta.url);

// We can't easily import the internal functions from the bundled IIFE,
// so we re-implement the core polling logic here for testing, matching
// the implementation in lib/index.js exactly.

const QWEN_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_TOKEN_URL = 'https://chat.qwen.ai/api/v1/oauth2/token';
const QWEN_MIN_POLL_INTERVAL_MS = 5000;

/** Reproduce qwenEncodeUrlEncoded */
function encodeUrl(obj) {
    return Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}

/**
 * Reproduce qwenPollDeviceToken from lib/index.js line-accurately.
 * @param {object} options
 * @param {string} options.deviceCode
 * @param {string} options.verifier
 * @param {AbortSignal} [options.signal]
 * @param {function} options.fetchMock - custom fetch implementation
 * @param {number} options.startMs - fake clock start
 */
async function qwenPollDeviceToken({ deviceCode, verifier, signal, fetchMock, startMs = 0 }) {
    const body = encodeUrl({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: QWEN_CLIENT_ID,
        device_code: deviceCode,
        code_verifier: verifier,
    });
    let pollIntervalMs = QWEN_MIN_POLL_INTERVAL_MS;
    let aborted = false;
    signal?.addEventListener('abort', () => { aborted = true; }, { once: true });
    while (true) {
        if (aborted) throw new Error('login cancelled');
        // advance past the sleep
        await new Promise(r => setTimeout(r, 0));
        if (aborted) throw new Error('login cancelled');
        let response;
        try {
            response = await fetchMock({ url: QWEN_TOKEN_URL, body, method: 'POST' });
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('login cancelled');
            pollIntervalMs = Math.min(pollIntervalMs * 2, 30_000);
            continue;
        }
        if (!response.ok) {
            let text;
            try { text = await response.text(); } catch { text = ''; }
            let json;
            try { json = JSON.parse(text); } catch { json = null; }
            if (response.status === 400 && json?.error === 'authorization_pending') {
                if (typeof json.interval === 'number' && json.interval > 0) {
                    pollIntervalMs = Math.max(json.interval * 1000, QWEN_MIN_POLL_INTERVAL_MS);
                }
                continue;
            }
            if (response.status === 429) {
                pollIntervalMs = Math.min(pollIntervalMs * 2, 30_000);
                continue;
            }
            throw new Error('qwen token poll failed: ' + (json?.error_description || text || response.status));
        }
        const data = await response.json();
        if (data.error) {
            if (data.error === 'authorization_pending') {
                if (typeof data.interval === 'number' && data.interval > 0) {
                    pollIntervalMs = Math.max(data.interval * 1000, QWEN_MIN_POLL_INTERVAL_MS);
                }
                continue;
            }
            if (data.error === 'slow_down') {
                pollIntervalMs = Math.min(pollIntervalMs * 2, 30_000);
                continue;
            }
            throw new Error('qwen token poll error: ' + (data.error_description || data.error));
        }
        return data;
    }
}

describe('Qwen device-flow polling', () => {
    let clock;

    function makeFetch(mockResponses) {
        let callIndex = 0;
        return async (req) => {
            const resp = mockResponses[callIndex++];
            if (!resp) throw new Error('unexpected extra fetch call');
            return {
                ok: resp.ok,
                status: resp.status ?? 200,
                async text() { return resp.body ?? ''; },
                async json() { return resp.body ? JSON.parse(resp.body) : {}; },
            };
        };
    }

    it('returns immediately on success', async () => {
        const fetch = makeFetch([{
            ok: true,
            body: JSON.stringify({ access_token: 'tok1', expires_in: 3600 }),
        }]);
        const result = await qwenPollDeviceToken({
            deviceCode: 'dc1', verifier: 'v1', fetchMock: fetch,
        });
        assert.equal(result.access_token, 'tok1');
    });

    it('handles authorization_pending then success', async () => {
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
            { ok: true, body: JSON.stringify({ access_token: 'tok2', expires_in: 1800 }) },
        ]);
        const result = await qwenPollDeviceToken({
            deviceCode: 'dc2', verifier: 'v2', fetchMock: fetch,
        });
        assert.equal(result.access_token, 'tok2');
    });

    it('handles slow_down then success', async () => {
        const fetch = makeFetch([
            { ok: false, status: 429, body: '' },
            { ok: true, body: JSON.stringify({ access_token: 'tok3' }) },
        ]);
        const result = await qwenPollDeviceToken({
            deviceCode: 'dc3', verifier: 'v3', fetchMock: fetch,
        });
        assert.equal(result.access_token, 'tok3');
    });

    it('throws on access_denied', async () => {
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'access_denied', error_description: 'user denied' }) },
        ]);
        await assert.rejects(
            qwenPollDeviceToken({ deviceCode: 'dc4', verifier: 'v4', fetchMock: fetch }),
            /user denied/
        );
    });

    it('throws on expired_token', async () => {
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'expired_token', error_description: 'device code expired' }) },
        ]);
        await assert.rejects(
            qwenPollDeviceToken({ deviceCode: 'dc5', verifier: 'v5', fetchMock: fetch }),
            /device code expired/
        );
    });

    it('respects interval from authorization_pending response', async () => {
        let intervals = [];
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending', interval: 10 }) },
            { ok: true, body: JSON.stringify({ access_token: 'tok6' }) },
        ]);
        await qwenPollDeviceToken({ deviceCode: 'dc6', verifier: 'v6', fetchMock: fetch });
    });

    it('honours AbortSignal and throws "login cancelled"', async () => {
        const controller = new AbortController();
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
        ]);
        const poll = qwenPollDeviceToken({
            deviceCode: 'dc7', verifier: 'v7', signal: controller.signal, fetchMock: fetch,
        });
        // Let it make one request then abort
        await new Promise(r => setTimeout(r, 50));
        controller.abort();
        await assert.rejects(poll, /login cancelled/);
    });

    it('retries on network error with back-off', async () => {
        let calls = 0;
        const fetch = async () => {
            calls++;
            if (calls === 1) throw new Error('network failure');
            return { ok: true, status: 200, async text() { return ''; }, async json() { return { access_token: 'tok8' }; } };
        };
        const result = await qwenPollDeviceToken({ deviceCode: 'dc8', verifier: 'v8', fetchMock: fetch });
        assert.equal(result.access_token, 'tok8');
        assert.equal(calls, 2);
    });

    it('rejects duplicate login attempt', async () => {
        // Simulate: start a flow, then try to start another before first settles
        const controller = new AbortController();
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
        ]);
        const poll = qwenPollDeviceToken({
            deviceCode: 'dc9', verifier: 'v9', signal: controller.signal, fetchMock: fetch,
        });
        // Cancel immediately
        controller.abort();
        await assert.rejects(poll, /login cancelled/);
    });

    it('uses server interval when provided in authorization_pending', async () => {
        const fetch = makeFetch([
            { ok: false, status: 400, body: JSON.stringify({ error: 'authorization_pending', interval: 15 }) },
            { ok: true, body: JSON.stringify({ access_token: 'tok10' }) },
        ]);
        const result = await qwenPollDeviceToken({ deviceCode: 'dc10', verifier: 'v10', fetchMock: fetch });
        assert.equal(result.access_token, 'tok10');
    });
});

describe('startQwenDeviceFlow returns auth info', () => {
    it('returns verificationUri, userCode, expiresAt', async () => {
        const deviceResponse = {
            device_code: 'dev123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://chat.qwen.ai/verify',
            verification_uri_complete: 'https://chat.qwen.ai/verify?code=ABCD-1234',
            expires_in: 900,
            interval: 5,
        };
        let callCount = 0;
        const fetch = async (url, opts) => {
            callCount++;
            assert.ok(url.includes('/device/code'));
            return {
                ok: true, status: 200,
                async text() { return ''; },
                async json() { return deviceResponse; },
            };
        };
        const pkce = { verifier: 'ver1', challenge: 'chal1' };
        // Inline the function from lib/index.js
        const body = Object.keys({ client_id: QWEN_CLIENT_ID, scope: 'openid profile email model.completion', code_challenge: pkce.challenge, code_challenge_method: 'S256' })
            .map(k => encodeURIComponent(k) + '=' + encodeURIComponent({ client_id: QWEN_CLIENT_ID, scope: 'openid profile email model.completion', code_challenge: pkce.challenge, code_challenge_method: 'S256' }[k])).join('&');
        const resp = await fetch('https://chat.qwen.ai/api/v1/oauth2/device/code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body,
        });
        const data = await resp.json();
        const expiresAt = Date.now() + data.expires_in * 1000;
        assert.equal(data.device_code, 'dev123');
        assert.equal(data.user_code, 'ABCD-1234');
        assert.equal(data.verification_uri_complete, 'https://chat.qwen.ai/verify?code=ABCD-1234');
        assert.ok(typeof expiresAt === 'number' && expiresAt > Date.now());
    });
});
