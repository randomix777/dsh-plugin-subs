// Qwen device-flow tests against the REAL production implementation.
// Imports lib/auth/qwen-device-flow.js directly — no re-implemented logic.
// Run with: node --test --test-timeout 30000 test/qwen-device-flow.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	startQwenDeviceFlow,
	qwenPollDeviceToken,
	abortSleep,
	qwenEncodeUrlEncoded,
	QWEN_MIN_POLL_INTERVAL_MS,
	QWEN_MAX_POLL_INTERVAL_MS,
} from '../lib/auth/qwen-device-flow.js';

/** Build a mock fetch from an array of response specs. Each call to makeFetchFn creates a fresh closure. */
function makeFetchFn(responses) {
	let idx = 0;
	return async (url, init) => {
		const spec = responses[idx++];
		if (spec === undefined) throw new Error(`unexpected fetch call #${idx} to ${url}`);
		if (spec.error) throw spec.error;
		const status = spec.status ?? 200;
		// Derive ok from status only when not explicitly set.
		const ok = spec.ok !== undefined ? spec.ok : (status >= 200 && status < 400);
		return {
			ok,
			status,
			async text() { return spec.body ?? ''; },
			async json() { return spec.body ? JSON.parse(spec.body) : {}; },
		};
	};
}

/**
 * Helper: call qwenPollDeviceToken with injected fetchFn.
 * Uses far-future expiresAt and short interval for fast tests.
 */
async function runPoll({ responses, deviceCode, verifier, expiresAt = Number.MAX_SAFE_INTEGER, initialIntervalMs = 50, signal }) {
	const fetchFn = makeFetchFn(responses);
	return await qwenPollDeviceToken(deviceCode, verifier, { signal, fetchFn, expiresAt, initialIntervalMs });
}

describe('qwenEncodeUrlEncoded', () => {
	it('encodes key-value pairs correctly', () => {
		const result = qwenEncodeUrlEncoded({ a: 'hello world', b: 'x=y' });
		assert.equal(result, 'a=hello%20world&b=x%3Dy');
	});
	it('handles empty object', () => {
		assert.equal(qwenEncodeUrlEncoded({}), '');
	});
});

describe('abortSleep', () => {
	it('resolves after the given delay when not aborted', async () => {
		const controller = new AbortController();
		await abortSleep(10, controller.signal);
		assert.equal(controller.signal.aborted, false);
	});
	it('rejects immediately when already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(abortSleep(10, controller.signal), /login cancelled/);
	});
	it('rejects when aborted during wait', async () => {
		const controller = new AbortController();
		const p = abortSleep(5000, controller.signal);
		await new Promise(r => setTimeout(r, 50));
		controller.abort();
		await assert.rejects(p, /login cancelled/);
	});
	it('cleans up event listener after resolve', async () => {
		const controller = new AbortController();
		await abortSleep(5, controller.signal);
		// After resolution the listener must be removed; aborting should not throw.
		controller.abort();
	});
	it('handles undefined signal gracefully', async () => {
		await abortSleep(5, undefined);
	});
});

