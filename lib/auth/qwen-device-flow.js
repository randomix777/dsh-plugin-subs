/**
 * Qwen device-authorization flow (RFC 8628).
 *
 * Extracted from lib/index.js so the core polling logic can be tested in
 * isolation with injected dependencies (fetchFn, clock/now, sleep).
 */

/** Client id embedded from the Qwen Code desktop app. */
export const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
export const QWEN_DEVICE_CODE_URL = "https://chat.qwen.ai/api/v1/oauth2/device/code";
export const QWEN_TOKEN_URL = "https://chat.qwen.ai/api/v1/oauth2/token";
/** Minimum polling interval in milliseconds (RFC 8628 requires ≥5s). */
export const QWEN_MIN_POLL_INTERVAL_MS = 5000;
/** Maximum back-off cap in milliseconds. */
export const QWEN_MAX_POLL_INTERVAL_MS = 30_000;

/** Encode an object as x-www-form-urlencoded. */
export function qwenEncodeUrlEncoded(obj) {
	return Object.keys(obj).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k])).join("&");
}

/**
 * Request a device-authorization pair from the Qwen device-code endpoint.
 * @param pkce - { verifier, challenge } from createPkce().
 * @param fetchFn - injectable fetch implementation for tests.
 * @returns the parsed device-authorization response.
 */
export async function qwenRequestDeviceAuthorization(pkce, fetchFn = fetch) {
	const body = qwenEncodeUrlEncoded({
		client_id: QWEN_CLIENT_ID,
		scope: "openid profile email model.completion",
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
	});
	const response = await fetchFn(QWEN_DEVICE_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body,
	});
	if (!response.ok) throw new Error("qwen device auth request failed: " + response.status);
	const data = await response.json();
	if (data.error) throw new Error("qwen device auth: " + (data.error_description || data.error));
	return data;
}

/**
 * Start a Qwen device-authorization flow. Returns immediately with the
 * verification info; the caller is expected to run the background poll separately.
 * @param pkce - PKCE pair from createPkce().
 * @param fetchFn - injectable fetch implementation.
 * @returns flow info including expiresAt and the initial interval.
 */
export async function startQwenDeviceFlow(pkce, fetchFn = fetch) {
	const auth = await qwenRequestDeviceAuthorization(pkce, fetchFn);
	const expiresAt = typeof auth.expires_in === "number"
		? Date.now() + auth.expires_in * 1000
		: Date.now() + 900_000; // 15 min fallback
	const interval = typeof auth.interval === "number" && auth.interval > 0
		? Math.max(auth.interval * 1000, QWEN_MIN_POLL_INTERVAL_MS)
		: QWEN_MIN_POLL_INTERVAL_MS;
	return {
		deviceCode: auth.device_code,
		verificationUri: auth.verification_uri,
		verificationUriComplete: auth.verification_uri_complete,
		userCode: auth.user_code,
		expiresAt,
		interval,
		pkce,
	};
}

/**
 * Abort-aware sleep. Returns a promise that resolves after `ms` milliseconds
 * or rejects immediately when `signal` is aborted. Cleans up the listener.
 * @param ms - wait duration.
 * @param signal - AbortSignal to listen on.
 */
export function abortSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("login cancelled"));
			return;
		}
		const onAbort = () => {
			reject(new Error("login cancelled"));
			signal?.removeEventListener("abort", onAbort);
		};
		if (signal) signal.addEventListener("abort", onAbort, { once: true });
		setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
	});
}

/**
 * Poll the Qwen token endpoint using RFC 8628 device-authorization semantics.
 * Respects `expiresIn` (deadline), `initialIntervalMs`, `slow_down`, HTTP 429
 * with bounded back-off, and `AbortSignal` for cancellation.
 *
 * @param deviceCode - the device code from startQwenDeviceFlow.
 * @param verifier - the PKCE code verifier.
 * @param options - { signal, fetchFn, expiresAt, initialIntervalMs }
 * @returns the token response data.
 */
export async function qwenPollDeviceToken(deviceCode, verifier, options) {
	const { signal, fetchFn = fetch, expiresAt, initialIntervalMs } = options ?? {};
	const body = qwenEncodeUrlEncoded({
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		client_id: QWEN_CLIENT_ID,
		device_code: deviceCode,
		code_verifier: verifier,
	});
	let pollIntervalMs = typeof initialIntervalMs === "number" && initialIntervalMs > 0
		? initialIntervalMs
		: QWEN_MIN_POLL_INTERVAL_MS;
	while (true) {
		// Check deadline before every request and after every sleep.
		if (typeof expiresAt === "number" && Date.now() >= expiresAt) {
			throw new Error("Qwen device authorization expired");
		}
		await abortSleep(pollIntervalMs, signal);
		if (typeof expiresAt === "number" && Date.now() >= expiresAt) {
			throw new Error("Qwen device authorization expired");
		}
		let response;
		try {
			response = await fetchFn(QWEN_TOKEN_URL, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
				body,
				signal,
			});
		} catch (error) {
			if (error.name === "AbortError") throw new Error("login cancelled");
			// Transient network error: double interval with a cap, then retry.
			pollIntervalMs = Math.min(pollIntervalMs * 2, QWEN_MAX_POLL_INTERVAL_MS);
			continue;
		}
		if (!response.ok) {
			let text;
			try { text = await response.text(); } catch { text = ""; }
			let json;
			try { json = JSON.parse(text); } catch { json = null; }
			if (response.status === 400 && json?.error === "authorization_pending") {
				// Use server-intended interval if provided, else keep current.
				if (typeof json.interval === "number" && json.interval > 0) {
					pollIntervalMs = Math.max(json.interval * 1000, QWEN_MIN_POLL_INTERVAL_MS);
				}
				continue;
			}
			if (response.status === 429) {
				// slow_down / rate-limit: add at least 5s with a cap (RFC 8628).
				pollIntervalMs = Math.min(pollIntervalMs + 5_000, QWEN_MAX_POLL_INTERVAL_MS);
				continue;
			}
			throw new Error("qwen token poll failed: " + (json?.error_description || text || response.status));
		}
		const data = await response.json();
		if (data.error) {
			if (data.error === "authorization_pending") {
				if (typeof data.interval === "number" && data.interval > 0) {
					pollIntervalMs = Math.max(data.interval * 1000, QWEN_MIN_POLL_INTERVAL_MS);
				}
				continue;
			}
			if (data.error === "slow_down") {
				pollIntervalMs = Math.min(pollIntervalMs + 5_000, QWEN_MAX_POLL_INTERVAL_MS);
				continue;
			}
			throw new Error("qwen token poll error: " + (data.error_description || data.error));
		}
		return data;
	}
}