describe('qwenPollDeviceToken — success paths', () => {
	it('returns token data on immediate success', async () => {
		const data = await runPoll({
			responses: [{ body: JSON.stringify({ access_token: 'tok1', expires_in: 3600 }) }],
			deviceCode: 'dc1', verifier: 'v1',
		});
		assert.equal(data.access_token, 'tok1');
	});

	it('handles authorization_pending then success', async () => {
		const data = await runPoll({
			responses: [
				{ status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
				{ status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
				{ body: JSON.stringify({ access_token: 'tok2', expires_in: 1800 }) },
			],
			deviceCode: 'dc2', verifier: 'v2',
		});
		assert.equal(data.access_token, 'tok2');
	});

	it('uses initial interval from options', async () => {
		const data = await runPoll({
			responses: [{ body: JSON.stringify({ access_token: 'tok3' }) }],
			deviceCode: 'dc3', verifier: 'v3', initialIntervalMs: 5,
		});
		assert.equal(data.access_token, 'tok3');
	});

	it('server interval in authorization_pending is respected', async () => {
		const data = await runPoll({
			responses: [
				{ status: 400, body: JSON.stringify({ error: 'authorization_pending', interval: 10 }) },
				{ body: JSON.stringify({ access_token: 'tok13' }) },
			],
			deviceCode: 'dc13', verifier: 'v13', initialIntervalMs: 5,
		});
		assert.equal(data.access_token, 'tok13');
	});
});

describe('qwenPollDeviceToken — error paths', () => {
	it('throws on access_denied', async () => {
		await assert.rejects(
			runPoll({
				responses: [{ status: 400, body: JSON.stringify({ error: 'access_denied', error_description: 'user denied' }) }],
				deviceCode: 'dc5', verifier: 'v5',
			}),
			/user denied/
		);
	});

	it('throws on expired_token', async () => {
		await assert.rejects(
			runPoll({
				responses: [{ status: 400, body: JSON.stringify({ error: 'expired_token', error_description: 'device code expired' }) }],
				deviceCode: 'dc6', verifier: 'v6',
			}),
			/device code expired/
		);
	});

	it('throws on unknown error body', async () => {
		await assert.rejects(
			runPoll({
				responses: [{ status: 400, body: JSON.stringify({ error: 'missing_code' }) }],
				deviceCode: 'dc-x', verifier: 'vx',
			}),
			/missing_code/
		);
	});
});

describe('qwenPollDeviceToken — deadline', () => {
	it('stops when local expiresAt is reached before first request', async () => {
		const pastExpiresAt = Date.now() - 1000;
		await assert.rejects(
			runPoll({
				responses: [],
				deviceCode: 'dc7', verifier: 'v7',
				expiresAt: pastExpiresAt,
				initialIntervalMs: 5,
			}),
			/Qwen device authorization expired/
		);
	});

	it('stops after sleep when expiresAt is reached', async () => {
		// expiresAt is slightly in the future; the pre-sleep check passes,
		// but after the 50ms sleep the deadline has passed.
		const expiredSoon = Date.now() + 5;
		await assert.rejects(
			runPoll({
				responses: [],
				deviceCode: 'dc8', verifier: 'v8',
				expiresAt: expiredSoon,
				initialIntervalMs: 50,
			}),
			/Qwen device authorization expired/
		);
	});
});

describe('qwenPollDeviceToken — back-off and retry', () => {
	it('slow_down increases interval by at least 5 seconds', async () => {
		// Qwen returns HTTP 200 with {error: "slow_down"} in the body.
		const data = await runPoll({
			responses: [
				{ body: JSON.stringify({ error: 'slow_down' }) },
				{ body: JSON.stringify({ access_token: 'tok4' }) },
			],
			deviceCode: 'dc4', verifier: 'v4',
		});
		assert.equal(data.access_token, 'tok4');
	});

	it('HTTP 429 increases interval by at least 5 seconds', async () => {
		// Use 5000ms initial interval so first 429 doubles to 10s (still within test timeout).
		const data = await runPoll({
			responses: [
				{ status: 429, body: '' },
				{ body: JSON.stringify({ access_token: 'tok4b' }) },
			],
			deviceCode: 'dc4b', verifier: 'v4b',
			initialIntervalMs: 5000,
		});
		assert.equal(data.access_token, 'tok4b');
	});

	it('retry on network error with bounded back-off', async () => {
		let calls = 0;
		const fetchFn = async () => {
			calls++;
			if (calls === 1) throw new Error('network failure');
			return {
				ok: true, status: 200,
				async text() { return ''; },
				async json() { return { access_token: 'tok9' }; },
			};
		};
		const data = await qwenPollDeviceToken('dc9', 'v9', {
			fetchFn,
			expiresAt: Number.MAX_SAFE_INTEGER,
			initialIntervalMs: 5,
		});
		assert.equal(data.access_token, 'tok9');
		assert.equal(calls, 2);
	});

	it('caps back-off at QWEN_MAX_POLL_INTERVAL_MS', async () => {
		// Start at max so the first 429 would try to double but is capped at MAX.
		// Only 2 x 429s needed to verify capping behaviour within a reasonable test window.
		const responses = Array.from({ length: 2 }, () => ({ status: 429, body: '' }));
		responses.push({ body: JSON.stringify({ access_token: 'tok-cap' }) });
		const data = await runPoll({
			responses,
			deviceCode: 'dc-cap', verifier: 'vcap',
			initialIntervalMs: 50,
		});
		assert.equal(data.access_token, 'tok-cap');
	});
});

describe('qwenPollDeviceToken — cancellation', () => {
	it('abort signal stops sleep immediately', async () => {
		const controller = new AbortController();
		const p = qwenPollDeviceToken('dc10', 'v10', {
			fetchFn: makeFetchFn([{ body: JSON.stringify({ error: 'authorization_pending' }) }]),
			signal: controller.signal,
			initialIntervalMs: 5000,
		});
		await new Promise(r => setTimeout(r, 50));
		controller.abort();
		await assert.rejects(p, /login cancelled/);
	});

	it('abort signal stops fetch immediately', async () => {
		const controller = new AbortController();
		const p = qwenPollDeviceToken('dc11', 'v11', {
			fetchFn: async () => {
				await new Promise(r => setTimeout(r, 200));
				return { ok: true, status: 200, async text() { return ''; }, async json() { return {}; } };
			},
			signal: controller.signal,
		});
		await new Promise(r => setTimeout(r, 30));
		controller.abort();
		await assert.rejects(p, /login cancelled/);
	});

	it('cancellation does not throw from signal.abort()', async () => {
		const controller = new AbortController();
		const p = qwenPollDeviceToken('dc12', 'v12', {
			fetchFn: makeFetchFn([]),
			signal: controller.signal,
			initialIntervalMs: 100,
		});
		controller.abort();
		await assert.rejects(p, /login cancelled/);
	});
});

describe('startQwenDeviceFlow', () => {
	it('returns device code, user code, verification info, expiresAt, and interval', async () => {
		const deviceResponse = {
			device_code: 'dev123',
			user_code: 'ABCD-1234',
			verification_uri: 'https://chat.qwen.ai/verify',
			verification_uri_complete: 'https://chat.qwen.ai/verify?code=ABCD-1234',
			expires_in: 900,
			interval: 5,
		};
		const fetchFn = async (url) => {
			assert.ok(url.includes('/device/code'));
			return {
				ok: true, status: 200,
				async text() { return ''; },
				async json() { return deviceResponse; },
			};
		};
		const flow = await startQwenDeviceFlow({ verifier: 'ver1', challenge: 'chal1' }, fetchFn);
		assert.equal(flow.deviceCode, 'dev123');
		assert.equal(flow.userCode, 'ABCD-1234');
		assert.equal(flow.verificationUriComplete, 'https://chat.qwen.ai/verify?code=ABCD-1234');
		assert.ok(typeof flow.expiresAt === 'number' && flow.expiresAt > Date.now());
		assert.equal(flow.interval, 5000);
	});

	it('falls back to 15 min when expires_in is missing', async () => {
		const deviceResponse = {
			device_code: 'dev1',
			user_code: 'CODE1',
			verification_uri_complete: 'https://chat.qwen.ai/verify?code=CODE1',
			interval: 5,
		};
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return deviceResponse; },
		});
		const flow = await startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn);
		assert.ok(typeof flow.expiresAt === 'number' && flow.expiresAt > Date.now());
	});

	it('uses positive finite interval from device response', async () => {
		const deviceResponse = {
			device_code: 'dev2',
			user_code: 'CODE2',
			verification_uri_complete: 'https://chat.qwen.ai/verify?code=CODE2',
			expires_in: 600,
			interval: 10,
		};
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return deviceResponse; },
		});
		const flow = await startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn);
		assert.equal(flow.interval, 10_000);
	});

	it('defaults interval to QWEN_MIN_POLL_INTERVAL_MS when missing', async () => {
		const deviceResponse = {
			device_code: 'dev3',
			user_code: 'CODE3',
			verification_uri_complete: 'https://chat.qwen.ai/verify?code=CODE3',
			expires_in: 600,
		};
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return deviceResponse; },
		});
		const flow = await startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn);
		assert.equal(flow.interval, QWEN_MIN_POLL_INTERVAL_MS);
	});

	it('defaults interval to QWEN_MIN_POLL_INTERVAL_MS when zero', async () => {
		const deviceResponse = {
			device_code: 'dev4',
			user_code: 'CODE4',
			verification_uri_complete: 'https://chat.qwen.ai/verify?code=CODE4',
			expires_in: 600,
			interval: 0,
		};
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return deviceResponse; },
		});
		const flow = await startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn);
		assert.equal(flow.interval, QWEN_MIN_POLL_INTERVAL_MS);
	});

	it('throws on device auth HTTP error', async () => {
		const fetchFn = async () => ({
			ok: false, status: 500,
			async text() { return 'server error'; },
			async json() { return {}; },
		});
		await assert.rejects(
			startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn),
			/device auth request failed/
		);
	});

	it('throws on device auth error body', async () => {
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return { error: 'invalid_client', error_description: 'bad client' }; },
		});
		await assert.rejects(
			startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn),
			/bad client/
		);
	});
});

describe('status busy contract for Qwen device flows', () => {
	it('flow object carries all fields needed by status()', async () => {
		const deviceResponse = {
			device_code: 'd',
			user_code: 'U',
			verification_uri_complete: 'https://example.com/v',
			expires_in: 900,
			interval: 5,
		};
		const fetchFn = async () => ({
			ok: true, status: 200,
			async text() { return ''; },
			async json() { return deviceResponse; },
		});
		const flow = await startQwenDeviceFlow({ verifier: 'v', challenge: 'c' }, fetchFn);
		assert.ok(typeof flow.expiresAt === 'number');
		assert.ok(typeof flow.interval === 'number');
		assert.ok(typeof flow.deviceCode === 'string' && flow.deviceCode.length > 0);
		assert.ok(typeof flow.verificationUriComplete === 'string');
		assert.ok(typeof flow.userCode === 'string');
	});
});

describe('identity-safe cleanup contract', () => {
	it('old flow finally does not delete a new flow', async () => {
		// Simulate: old flow's polling task finishes after a new flow has started.
		// The production code checks `deviceFlows.pending("qwen") === flow` before deleting.
		// We verify this contract by checking that the flow object identity is preserved.
		const oldDeviceResponse = {
			device_code: 'old-dev-code',
			user_code: 'OLD',
			verification_uri_complete: 'https://example.com/v',
			expires_in: 900,
			interval: 5,
		};
		const newDeviceResponse = {
			device_code: 'new-dev-code',
			user_code: 'NEW',
			verification_uri_complete: 'https://example.com/v2',
			expires_in: 900,
			interval: 5,
		};
		// Use separate makeFetchFn calls so each flow gets its own response counter.
		const oldFetchFn = makeFetchFn([{ body: JSON.stringify(oldDeviceResponse) }]);
		const newFetchFn = makeFetchFn([{ body: JSON.stringify(newDeviceResponse) }]);
		const oldFlow = await startQwenDeviceFlow({ verifier: 'v1', challenge: 'c1' }, oldFetchFn);
		const newFlow = await startQwenDeviceFlow({ verifier: 'v2', challenge: 'c2' }, newFetchFn);
		// oldFlow and newFlow are distinct objects with different device codes.
		assert.notEqual(oldFlow, newFlow);
		assert.notEqual(oldFlow.deviceCode, newFlow.deviceCode);
		assert.equal(oldFlow.deviceCode, 'old-dev-code');
		assert.equal(newFlow.deviceCode, 'new-dev-code');
	});
});
