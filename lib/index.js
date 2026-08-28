import z from "@deepseek-ai/schemastery";
import { CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE, ReasoningEffortId, attributionHeaders, errorChain, isContextWindowExceededError, isQuotaExceededError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/auth/pkce.ts
/**
* Base64url-encode without padding.
* @param buffer - raw bytes.
* @returns the RFC 4648 Â§5 encoding.
*/
function base64url(buffer) {
	return buffer.toString("base64url");
}
/**
* Mint a fresh PKCE pair (32-byte verifier, S256 challenge).
* @returns the pair for one authorization attempt.
*/
function createPkce() {
	const verifier = base64url(randomBytes(32));
	return {
		verifier,
		challenge: base64url(createHash("sha256").update(verifier).digest())
	};
}
/**
* Mint a URL-safe random token (default 16 bytes) for OAuth `state`.
* @param bytes - entropy length.
* @returns base64url-encoded random bytes.
*/
function randomToken(bytes = 32) {
	return base64url(randomBytes(bytes));
}
/**
* Mint lowercase-hex random bytes (for Grok's `nonce` parameter).
* @param bytes - entropy length; the hex string is twice as long.
* @returns hex-encoded random bytes.
*/
function randomHex(bytes = 8) {
	return randomBytes(bytes).toString("hex");
}

//#endregion
//#region src/auth/oauth-flow.ts
/** Default attempt lifetime: three minutes for the user to complete login. */
const DEFAULT_FLOW_TIMEOUT_MS = 18e4;
const SUCCESS_PAGE = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Login successful</title></head><body style=\"font-family:sans-serif\"><h1>Login successful</h1><p>You can close this tab and return to DeepSeek Harness.</p></body></html>";
function failurePage(detail) {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Login failed</title></head><body style="font-family:sans-serif"><h1>Login failed</h1><p>${detail.replace(/[<>&]/g, "")}</p></body></html>`;
}
/**
* Loopback addresses one listen host covers. `localhost` resolves to ::1 or
* 127.0.0.1 depending on the client, and Node binds exactly one of them per
* listen call â€” a browser picking the other family gets connection-refused
* and the login times out, so both families must serve the callback.
*/
function listenHosts(host) {
	return host === "localhost" ? ["127.0.0.1", "::1"] : [host];
}
/** True when the address family does not exist on this machine (safe to skip), unlike a taken port. */
function familyUnavailable(error) {
	const code = error.code;
	return code === "EADDRNOTAVAIL" || code === "EPROTONOSUPPORT";
}
/**
* Listen on the first port of the spec free on every loopback family;
* rejects when every port fails. Ephemeral ports (0) are retried so each
* family can be re-bound onto the first family's assigned port.
*/
async function listen(handler, spec) {
	const hosts = listenHosts(spec.host);
	const candidates = spec.ports.flatMap((port) => port === 0 ? [
		0,
		0,
		0
	] : [port]);
	let lastError;
	for (const candidate of candidates) {
		const servers = [];
		let port = candidate;
		let unusable = false;
		for (const host of hosts) {
			const server = createServer(handler);
			try {
				await new Promise((resolve, reject) => {
					const onError = (error) => reject(error);
					server.once("error", onError);
					server.listen(port, host, () => {
						server.removeListener("error", onError);
						resolve();
					});
				});
				const address = server.address();
				if (address === null) throw new Error(`callback server on ${host}:${port} has no address`);
				if (port === 0) port = address.port;
				servers.push(server);
			} catch (error) {
				server.close();
				if (familyUnavailable(error)) continue;
				lastError = error;
				unusable = true;
				break;
			}
		}
		if (unusable || servers.length === 0) {
			for (const server of servers) server.close();
			continue;
		}
		return {
			servers,
			port
		};
	}
	throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error(`callback server could not listen on ${spec.host} (ports ${spec.ports.join(", ")})`);
}
/**
* Own the set of in-flight login attempts, keyed by provider. One attempt per
* provider at a time; an attempt removes itself when it settles.
*/
var OAuthFlowManager = class {
	attempts = /* @__PURE__ */ new Map();
	/**
	* Whether a login attempt is running for one provider.
	* @param provider - the provider route.
	* @returns true while an attempt is waiting for its code.
	*/
	isBusy(provider) {
		return this.attempts.has(provider);
	}
	/**
	* The pending attempt for one provider, when any.
	* @param provider - the provider route.
	* @returns the in-flight attempt, or `undefined`.
	*/
	pending(provider) {
		return this.attempts.get(provider);
	}
	/**
	* Start a login attempt: mint PKCE/state, open the loopback callback
	* server, and build the authorize URL.
	* @param provider - the provider route (one attempt at a time).
	* @param spec - static flow facts for this provider.
	* @returns the live attempt; its `waitCode()` settles the login.
	* @throws when an attempt is already running or no callback port is free.
	*/
	async start(provider, spec) {
		if (this.attempts.has(provider)) throw new Error(`a ${provider} login attempt is already in progress`);
		const input = {
			redirectUri: "",
			state: randomToken(16),
			pkce: createPkce(),
			nonce: randomHex(8)
		};
		const timeoutMs = spec.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
		let resolveCode;
		let rejectCode;
		const codePromise = new Promise((resolve, reject) => {
			resolveCode = resolve;
			rejectCode = reject;
		});
		let settled = false;
		let timer;
		let servers = [];
		const handler = (request, response) => {
			const url = new URL(request.url ?? "/", "http://localhost");
			if (url.pathname !== spec.callbackPath) {
				response.writeHead(404, { "content-type": "text/plain" });
				response.end("not found");
				return;
			}
			const errorDescription = url.searchParams.get("error_description") ?? url.searchParams.get("error");
			if (errorDescription !== null) {
				response.writeHead(200, { "content-type": "text/html" });
				response.end(failurePage(errorDescription));
				settle(/* @__PURE__ */ new Error(`authorization failed: ${errorDescription}`));
				return;
			}
			if (url.searchParams.get("state") !== input.state) {
				response.writeHead(400, { "content-type": "text/plain" });
				response.end("state mismatch");
				return;
			}
			const code = url.searchParams.get("code");
			if (code === null || code.length === 0) {
				response.writeHead(400, { "content-type": "text/plain" });
				response.end("missing authorization code");
				return;
			}
			response.writeHead(200, { "content-type": "text/html" });
			response.end(SUCCESS_PAGE);
			settle(void 0, code);
		};
		const settle = (error, code) => {
			if (settled) return;
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			for (const server of servers) {
				server.close();
				server.closeAllConnections();
			}
			this.attempts.delete(provider);
			if (error !== void 0) rejectCode(error);
			else if (code !== void 0) resolveCode(code);
		};
		const bound = await listen(handler, spec.listen);
		servers = bound.servers;
		input.redirectUri = `http://${spec.listen.host}:${bound.port}${spec.callbackPath}`;
		timer = setTimeout(() => {
			settle(/* @__PURE__ */ new Error(`login timed out after ${Math.round(timeoutMs / 1e3)}s`));
		}, timeoutMs);
		timer.unref();
		const attempt = {
			authorizeUrl: spec.buildAuthorizeUrl(input),
			redirectUri: input.redirectUri,
			pkce: input.pkce,
			state: input.state,
			waitCode: () => codePromise,
			manual(rawInput) {
				if (settled) throw new Error(`the ${provider} login attempt already finished`);
				const trimmed = rawInput.trim();
				let code;
				let pastedState;
				if (/^https?:\/\//i.test(trimmed)) {
					const url = new URL(trimmed);
					code = url.searchParams.get("code") ?? void 0;
					pastedState = url.searchParams.get("state") ?? void 0;
				} else if (trimmed.includes("code=")) {
					const params = new URLSearchParams(trimmed);
					code = params.get("code") ?? void 0;
					pastedState = params.get("state") ?? void 0;
				} else if (trimmed.length > 0 && !/\s/.test(trimmed)) code = trimmed;
				if (code === void 0 || code.length === 0) throw new Error("no authorization code found in the pasted input");
				if (pastedState !== void 0 && pastedState !== input.state) throw new Error("state mismatch: the pasted URL belongs to a different login attempt");
				settle(void 0, code);
			},
			cancel() {
				settle(/* @__PURE__ */ new Error("login cancelled"));
			}
		};
		this.attempts.set(provider, attempt);
		return attempt;
	}
};

//#endregion
//#region src/auth/claude-code-creds.ts
const PRIMARY_SERVICE = "Claude Code-credentials";
const DEFAULT_SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";
function toSession(data) {
	if (typeof data.accessToken !== "string" || typeof data.refreshToken !== "string" || typeof data.expiresAt !== "number") return;
	const scopes = Array.isArray(data.scopes) ? data.scopes.join(" ") : typeof data.scopes === "string" ? data.scopes : DEFAULT_SCOPES;
	return {
		accessToken: data.accessToken,
		refreshToken: data.refreshToken,
		expiresAt: Math.trunc(data.expiresAt),
		scopes,
		...typeof data.emailAddress === "string" ? { emailAddress: data.emailAddress } : {},
		...typeof data.subscriptionType === "string" ? { subscriptionType: data.subscriptionType } : {}
	};
}
function parseBlob(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	return toSession(parsed.claudeAiOauth ?? parsed);
}
function credentialsFilePath() {
	return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".credentials.json");
}
function readKeychainRaw() {
	try {
		return execFileSync("/usr/bin/security", [
			"find-generic-password",
			"-s",
			PRIMARY_SERVICE,
			"-w"
		], {
			timeout: 3e3,
			encoding: "utf8",
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		}).trim();
	} catch {
		return;
	}
}
function readFileRaw() {
	try {
		return readFileSync(credentialsFilePath(), "utf8");
	} catch {
		return;
	}
}
/** Read the current Claude Code session from its source of truth: macOS Keychain, falling back to the credentials file. */
function readClaudeCodeCredentials() {
	if (process.platform === "darwin") {
		const raw$1 = readKeychainRaw();
		const session = raw$1 !== void 0 ? parseBlob(raw$1) : void 0;
		if (session) return session;
	}
	const raw = readFileRaw();
	return raw !== void 0 ? parseBlob(raw) : void 0;
}
function blobMatches(raw, expectedAccessToken) {
	return parseBlob(raw)?.accessToken === expectedAccessToken;
}
function getKeychainAccountName() {
	try {
		const output = execFileSync("/usr/bin/security", [
			"find-generic-password",
			"-s",
			PRIMARY_SERVICE
		], {
			timeout: 2e3,
			encoding: "utf8",
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		return /"acct"<blob>="([^"]*)"/.exec(output)?.[1];
	} catch {
		return;
	}
}
/** Merge fresh tokens into an existing raw blob, preserving unrelated fields. */
function mergeIntoBlob(existingRaw, next) {
	let parsed;
	try {
		parsed = JSON.parse(existingRaw);
	} catch {
		return;
	}
	const target = parsed.claudeAiOauth ?? parsed;
	target.accessToken = next.accessToken;
	target.refreshToken = next.refreshToken;
	target.expiresAt = next.expiresAt;
	return JSON.stringify(parsed);
}
/**
* Write a refreshed session back to Claude Code's own credential store, so
* the `claude` CLI and any other consumer of the same account see the token
* we just rotated. A stale-blob mismatch (something else rotated it first)
* is a no-op â€” the caller already has that other rotation via readClaudeCodeCredentials.
* @param next - the freshly refreshed session to persist.
* @param expectedPriorAccessToken - the access token this refresh started from.
* @returns whether the write-back succeeded.
*/
function writeBackClaudeCodeCredentials(next, expectedPriorAccessToken) {
	if (process.platform === "darwin") {
		const raw$1 = readKeychainRaw();
		if (raw$1 === void 0 || !blobMatches(raw$1, expectedPriorAccessToken)) return false;
		const updated$1 = mergeIntoBlob(raw$1, next);
		if (updated$1 === void 0) return false;
		const account = getKeychainAccountName() ?? PRIMARY_SERVICE;
		try {
			execFileSync("/usr/bin/security", [
				"add-generic-password",
				"-s",
				PRIMARY_SERVICE,
				"-a",
				account,
				"-w",
				updated$1,
				"-U"
			], {
				timeout: 2e3,
				stdio: "ignore"
			});
			return true;
		} catch {
			return false;
		}
	}
	const path = credentialsFilePath();
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return false;
	}
	if (!blobMatches(raw, expectedPriorAccessToken)) return false;
	const updated = mergeIntoBlob(raw, next);
	if (updated === void 0) return false;
	try {
		const dir = dirname(path);
		if (!existsSync(dir)) mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		writeFileSync(path, updated, {
			encoding: "utf8",
			mode: 384
		});
		chmodSync(path, 384);
		return true;
	} catch {
		return false;
	}
}
/**
* Refresh a Claude session, first checking whether Claude Code's own store
* already holds a fresher token (rotated by the `claude` CLI or another
* consumer) before hitting the OAuth endpoint ourselves â€” and writing our own
* refresh back to that store so every consumer of the account stays synced.
* @param session - the session TokenManager wants refreshed.
* @param doRefresh - the actual OAuth refresh-token grant (network call).
* @returns the freshest available session.
*/
async function refreshClaudeSynced(session, doRefresh) {
	const fromSource = readClaudeCodeCredentials();
	const base = fromSource !== void 0 && fromSource.accessToken !== session.accessToken ? fromSource : session;
	if (base.expiresAt > Date.now() + 6e4) return base;
	const next = await doRefresh(base);
	writeBackClaudeCodeCredentials(next, base.accessToken);
	return next;
}

//#endregion
//#region src/auth/store.ts
/** Every provider route, in display order. */
const PROVIDER_IDS = [
	"codex",
	"claude",
	"grok",
	"antigravity",
	"openrouter",
	"agnes"
];
/**
* Absolute path of the auth store file.
* @returns `dshHomePath('plugins', 'subscriptions', 'auth.json')`.
*/
function authFilePath() {
	return dshHomePath("plugins", "subscriptions", "auth.json");
}
/** Store location used before the plugin was renamed; migrated on first read. */
function legacyAuthFilePath() {
	return dshHomePath("plugins", "router", "auth.json");
}
/** Check that one durable entry carries the fields every session needs. */
function assertSessionShape(provider, value) {
	if (typeof value !== "object" || value === null) throw new Error(`subscriptions auth store: entry "${provider}" is not an object; fix or delete the store file`);
	const entry = value;
	if (typeof entry.accessToken !== "string" || entry.accessToken.length === 0 || typeof entry.refreshToken !== "string" || entry.refreshToken.length === 0 || typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt)) throw new Error(`subscriptions auth store: entry "${provider}" is missing accessToken/refreshToken/expiresAt; fix or delete the store file`);
}
/**
* Read the whole store. A missing file is an empty store; malformed JSON or a
* malformed entry throws, because silently discarding tokens would strand the
* user without a diagnosis.
* @param path - store file path; defaults to {@link authFilePath}.
* @returns the parsed session map.
*/
async function loadStore(path = authFilePath()) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		if (path !== authFilePath()) return {};
		try {
			text = await readFile(legacyAuthFilePath(), "utf8");
		} catch (legacyError) {
			if (legacyError.code === "ENOENT") return {};
			throw legacyError;
		}
		const migrated = parseStore(text, legacyAuthFilePath());
		await writeStore(migrated, path);
		await rm(legacyAuthFilePath(), { force: true });
		return migrated;
	}
	return parseStore(text, path);
}
/** Parse and validate store JSON read from `path`. */
function parseStore(text, path) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`subscriptions auth store at ${path} is not valid JSON; fix or delete the file`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`subscriptions auth store at ${path} must be a JSON object keyed by provider; fix or delete the file`);
	const store = parsed;
	for (const provider of PROVIDER_IDS) {
		const entry = store[provider];
		if (entry !== void 0) assertSessionShape(provider, entry);
	}
	return store;
}
/** Persist the whole store atomically with owner-only permissions. */
async function writeStore(store, path) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
	try {
		await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 384 });
		await chmod(tmp, 384);
		await rename(tmp, path);
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}
/**
* Read one provider's session.
* @param provider - the provider route.
* @param path - store file path; defaults to {@link authFilePath}.
* @returns the stored session, or `undefined` when logged out.
*/
async function getSession(provider, path = authFilePath()) {
	return (await loadStore(path))[provider];
}
/**
* Write one provider's session, preserving the others.
* @param provider - the provider route.
* @param session - the fresh session from a login or refresh.
* @param path - store file path; defaults to {@link authFilePath}.
*/
async function saveSession(provider, session, path = authFilePath()) {
	const store = await loadStore(path);
	store[provider] = session;
	await writeStore(store, path);
}
/**
* Delete one provider's session (logout).
* @param provider - the provider route.
* @param path - store file path; defaults to {@link authFilePath}.
*/
async function deleteSession(provider, path = authFilePath()) {
	const store = await loadStore(path);
	if (store[provider] === void 0) return;
	delete store[provider];
	await writeStore(store, path);
}

//#endregion
//#region src/auth/rpc.ts
/** The RPC channel this plugin registers on the host connection. */
const SUBSCRIPTIONS_AUTH_CHANNEL = "/subscriptions-auth";
/** Media types the attachment store accepts (ImageMediaType). */
const IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
/** Bare MP4 file names the `video` endpoint accepts (no path separators). */
const VIDEO_NAME_PATTERN = /^[\w.-]+\.mp4$/;
/** Payload carried no usable provider id â€” an RPC client bug, not a server failure. */
var BadRequest = class extends Error {};
function ok(value) {
	return {
		ok: true,
		value
	};
}
function failure(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof BadRequest) return {
		ok: false,
		error: {
			code: "bad-request",
			message,
			details: { issues: [] }
		}
	};
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
function readProvider(payload) {
	if (typeof payload !== "object" || payload === null) throw new BadRequest("payload must be an object");
	const provider = payload.provider;
	if (typeof provider !== "string" || !PROVIDER_IDS.includes(provider)) throw new BadRequest(`payload.provider must be one of ${PROVIDER_IDS.join(", ")}`);
	return provider;
}
function readString(payload, field) {
	const value = payload[field];
	if (typeof value !== "string" || value.length === 0) throw new BadRequest(`payload.${field} must be a non-empty string`);
	return value;
}
/** Validate the `setSpeed` endpoint's tier. */
function readSpeedTier(payload) {
	const tier = payload.tier;
	if (tier !== "standard" && tier !== "fast") throw new BadRequest("payload.tier must be \"standard\" or \"fast\"");
	return tier;
}
/** Validate the `image` endpoint's payload into a full attachment reference. */
function readImageRef(payload) {
	if (typeof payload !== "object" || payload === null) throw new BadRequest("payload must be an object");
	const record = payload;
	const attachmentId = record.attachmentId;
	if (typeof attachmentId !== "string" || attachmentId.length === 0) throw new BadRequest("payload.attachmentId must be a non-empty string");
	const mediaType = record.mediaType;
	if (typeof mediaType !== "string" || !IMAGE_MEDIA_TYPES.includes(mediaType)) throw new BadRequest(`payload.mediaType must be one of ${IMAGE_MEDIA_TYPES.join(", ")}`);
	for (const field of [
		"bytes",
		"width",
		"height"
	]) {
		const value = record[field];
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new BadRequest(`payload.${field} must be a positive integer`);
	}
	const name$1 = record.name;
	if (name$1 !== void 0 && typeof name$1 !== "string") throw new BadRequest("payload.name must be a string when present");
	return {
		attachmentId: AttachmentId(attachmentId),
		mediaType,
		bytes: record.bytes,
		width: record.width,
		height: record.height,
		...name$1 === void 0 ? {} : { name: name$1 }
	};
}
/**
* Validate the `video` endpoint's payload into a bare file name. Rejecting
* anything with a path separator (the pattern allows none) pins every read
* inside the plugin's videos directory.
*/
function readVideoName(payload) {
	if (typeof payload !== "object" || payload === null) throw new BadRequest("payload must be an object");
	const name$1 = payload.name;
	if (typeof name$1 !== "string" || !VIDEO_NAME_PATTERN.test(name$1)) throw new BadRequest("payload.name must be a bare .mp4 file name");
	return name$1;
}
/** Validate the session id both speed endpoints carry. */
function readSessionId(payload) {
	if (typeof payload !== "object" || payload === null) throw new BadRequest("payload must be an object");
	return readString(payload, "sessionId");
}
async function dispatch(controller, speed, endpoint, payload, signal) {
	switch (endpoint) {
		case "status": {
			const entries = await Promise.all(PROVIDER_IDS.map(async (provider) => [provider, await controller.status(provider)]));
			return ok({ providers: Object.fromEntries(entries) });
		}
		case "login": return ok(await controller.login(readProvider(payload)));
		case "manual": {
			const provider = readProvider(payload);
			await controller.manual(provider, readString(payload, "input"));
			return ok({ ok: true });
		}
		case "cancel":
			await controller.cancel(readProvider(payload));
			return ok({ ok: true });
		case "logout":
			await controller.logout(readProvider(payload));
			return ok({ ok: true });
		case "usage": return ok(await controller.usage(readProvider(payload), signal));
		case "image": return ok(await controller.readImage(readImageRef(payload), signal));
		case "video": return ok(await controller.readVideo(readVideoName(payload), signal));
		case "speed": return ok(await speed.speed(readSessionId(payload)));
		case "setSpeed":
			await speed.setSpeed(readSessionId(payload), readSpeedTier(payload));
			return ok({ ok: true });
		default: throw new BadRequest(`unknown /subscriptions-auth endpoint "${endpoint}"`);
	}
}
/**
* Register the `/subscriptions-auth` RPC channel when a host connection exists.
* @param ctx - the plugin context (headless profiles have no `connection`).
* @param controller - the auth operations backing the endpoints.
* @param speed - the per-session speed-tier state backing the Speed toggle.
*/
function registerAuthRpc(ctx, controller, speed) {
	ctx.inject(["connection"], (ctx$1) => {
		const connection = ctx$1.get("connection");
		ctx$1.effect(() => connection.rpc.handle(SUBSCRIPTIONS_AUTH_CHANNEL, async (endpoint, payload, signal) => {
			try {
				return await dispatch(controller, speed, endpoint, payload, signal);
			} catch (error) {
				return failure(error);
			}
		}, { authority: "loopback" }), "dsh-plugin-subscriptions: /subscriptions-auth rpc channel");
	});
}

//#endregion
//#region src/providers/common.ts
/**
* Validate a configured model catalog (mirrors llm-deepseek's resolveModels).
* @param models - raw configured entries.
* @param label - diagnostic prefix naming the provider.
* @returns the validated entries.
*/
function validateModels(models, label) {
	const seen = /* @__PURE__ */ new Set();
	return models.map((model) => {
		if (model.id.length === 0) throw new Error(`${label}: catalog model ids must be non-empty`);
		if (model.name !== void 0 && model.name.length === 0) throw new Error(`${label}: catalog model "${model.id}" has an empty name`);
		if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`${label}: catalog model "${model.id}" contextWindow must be a positive integer`);
		if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`${label}: catalog model "${model.id}" maxTokens must be a positive integer`);
		if (model.inputModalities !== void 0 && (model.inputModalities.length === 0 || model.inputModalities.some((modality) => modality !== "text" && modality !== "image"))) throw new Error(`${label}: catalog model "${model.id}" inputModalities must be a non-empty list of "text"/"image"`);
		if (seen.has(model.id)) throw new Error(`${label}: duplicate catalog model "${model.id}"`);
		seen.add(model.id);
		return {
			id: model.id,
			...model.name === void 0 ? {} : { name: model.name },
			...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
			...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
			...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
		};
	});
}
/**
* Build an LlmError from a non-2xx provider response, reading and truncating
* the body for the message and mapping the status to a stable code.
* @param response - the failed response.
* @param label - diagnostic prefix naming the provider API.
* @returns the classified error.
*/
async function httpLlmError(response, label) {
	let body = "";
	try {
		body = (await response.text()).slice(0, 500);
	} catch {}
	const message = body.length > 0 ? `${label} error (HTTP ${String(response.status)}): ${body}` : `${label} error (HTTP ${String(response.status)})`;
	let code;
	if (response.status === 401 || response.status === 403) code = "AUTH";
	else if (isQuotaExceededError(body)) code = QUOTA_EXCEEDED_CODE;
	else if (response.status === 429) code = "RATE_LIMIT";
	else if (response.status === 400 && isContextWindowExceededError(body)) code = CONTEXT_WINDOW_EXCEEDED_CODE;
	else if (response.status === 408 || response.status === 504) code = "TIMEOUT";
	else if (response.status >= 500) code = "SERVER";
	else code = `HTTP_${String(response.status)}`;
	const retryAfter = response.headers.get("retry-after");
	let providerRetryAfterMs;
	if (retryAfter !== null) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds > 0) providerRetryAfterMs = seconds * 1e3;
	}
	return new LlmError(message, code, {
		status: response.status,
		...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs }
	});
}
/**
* Create an idle watchdog chained to the caller's signal.
* @param caller - the request's own abort signal, when present.
* @param timeoutMs - maximum idle interval while a stream read is outstanding.
* @returns the watchdog; always {@link IdleWatchdog.stop} it when the stream ends.
*/
function idleWatchdog(caller, timeoutMs) {
	const controller = new AbortController();
	let expired = false;
	let timer;
	const arm = () => {
		if (timer !== void 0) clearTimeout(timer);
		timer = setTimeout(() => {
			expired = true;
			controller.abort(/* @__PURE__ */ new Error(`stream idle timeout after ${String(timeoutMs)}ms`));
		}, timeoutMs);
		timer.unref();
	};
	const onCallerAbort = () => controller.abort(caller?.reason);
	if (caller?.aborted === true) controller.abort(caller.reason);
	else caller?.addEventListener("abort", onCallerAbort, { once: true });
	arm();
	return {
		signal: controller.signal,
		pulse: arm,
		stop() {
			if (timer !== void 0) clearTimeout(timer);
			caller?.removeEventListener("abort", onCallerAbort);
		},
		timedOut: () => expired
	};
}
/**
* Classify a thrown fetch failure. Caller cancellation maps to ABORTED, idle
* expiry to TIMEOUT, and everything else (DNS, TLS, refused connection) to
* TRANSPORT with the cause chained.
* @param label - diagnostic prefix naming the provider API.
* @param error - the thrown value.
* @param watchdog - the request's idle watchdog.
* @param caller - the request's own abort signal, when present.
* @returns the classified error.
*/
function mapFetchFailure(label, error, watchdog, caller) {
	if (watchdog.timedOut()) return new LlmError(`${label} stream idle timeout`, "TIMEOUT", { cause: error });
	if (caller?.aborted === true) return new LlmError(`${label} request aborted by caller`, "ABORTED", { cause: error });
	if (error instanceof LlmError) return error;
	return new LlmError(`${label} request failed`, "TRANSPORT", { cause: error });
}
/** OAuth token-endpoint failure carrying the provider's `error` code when it sent one. */
var OAuthEndpointError = class extends Error {
	/** HTTP status of the token endpoint response. */
	status;
	/** The provider's OAuth `error` code (e.g. `invalid_grant`), when present. */
	oauthCode;
	constructor(message, status, oauthCode) {
		super(message);
		this.name = "OAuthEndpointError";
		this.status = status;
		this.oauthCode = oauthCode;
	}
};
/**
* Read an OAuth JSON error body into an {@link OAuthEndpointError}.
* @param response - the failed token-endpoint response.
* @param label - diagnostic prefix naming the provider.
* @returns the error to throw.
*/
async function oauthEndpointError(response, label) {
	let oauthCode;
	let detail = "";
	try {
		const parsed = await response.json();
		oauthCode = typeof parsed.error === "string" ? parsed.error : void 0;
		detail = typeof parsed.error_description === "string" ? parsed.error_description : oauthCode ?? "";
	} catch {}
	return new OAuthEndpointError(detail.length > 0 ? `${label} token endpoint error (HTTP ${String(response.status)}): ${detail}` : `${label} token endpoint error (HTTP ${String(response.status)})`, response.status, oauthCode);
}
/**
* Per-provider session freshness: loads the stored session, refreshes
* proactively inside the preempt window or on demand after a 401, and
* coalesces concurrent refreshes behind one in-flight promise. Permanent
* refresh failures delete the stored session and surface INVALID_CREDENTIAL
* with a re-login hint; transient failures fall back to a still-valid token.
*/
var TokenManager = class {
	inflight;
	constructor(options) {
		this.options = options;
		this.options = options;
	}
	/**
	* Read the stored session without any refresh side effect. Catalog queries
	* (`listModels`) use this to decide whether the provider is logged in.
	* @returns the stored session, or `undefined` when logged out.
	*/
	peek() {
		return this.options.load();
	}
	/**
	* Whether a session is currently stored (cheap; never refreshes).
	* @returns true when logged in.
	*/
	async hasSession() {
		return await this.options.load() !== void 0;
	}
	/**
	* Resolve a usable session, refreshing proactively or on demand.
	* @param forceRefresh - refresh regardless of expiry (used after a 401).
	* @returns the persisted session to send.
	* @throws LlmError MISSING_CREDENTIAL when logged out, INVALID_CREDENTIAL
	*   when the refresh grant is permanently rejected.
	*/
	async session(forceRefresh = false) {
		const session = await this.options.load();
		if (session === void 0) throw new LlmError(`dsh-plugin-subscriptions: not logged in to ${this.options.displayName}; log in via Settings â†’ Subscriptions in the dsh web app`, "MISSING_CREDENTIAL");
		if (!forceRefresh && session.expiresAt - Date.now() > this.options.preemptMs) return session;
		this.inflight ??= this.doRefresh(session).finally(() => {
			this.inflight = void 0;
		});
		try {
			return await this.inflight;
		} catch (error) {
			if (this.options.isPermanent(error)) {
				await this.options.remove();
				this.options.onRemoved?.();
				throw new LlmError(`${this.options.displayName} login expired or was revoked; log in again via Settings â†’ Subscriptions`, "INVALID_CREDENTIAL", { cause: error });
			}
			if (!forceRefresh && session.expiresAt > Date.now()) return session;
			throw error instanceof LlmError ? error : new LlmError(`${this.options.displayName} token refresh failed`, "AUTH", { cause: error });
		}
	}
	async doRefresh(session) {
		const current = await this.options.load();
		if (current !== void 0 && current.accessToken !== session.accessToken && current.expiresAt - Date.now() > this.options.preemptMs) return current;
		const next = await this.options.refresh(current ?? session);
		await this.options.save(next);
		return next;
	}
};
/** How long a discovered catalog is trusted before re-fetching. */
const DISCOVERY_TTL_MS = 5 * 6e4;
/**
* Cache for one provider's discovered model catalog. The TTL only decides
* when to REFRESH; it never makes the cache forget: capability metadata
* (reasoning efforts) must stay stable for a session that selected an effort,
* or mid-conversation calls fail UNSUPPORTED_REASONING_EFFORT the moment the
* cache goes stale. `listModels` awaits freshness via {@link get};
* `resolveModel` uses {@link resolve}, which serves the last-known catalog
* while a stale entry refreshes in the background, and only awaits the fetch
* when nothing is known yet. An optional {@link CatalogPersistence} seeds the
* last-known state across restarts and receives every successful fetch. A 401
* during a fetch must call {@link invalidate}.
*/
var ModelCatalogCache = class {
	entry;
	inflight;
	/** Settles once the persisted snapshot (when any) has been considered. */
	seeded;
	/** Set by {@link invalidate} so an in-flight disk read cannot resurrect dropped state. */
	seedDisabled = false;
	constructor(persistence, ttlMs = DISCOVERY_TTL_MS) {
		this.persistence = persistence;
		this.ttlMs = ttlMs;
	}
	/**
	* The cached catalog when fresh, without fetching.
	* @returns the cached models, or `undefined` when absent or stale.
	*/
	cached() {
		if (this.entry === void 0 || Date.now() - this.entry.at >= this.ttlMs) return void 0;
		return this.entry.models;
	}
	/** Load the persisted snapshot once; a fetch or invalidate that landed first wins. */
	ensureSeeded() {
		if (this.persistence === void 0) return Promise.resolve();
		this.seeded ??= this.persistence.load().then((snapshot) => {
			if (snapshot !== void 0 && this.entry === void 0 && !this.seedDisabled) this.entry = snapshot;
		}, () => void 0);
		return this.seeded;
	}
	/** Run (or join) the single in-flight fetch, updating memory and disk on success. */
	refresh(fetcher) {
		this.inflight ??= fetcher().then((models) => {
			const snapshot = {
				at: Date.now(),
				models
			};
			this.entry = snapshot;
			this.persistence?.save(snapshot).catch(() => void 0);
			return models;
		}).finally(() => {
			this.inflight = void 0;
		});
		return this.inflight;
	}
	/**
	* Return the cached catalog when fresh, otherwise fetch and cache it.
	* @param fetcher - performs the provider's model-list request.
	* @returns the discovered models.
	* @throws the fetcher's failure (the `listModels` caller warns and falls back).
	*/
	async get(fetcher) {
		await this.ensureSeeded();
		return this.cached() ?? this.refresh(fetcher);
	}
	/**
	* The models for capability resolution. A fresh cache answers directly; a
	* stale one answers immediately from the last-known catalog while a
	* background refresh runs (a mid-conversation `resolveModel` must neither
	* block on nor fail with the network); a cold cache awaits one fetch.
	* @param fetcher - performs the provider's model-list request.
	* @returns the models, or `undefined` when nothing is known (the caller
	*   falls back to its static metadata). Never throws.
	*/
	async resolve(fetcher) {
		await this.ensureSeeded();
		const fresh = this.cached();
		if (fresh !== void 0) return fresh;
		const known = this.entry?.models;
		if (known !== void 0) {
			this.refresh(fetcher).catch(() => void 0);
			return known;
		}
		try {
			return await this.refresh(fetcher);
		} catch {
			return;
		}
	}
	/** Drop the cached catalog (e.g. after a 401 proved the credential changed). */
	invalidate() {
		this.entry = void 0;
		this.seedDisabled = true;
		this.persistence?.clear().catch(() => void 0);
	}
};

//#endregion
//#region src/providers/catalog-store.ts
/**
* Absolute path of the catalog store file.
* @returns `dshHomePath('plugins', 'subscriptions', 'models.json')`.
*/
function modelsFilePath() {
	return dshHomePath("plugins", "subscriptions", "models.json");
}
/** Validate one persisted reasoning block, or undefined when malformed. */
function sanitizeReasoning(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	if (!Array.isArray(raw.efforts) || raw.efforts.length === 0) return void 0;
	const seen = /* @__PURE__ */ new Set();
	const efforts = [];
	for (const entry of raw.efforts) {
		if (typeof entry !== "object" || entry === null) return void 0;
		const effort = entry;
		if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) return void 0;
		seen.add(effort.id);
		efforts.push({
			id: ReasoningEffortId(effort.id),
			name: effort.name,
			...effort.description === void 0 ? {} : { description: effort.description }
		});
	}
	if (raw.defaultEffort !== void 0 && (typeof raw.defaultEffort !== "string" || !seen.has(raw.defaultEffort))) return void 0;
	return {
		efforts,
		...raw.defaultEffort === void 0 ? {} : { defaultEffort: ReasoningEffortId(raw.defaultEffort) }
	};
}
/** Validate one persisted model, or undefined when malformed. */
function sanitizeModel(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	if (typeof raw.id !== "string" || raw.id.length === 0 || typeof raw.name !== "string" || raw.name.length === 0 || raw.description !== void 0 && typeof raw.description !== "string" || raw.contextWindow !== void 0 && (typeof raw.contextWindow !== "number" || !Number.isInteger(raw.contextWindow) || raw.contextWindow <= 0) || raw.priority !== void 0 && (typeof raw.priority !== "number" || !Number.isFinite(raw.priority))) return void 0;
	const reasoning = raw.reasoning === void 0 ? void 0 : sanitizeReasoning(raw.reasoning);
	if (raw.reasoning !== void 0 && reasoning === void 0) return void 0;
	const thinkingType = raw.thinkingType;
	if (thinkingType !== void 0 && thinkingType !== "enabled" && thinkingType !== "adaptive") return void 0;
	const fastTier = raw.fastTier;
	if (fastTier !== void 0 && typeof fastTier !== "boolean") return void 0;
	return {
		id: raw.id,
		name: raw.name,
		...raw.description === void 0 ? {} : { description: raw.description },
		...raw.contextWindow === void 0 ? {} : { contextWindow: raw.contextWindow },
		...raw.priority === void 0 ? {} : { priority: raw.priority },
		...reasoning === void 0 ? {} : { reasoning },
		...thinkingType === void 0 ? {} : { thinkingType },
		...fastTier === void 0 ? {} : { fastTier }
	};
}
/**
* Validate one persisted snapshot. Strict: any malformed field drops the
* whole snapshot rather than repairing it â€” the next successful discovery
* rewrites the entry anyway.
* @param value - the raw per-provider file entry.
* @returns the validated snapshot, or undefined when unusable.
*/
function sanitizeSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return void 0;
	if (!Array.isArray(raw.models) || raw.models.length === 0) return void 0;
	const seen = /* @__PURE__ */ new Set();
	const models = [];
	for (const entry of raw.models) {
		const model = sanitizeModel(entry);
		if (model === void 0 || seen.has(model.id)) return void 0;
		seen.add(model.id);
		models.push(model);
	}
	return {
		at: raw.at,
		models
	};
}
/** Read the whole file; missing or unparsable reads as an empty cache. */
async function readCatalogFile(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}
/** Persist the whole file atomically (tmp file + rename). */
async function writeCatalogFile(store, path) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
	try {
		await writeFile(tmp, JSON.stringify(store, null, 2));
		await rename(tmp, path);
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}
/**
* Build the durable half of one provider's catalog cache over the shared
* models.json file (concurrent writers are last-writer-wins, acceptable for
* a cache).
* @param provider - the provider route keying the file entry.
* @param path - store file path; defaults to {@link modelsFilePath}.
* @returns the persistence hooks for {@link ModelCatalogCache}.
*/
function catalogStore(provider, path = modelsFilePath()) {
	return {
		async load() {
			return sanitizeSnapshot((await readCatalogFile(path))[provider]);
		},
		async save(snapshot) {
			const store = await readCatalogFile(path);
			store[provider] = snapshot;
			await writeCatalogFile(store, path);
		},
		async clear() {
			const store = await readCatalogFile(path);
			if (store[provider] === void 0) return;
			delete store[provider];
			await writeCatalogFile(store, path);
		}
	};
}

//#endregion
//#region src/auth/jwt.ts
/** Minimal JWT payload decoding for claims extraction (no signature verification). */
/**
* Decode a JWT payload without verifying the signature. Used only to read
* account claims from `id_token`s issued over the provider's own TLS channel
* during a code exchange we initiated â€” never to authorize anything.
* @param token - the compact JWT string.
* @returns the parsed payload object, or `undefined` when the token is not a
*   well-formed JWT with a JSON object payload.
*/
function decodeJwtPayload(token) {
	const parts = token.split(".");
	if (parts.length < 2) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	return parsed;
}

//#endregion
//#region src/translate/resolved.ts
/**
* Resolve every ImageBlock's attachment reference to inline base64 bytes.
* Messages without images pass through unchanged. A request carrying an image
* with no attachment service available fails loudly rather than silently
* dropping the image.
* @param messages - the request's conversation messages.
* @param attachments - the deployment's attachment service, when mounted.
* @param signal - cancellation for the storage reads.
* @returns the same messages with image blocks resolved for the translators.
*/
async function resolveImages(messages, attachments, signal) {
	if (!messages.some((message) => message.content.some((block) => block.type === "image"))) return messages;
	if (attachments === void 0) throw new LlmError("dsh-plugin-subscriptions: the request carries an image but no attachments service is mounted; image input requires the harness attachment store", "UNSUPPORTED");
	return Promise.all(messages.map(async (message) => ({
		role: message.role,
		content: await Promise.all(message.content.map(async (block) => {
			if (block.type !== "image") return block;
			const stored = await attachments.readImage(block.attachment, signal);
			return {
				type: "image",
				mediaType: stored.ref.mediaType,
				dataBase64: Buffer.from(stored.data).toString("base64")
			};
		}))
	})));
}

//#endregion
//#region src/translate/sse.ts
/**
* Decode an SSE byte stream into events.
* @param stream - raw response bytes; reads may split anywhere, including mid-UTF-8 sequence.
* @param onActivity - called on every received chunk and comment line; drives the idle watchdog.
* @returns events in arrival order.
*/
async function* parseSse(stream, onActivity) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	let dataLines = [];
	let eventName;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			onActivity?.();
			pending += decoder.decode(value, { stream: true });
			let newline = pending.indexOf("\n");
			while (newline >= 0) {
				let line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (line.length === 0) {
					if (dataLines.length > 0) yield {
						data: dataLines.join("\n"),
						...eventName === void 0 ? {} : { event: eventName }
					};
					dataLines = [];
					eventName = void 0;
				} else if (line.startsWith(":")) onActivity?.();
				else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
				else if (line.startsWith("event:")) eventName = line.slice(6).replace(/^ /, "");
			}
		}
	} finally {
		reader.releaseLock();
	}
}

//#endregion
//#region src/translate/responses.ts
/** Flatten a tool result's content to plain text for `function_call_output`. */
function toolResultText$1(block) {
	return block.content.map((part) => part.type === "text" ? part.text : "").join("");
}
/**
* Convert harness messages into Responses `instructions` + `input` items.
* System-role messages become `instructions`; an explicit `system` argument
* wins over them when both exist. Reasoning blocks are not replayed (v1).
* Images must arrive pre-resolved ({@link TranslatableMessage}); an unresolved
* ImageBlock is skipped because its bytes are unreachable here.
* @param messages - ordered conversation messages with resolved images.
* @param system - explicit system prompt, which takes precedence.
* @returns request fields ready to merge into the request body.
*/
function toResponsesInput(messages, system) {
	const input = [];
	const systemTexts = [];
	for (const message of messages) {
		if (message.role === "system") {
			for (const block of message.content) if (block.type === "text") systemTexts.push(block.text);
			continue;
		}
		const role = message.role;
		let content = [];
		const flushMessage = () => {
			if (content.length === 0) return;
			input.push({
				type: "message",
				role,
				content
			});
			content = [];
		};
		for (const block of message.content) switch (block.type) {
			case "text":
				content.push({
					type: role === "assistant" ? "output_text" : "input_text",
					text: block.text
				});
				break;
			case "tool-call":
				flushMessage();
				input.push({
					type: "function_call",
					call_id: String(block.id),
					name: block.name,
					arguments: block.arguments
				});
				break;
			case "tool-result":
				flushMessage();
				input.push({
					type: "function_call_output",
					call_id: String(block.toolCallId),
					output: toolResultText$1(block)
				});
				break;
			case "image":
				if ("dataBase64" in block) content.push({
					type: "input_image",
					image_url: `data:${block.mediaType};base64,${block.dataBase64}`
				});
				break;
			default: break;
		}
		flushMessage();
	}
	const instructions = system ?? (systemTexts.length > 0 ? systemTexts.join("\n\n") : void 0);
	return {
		...instructions === void 0 ? {} : { instructions },
		input
	};
}
/**
* Map harness tool schemas to Responses function tools.
* @param tools - tool schemas from the request.
* @returns Responses `tools` array entries.
*/
function toResponsesTools(tools) {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
}
/**
* Map Responses usage to disjoint harness counts (cached input is subtracted
* out of `inputTokens` and reported as `cacheReadTokens`).
* @param usage - wire usage from `response.completed`.
* @returns harness token usage.
*/
function mapResponsesUsage(usage) {
	const cached = usage.input_tokens_details?.cached_tokens;
	const reasoning = usage.output_tokens_details?.reasoning_tokens;
	return {
		inputTokens: usage.input_tokens - (cached ?? 0),
		outputTokens: usage.output_tokens,
		...cached !== void 0 ? { cacheReadTokens: cached } : {},
		...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
	};
}
/**
* Classify a Responses failure payload into a thrown LlmError.
* @param code - provider error code, when present.
* @param message - provider error message, when present.
* @returns the mapped error (context overflow, quota, otherwise SERVER).
*/
function responsesFailure(code, message) {
	const text = message ?? code ?? "the provider reported a failed response";
	const detail = `${code ?? ""} ${message ?? ""}`;
	if (code === "context_window_exceeded" || isContextWindowExceededError(detail)) return new LlmError(text, CONTEXT_WINDOW_EXCEEDED_CODE);
	if (code !== void 0 && /insufficient|quota/i.test(code) || isQuotaExceededError(detail)) return new LlmError(text, QUOTA_EXCEEDED_CODE);
	return new LlmError(text, "SERVER");
}
/** Assemble the final ContentBlock for one open block. */
function closeBlock$1(block) {
	switch (block.kind) {
		case "text": return {
			type: "text",
			text: block.text
		};
		case "reasoning": return {
			type: "reasoning",
			text: block.text
		};
		case "tool-call": return {
			type: "tool-call",
			id: CallId(block.callId),
			name: block.name ?? "",
			arguments: block.text
		};
	}
}
/**
* Push-model Responses SSE translator: feed each parsed event object to
* {@link push} and collect the emitted harness StreamChunks. Block indexes
* are allocated in first-seen order; `usage` is emitted before the terminal
* `finish`, and nothing is emitted after it. Terminal provider failures
* throw {@link LlmError}.
*/
var ResponsesStreamTranslator = class {
	blocks = /* @__PURE__ */ new Map();
	order = [];
	nextIndex = 0;
	sawToolCall = false;
	/** Set once `response.completed` produced the terminal finish chunk. */
	terminated = false;
	open(key, kind, chunks, callId = "", name$1) {
		const block = {
			index: this.nextIndex++,
			kind,
			text: "",
			callId,
			...name$1 === void 0 ? {} : { name: name$1 }
		};
		this.blocks.set(key, block);
		this.order.push(block);
		chunks.push({
			type: "block-start",
			index: block.index,
			blockType: kind
		});
		return block;
	}
	textBlock(key, chunks) {
		return this.blocks.get(key) ?? this.open(key, "text", chunks);
	}
	reasoningBlock(key, chunks) {
		return this.blocks.get(key) ?? this.open(key, "reasoning", chunks);
	}
	close(key, chunks) {
		const block = this.blocks.get(key);
		if (block === void 0) return;
		this.blocks.delete(key);
		chunks.push({
			type: "block-end",
			index: block.index,
			block: closeBlock$1(block)
		});
	}
	/** Close every still-open block for one output item (prefix match on the key). */
	closeItem(itemId, chunks) {
		for (const key of [...this.blocks.keys()]) if (key.startsWith(`${itemId}:`)) this.close(key, chunks);
	}
	/** Close every still-open block (provider ended the response without done events). */
	closeAll(chunks) {
		for (const block of this.order) this.closeKeyIfOpen(block, chunks);
	}
	closeKeyIfOpen(block, chunks) {
		for (const [key, candidate] of this.blocks) if (candidate === block) {
			this.blocks.delete(key);
			chunks.push({
				type: "block-end",
				index: block.index,
				block: closeBlock$1(block)
			});
			return;
		}
	}
	/**
	* Process one parsed Responses SSE event.
	* @param event - the parsed event object.
	* @returns the StreamChunks this event produced (possibly none).
	*/
	push(event) {
		if (this.terminated) return [];
		const chunks = [];
		switch (event.type) {
			case "response.output_item.added": {
				const item = event.item;
				if (item?.type === "function_call" && item.id !== void 0) {
					this.sawToolCall = true;
					const callId = item.call_id ?? "";
					const block = this.open(`${item.id}:call`, "tool-call", chunks, callId, item.name);
					chunks.push({
						type: "tool-call-delta",
						index: block.index,
						id: CallId(callId),
						...item.name === void 0 ? {} : { name: item.name },
						argumentsDelta: ""
					});
				}
				return chunks;
			}
			case "response.output_text.delta": {
				const key = `${event.item_id ?? ""}:text:${String(event.content_index ?? 0)}`;
				const block = this.textBlock(key, chunks);
				block.text += event.delta ?? "";
				chunks.push({
					type: "text-delta",
					index: block.index,
					text: event.delta ?? ""
				});
				return chunks;
			}
			case "response.reasoning_summary_text.delta":
			case "response.reasoning_text.delta": {
				const sub = event.summary_index ?? event.content_index ?? 0;
				const key = `${event.item_id ?? ""}:reason:${String(sub)}`;
				const block = this.reasoningBlock(key, chunks);
				block.text += event.delta ?? "";
				chunks.push({
					type: "reasoning-delta",
					index: block.index,
					text: event.delta ?? ""
				});
				return chunks;
			}
			case "response.function_call_arguments.delta": {
				const key = `${event.item_id ?? ""}:call`;
				let block = this.blocks.get(key);
				if (block === void 0) {
					this.sawToolCall = true;
					block = this.open(key, "tool-call", chunks);
				}
				block.text += event.delta ?? "";
				chunks.push({
					type: "tool-call-delta",
					index: block.index,
					id: CallId(block.callId),
					...block.name === void 0 ? {} : { name: block.name },
					argumentsDelta: event.delta ?? ""
				});
				return chunks;
			}
			case "response.output_item.done": {
				const item = event.item;
				if (item === void 0 || item.id === void 0) return chunks;
				if (item.type === "function_call") {
					const key = `${item.id}:call`;
					const block = this.blocks.get(key);
					if (block !== void 0 && block.text.length === 0 && item.arguments !== void 0) block.text = item.arguments;
					this.close(key, chunks);
				} else if (item.type === "message") {
					if (![...this.blocks.keys()].some((key) => key.startsWith(`${item.id}:text:`))) for (const [partIndex, part] of (item.content ?? []).entries()) {
						if (part?.type !== "output_text" || typeof part.text !== "string" || part.text.length === 0) continue;
						const block = this.open(`${item.id}:text:${partIndex}`, "text", chunks);
						block.text = part.text;
						this.close(`${item.id}:text:${partIndex}`, chunks);
					}
					this.closeItem(item.id, chunks);
				} else this.closeItem(item.id, chunks);
				return chunks;
			}
			case "response.completed": {
				this.terminated = true;
				this.closeAll(chunks);
				const usage = event.response?.usage;
				if (usage !== void 0) chunks.push({
					type: "usage",
					usage: mapResponsesUsage(usage)
				});
				if (this.order.length === 0) chunks.push({
					type: "finish",
					reason: {
						kind: "error",
						failure: {
							message: "model returned a completed response with no content",
							code: EMPTY_RESPONSE_CODE
						}
					}
				});
				else chunks.push({
					type: "finish",
					reason: { kind: this.sawToolCall ? "tool-calls" : "stop" }
				});
				return chunks;
			}
			case "response.failed": throw responsesFailure(event.response?.error?.code, event.response?.error?.message);
			case "response.incomplete": throw responsesFailure(event.response?.incomplete_details?.reason, event.response?.error?.message ?? `the provider reported an incomplete response (${event.response?.incomplete_details?.reason ?? "unknown reason"})`);
			case "error": throw responsesFailure(event.code, event.message);
			default: return chunks;
		}
	}
};
/**
* Consume a Responses SSE byte stream and yield harness StreamChunks.
* @param stream - raw response body.
* @param onActivity - transport-activity callback for the idle watchdog.
* @returns the chunk stream; throws when the stream ends before `response.completed`.
*/
async function* streamResponses(stream, onActivity) {
	const translator = new ResponsesStreamTranslator();
	for await (const sseEvent of parseSse(stream, onActivity)) {
		let event;
		try {
			event = JSON.parse(sseEvent.data);
		} catch {
			throw new LlmError(`malformed SSE payload: ${sseEvent.data.slice(0, 120)}`, "MALFORMED_RESPONSE");
		}
		yield* translator.push(event);
		if (translator.terminated) return;
	}
	throw new LlmError("Responses SSE stream ended before response.completed", "STREAM_CLOSED");
}

//#endregion
//#region src/providers/codex.ts
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_API_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CODEX_CALLBACK_PATH = "/auth/callback";
const CODEX_CONTEXT_WINDOW = 4e5;
const CODEX_DEFAULT_MAX_TOKENS = 128e3;
/** Refresh when the access token has less than this much life left. */
const CODEX_PREEMPT_MS = 5 * 6e4;
/** Default instruction when the request carries no system prompt. */
const DEFAULT_CODEX_INSTRUCTIONS = "You are Codex, a coding agent based on GPT-5. Help the user with their software engineering tasks.";
/** Refresh-grant rejections that mean the login is gone for good. */
const PERMANENT_REFRESH_CODES = new Set([
	"refresh_token_expired",
	"refresh_token_reused",
	"refresh_token_invalidated",
	"invalid_grant"
]);
const CODEX_EFFORTS = [
	{
		id: ReasoningEffortId("minimal"),
		name: "Minimal"
	},
	{
		id: ReasoningEffortId("low"),
		name: "Low"
	},
	{
		id: ReasoningEffortId("medium"),
		name: "Medium"
	},
	{
		id: ReasoningEffortId("high"),
		name: "High"
	},
	{
		id: ReasoningEffortId("xhigh"),
		name: "Extra High"
	}
];
const CODEX_DEFAULT_EFFORT = ReasoningEffortId("high");
/** Every gpt-5.x codex model accepts image input. */
const CODEX_MODALITIES = ["text", "image"];
/**
* Fast tier (the codex CLI's "fast mode"): the Responses `service_tier` wire
* value for priority processing, mirroring codex-rs
* `ServiceTier::Fast.request_value()`. The legacy catalog spelling is the
* `additional_speed_tiers` entry "fast".
*/
const CODEX_FAST_SERVICE_TIER = "priority";
const CODEX_FAST_SPEED_TIER = "fast";
/** Static codex flow facts for the OAuth flow engine. */
const codexFlow = {
	callbackPath: CODEX_CALLBACK_PATH,
	listen: {
		host: "localhost",
		ports: [1455, 1457]
	},
	buildAuthorizeUrl({ redirectUri, state, pkce }) {
		return `${CODEX_AUTHORIZE_URL}?${new URLSearchParams({
			response_type: "code",
			client_id: CODEX_CLIENT_ID,
			redirect_uri: redirectUri,
			scope: CODEX_SCOPE,
			code_challenge: pkce.challenge,
			code_challenge_method: "S256",
			state,
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "codex_cli_rs"
		}).toString()}`;
	}
};
/** Pull `chatgpt_account_id` out of an id token payload. */
function accountIdOf(idToken) {
	const auth = (idToken === void 0 ? void 0 : decodeJwtPayload(idToken))?.["https://api.openai.com/auth"];
	const accountId = typeof auth === "object" && auth !== null ? auth.chatgpt_account_id : void 0;
	if (typeof accountId !== "string" || accountId.length === 0) throw new Error("codex login did not return a chatgpt account id; cannot use the subscription");
	return accountId;
}
/**
* Decode the user-identity claims of a codex id token (pure, cheap â€” no
* verification, same trust posture as {@link accountIdOf}). Claim paths
* mirror codex-rs `login/src/token_data.rs`: the email is the top-level
* `email` claim, falling back to `https://api.openai.com/profile`.email; the
* plan is `https://api.openai.com/auth`.chatgpt_plan_type.
* @param idToken - a stored or freshly issued id token, when present.
* @returns whichever claims the token carried; empty when undecodable.
*/
function codexProfileClaims(idToken) {
	const payload = idToken === void 0 ? void 0 : decodeJwtPayload(idToken);
	if (payload === void 0) return {};
	const profile = payload["https://api.openai.com/profile"];
	const profileEmail = typeof profile === "object" && profile !== null ? profile.email : void 0;
	const email = payload.email ?? profileEmail;
	const auth = payload["https://api.openai.com/auth"];
	const plan = typeof auth === "object" && auth !== null ? auth.chatgpt_plan_type : void 0;
	return {
		...typeof email === "string" && email.length > 0 ? { emailAddress: email } : {},
		...typeof plan === "string" && plan.length > 0 ? { planType: plan } : {}
	};
}
/** Build a session from a token response; expires_in wins, JWT exp is the fallback. */
function codexSession(tokens, fallback) {
	if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) throw new Error("codex token endpoint returned no access token");
	const refreshToken = tokens.refresh_token ?? fallback?.refreshToken;
	if (refreshToken === void 0) throw new Error("codex token endpoint returned no refresh token");
	let expiresAt;
	if (typeof tokens.expires_in === "number" && tokens.expires_in > 0) expiresAt = Date.now() + tokens.expires_in * 1e3;
	else {
		const exp = decodeJwtPayload(tokens.access_token)?.exp;
		if (typeof exp === "number" && exp > 0) expiresAt = exp * 1e3;
	}
	if (expiresAt === void 0) throw new Error("codex token endpoint returned no usable expiry");
	const idToken = tokens.id_token ?? fallback?.idToken;
	const claims = {
		...fallback?.emailAddress === void 0 ? {} : { emailAddress: fallback.emailAddress },
		...fallback?.planType === void 0 ? {} : { planType: fallback.planType },
		...codexProfileClaims(tokens.id_token)
	};
	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt,
		accountId: tokens.id_token === void 0 && fallback !== void 0 ? fallback.accountId : accountIdOf(tokens.id_token),
		...idToken === void 0 ? {} : { idToken },
		...claims
	};
}
/**
* Exchange an authorization code for a codex session (form-encoded grant).
* @param code - the authorization code from the callback.
* @param verifier - the PKCE verifier minted for the attempt.
* @param redirectUri - the attempt's redirect URI.
* @returns the session to store.
*/
async function exchangeCodexCode(code, verifier, redirectUri) {
	const response = await fetch(CODEX_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: CODEX_CLIENT_ID,
			code_verifier: verifier
		}).toString()
	});
	if (!response.ok) throw await oauthEndpointError(response, "codex");
	return codexSession(await response.json());
}
/**
* Refresh a codex session (JSON grant â€” unlike the code exchange).
* @param session - the stored session.
* @returns the fresh session to store.
*/
async function refreshCodex(session) {
	const response = await fetch(CODEX_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_id: CODEX_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: session.refreshToken
		})
	});
	if (!response.ok) throw await oauthEndpointError(response, "codex");
	return codexSession(await response.json(), session);
}
/**
* Whether a codex refresh failure means the login is permanently gone.
* @param error - the thrown refresh error.
* @returns true when re-login is the only fix.
*/
function isCodexPermanentRefreshError(error) {
	return error instanceof OAuthEndpointError && error.oauthCode !== void 0 && PERMANENT_REFRESH_CODES.has(error.oauthCode);
}
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
/** Seconds of the canonical 5-hour session and 7-day weekly windows. */
const SESSION_WINDOW_SECONDS = 300 * 60;
const WEEKLY_WINDOW_SECONDS = 10080 * 60;
/** Whether a reported duration approximately matches the expected window length. */
function matchesWindow(seconds, expected) {
	return seconds >= expected * .95 && seconds <= expected * 1.05;
}
/**
* Classify a wham/usage window by its reported duration. The backend has been
* observed to place the weekly lane in `primary_window` with no secondary
* window, so slot position alone is unreliable; the caller's positional
* fallback applies only when the duration is absent.
*/
function codexWindowKind(window, fallback) {
	const seconds = window.limit_window_seconds;
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return fallback;
	if (matchesWindow(seconds, SESSION_WINDOW_SECONDS)) return "session";
	if (matchesWindow(seconds, WEEKLY_WINDOW_SECONDS)) return "weekly";
	return "other";
}
/** Map one wham/usage window into a {@link UsageWindow}; undefined when unusable. */
function codexUsageWindow(value, fallbackKind) {
	if (typeof value !== "object" || value === null) return void 0;
	const window = value;
	if (typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) return void 0;
	let resetsAt;
	if (typeof window.reset_at === "number" && window.reset_at > 0) resetsAt = window.reset_at * 1e3;
	else if (typeof window.reset_after_seconds === "number" && window.reset_after_seconds > 0) resetsAt = Date.now() + window.reset_after_seconds * 1e3;
	return {
		kind: codexWindowKind(window, fallbackKind),
		usedPercent: window.used_percent,
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/**
* Fetch the codex subscription usage from the ChatGPT backend wham/usage
* endpoint (the source of the codex CLI `/status` rate-limit lines). The
* windows are classified by their reported duration (`limit_window_seconds`)
* rather than by slot, since the backend has been observed to report the
* weekly lane as `primary_window` without a secondary window; slot order is
* kept only as a fallback when the duration is absent. The lookup itself
* consumes no rate-limit budget.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @param signal - caller cancellation from the RPC transport.
* @returns the mapped usage snapshot.
*/
async function fetchCodexUsage(session, fetchFn = fetch, signal) {
	const response = await fetchFn(CODEX_USAGE_URL, {
		headers: {
			"authorization": `Bearer ${session.accessToken}`,
			"chatgpt-account-id": session.accountId,
			"originator": "codex_cli_rs",
			"accept": "application/json",
			...attributionHeaders()
		},
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) throw await oauthEndpointError(response, "codex usage");
	const payload = await response.json();
	const windows = [];
	const primary = codexUsageWindow(payload.rate_limit?.primary_window, "session");
	const secondary = codexUsageWindow(payload.rate_limit?.secondary_window, "weekly");
	if (primary !== void 0) windows.push(primary);
	if (secondary !== void 0) windows.push(secondary);
	return {
		supported: true,
		windows,
		...typeof payload.plan_type === "string" && payload.plan_type.length > 0 ? { plan: payload.plan_type } : {}
	};
}
const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
/**
* Client version sent on the /models catalog request. The backend gates the
* visible model list by client version: versions below ~0.101 get an empty
* list, while current codex CLI releases get the full catalog â€” keep this in
* the range of current codex CLI releases.
*/
const CODEX_CLIENT_VERSION = "0.147.0";
/** Display name for a wire reasoning-effort value. */
function effortName(effort) {
	return effort === "xhigh" ? "Extra High" : effort.charAt(0).toUpperCase() + effort.slice(1);
}
/**
* Whether a catalog entry advertises the fast tier. Mirrors codex-rs
* `ModelPreset::supports_fast_mode`: a `service_tiers` id matching the fast
* wire value, or the legacy `additional_speed_tiers` "fast" entry.
*/
function supportsFastTier(entry) {
	return (entry.service_tiers ?? []).some((tier) => tier.id === CODEX_FAST_SERVICE_TIER) || (entry.additional_speed_tiers ?? []).includes(CODEX_FAST_SPEED_TIER);
}
/**
* Fetch the live codex model catalog with the session's auth headers.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @returns discovered models: hidden entries dropped, sorted by priority.
*/
async function fetchCodexModels(session, fetchFn = fetch) {
	const response = await fetchFn(`${CODEX_MODELS_URL}?client_version=${CODEX_CLIENT_VERSION}`, { headers: {
		"authorization": `Bearer ${session.accessToken}`,
		"chatgpt-account-id": session.accountId,
		"originator": "codex_cli_rs",
		"accept": "application/json",
		...attributionHeaders()
	} });
	if (!response.ok) throw await oauthEndpointError(response, "codex models");
	const payload = await response.json();
	if (!Array.isArray(payload.models)) throw new Error("codex models endpoint returned no models array");
	const discovered = [];
	for (const entry of payload.models) {
		if (typeof entry.slug !== "string" || entry.slug.length === 0) continue;
		if (entry.visibility === "hide" || entry.visibility === "none") continue;
		const efforts = (entry.supported_reasoning_levels ?? []).filter((level) => typeof level.effort === "string" && level.effort.length > 0).map((level) => ({
			id: ReasoningEffortId(level.effort),
			name: effortName(level.effort),
			...level.description === void 0 ? {} : { description: level.description }
		}));
		const defaultEffort = typeof entry.default_reasoning_level === "string" && entry.default_reasoning_level.length > 0 && efforts.some((effort) => effort.id === ReasoningEffortId(entry.default_reasoning_level)) ? ReasoningEffortId(entry.default_reasoning_level) : void 0;
		const model = {
			id: entry.slug,
			name: typeof entry.display_name === "string" && entry.display_name.length > 0 ? entry.display_name : entry.slug,
			...typeof entry.description === "string" && entry.description.length > 0 ? { description: entry.description } : {},
			...typeof entry.context_window === "number" && entry.context_window > 0 ? { contextWindow: entry.context_window } : {},
			...typeof entry.priority === "number" ? { priority: entry.priority } : {},
			...efforts.length > 0 ? { reasoning: {
				efforts,
				...defaultEffort === void 0 ? {} : { defaultEffort }
			} } : {},
			...supportsFastTier(entry) ? { fastTier: true } : {}
		};
		discovered.push(model);
	}
	discovered.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
	if (discovered.length === 0) throw new Error(`codex models endpoint returned an empty catalog (client_version ${CODEX_CLIENT_VERSION})`);
	return discovered;
}
/**
* The Responses request body for one generation. A fast-tier request (the
* composer Speed toggle, the codex CLI's fast mode) carries
* `service_tier: priority`; the tier field is omitted entirely otherwise,
* matching the CLI (it never sends an explicit standard tier).
*/
function codexRequestBody(options, resolved, fast) {
	return {
		model: options.model,
		instructions: resolved.instructions ?? DEFAULT_CODEX_INSTRUCTIONS,
		input: resolved.input,
		...options.tools !== void 0 && options.tools.length > 0 ? { tools: toResponsesTools(options.tools) } : {},
		tool_choice: "auto",
		parallel_tool_calls: true,
		...options.reasoningEffort !== void 0 ? { reasoning: {
			effort: String(options.reasoningEffort),
			summary: "auto"
		} } : {},
		store: false,
		stream: true,
		include: ["reasoning.encrypted_content"],
		...options.sessionId !== void 0 ? { prompt_cache_key: String(options.sessionId) } : {},
		...fast ? { service_tier: CODEX_FAST_SERVICE_TIER } : {}
	};
}
/** Codex wire adapter: one instance serves the `codex` provider route. */
var CodexAdapter = class extends LlmAdapter {
	catalog;
	constructor(options) {
		super();
		this.options = options;
		this.catalog = new ModelCatalogCache(options.catalogStore);
	}
	/** Discovery fetcher: resolves the session through the refresh-aware path. */
	async fetchCatalog() {
		return fetchCodexModels(await this.options.tokens.session(), this.options.fetchFn);
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: "ChatGPT (Codex)"
		};
	}
	staticModels(provider) {
		return this.options.models.map((model) => ({
			provider,
			id: model.id,
			name: model.name ?? model.id,
			inputModalities: model.inputModalities ?? CODEX_MODALITIES
		}));
	}
	async listModels(provider) {
		if (await this.options.tokens.peek() === void 0) return [];
		if (!this.options.discovery) return this.staticModels(provider);
		try {
			return (await this.catalog.get(() => this.fetchCatalog())).map((model) => ({
				provider,
				id: model.id,
				name: model.name,
				...model.description === void 0 ? {} : { description: model.description },
				inputModalities: CODEX_MODALITIES
			}));
		} catch (error) {
			if (error instanceof LlmError && (error.code === "MISSING_CREDENTIAL" || error.code === "INVALID_CREDENTIAL")) return [];
			if (error instanceof OAuthEndpointError && error.status === 401) this.catalog.invalidate();
			this.options.onWarn?.(`codex model discovery failed; using the built-in catalog (${errorChain(error)})`);
			return this.staticModels(provider);
		}
	}
	/**
	* The discovered entry for one model. Resolved through the cache's
	* stale-while-revalidate path so capability metadata stays stable across a
	* long conversation: a discovered-only effort (one missing from the static
	* CODEX_EFFORTS list) selected by the user must not vanish â€” and fail the
	* call â€” just because the TTL lapsed mid-turn.
	*/
	async discovered(model) {
		if (!this.options.discovery) return void 0;
		return (await this.catalog.resolve(() => this.fetchCatalog()))?.find((entry) => entry.id === model);
	}
	/** Whether the discovered catalog advertises a fast tier for this model. */
	async supportsFastTier(model) {
		return (await this.discovered(model))?.fastTier === true;
	}
	/** Ids of every discovered model with a fast tier (the Speed toggle's visibility list). */
	async fastCapableModels() {
		if (!this.options.discovery) return [];
		if (await this.options.tokens.peek() === void 0) return [];
		return (await this.catalog.resolve(() => this.fetchCatalog()) ?? []).filter((model) => model.fastTier === true).map((model) => model.id);
	}
	async resolveModel(provider, model) {
		const discovered = await this.discovered(model);
		const configured = this.options.models.find((entry) => entry.id === model);
		return {
			provider,
			id: model,
			name: discovered?.name ?? configured?.name ?? model,
			...discovered?.description === void 0 ? {} : { description: discovered.description },
			inputModalities: configured?.inputModalities ?? CODEX_MODALITIES,
			context: { contextWindow: discovered?.contextWindow ?? configured?.contextWindow ?? CODEX_CONTEXT_WINDOW },
			defaultMaxTokens: configured?.maxTokens ?? CODEX_DEFAULT_MAX_TOKENS,
			reasoning: discovered?.reasoning ?? {
				efforts: CODEX_EFFORTS,
				defaultEffort: CODEX_DEFAULT_EFFORT
			}
		};
	}
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			let session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) {
				session = await this.options.tokens.session(true);
				response = await this.request(options, session, watchdog.signal);
			}
			if (!response.ok) throw await httpLlmError(response, "codex API");
			if (response.body === null) throw new LlmError("codex API returned no response body", EMPTY_RESPONSE_CODE);
			yield* streamResponses(response.body, () => {
				watchdog.pulse();
			});
		} catch (error) {
			throw mapFetchFailure("codex API", error, watchdog, options.signal);
		} finally {
			watchdog.stop();
		}
	}
	async request(options, session, signal) {
		const messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
		const fast = this.options.speedFor !== void 0 && await this.options.speedFor(options.sessionId, options.model);
		const body = codexRequestBody(options, toResponsesInput(messages, options.system), fast);
		return fetch(CODEX_API_URL, {
			method: "POST",
			headers: {
				"authorization": `Bearer ${session.accessToken}`,
				"chatgpt-account-id": session.accountId,
				"originator": "codex_cli_rs",
				"session-id": randomUUID(),
				"accept": "text/event-stream",
				"content-type": "application/json",
				...attributionHeaders()
			},
			body: JSON.stringify(body),
			signal
		});
	}
};

//#endregion
//#region src/translate/anthropic.ts
/**
* The Claude Code identity block. The subscription endpoint rejects requests
* that do not present as Claude Code, so this block is REQUIRED as the first
* system entry on every request.
*/
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
/** Flatten a tool result's content to plain text for `tool_result`. */
function toolResultText(block) {
	return block.content.map((part) => part.type === "text" ? part.text : "").join("");
}
/** Parse a tool call's raw JSON arguments into Anthropic's object-shaped `input`. */
function parseToolInput(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
		return {};
	} catch {
		return {};
	}
}
/**
* Convert harness messages into Anthropic messages. Consecutive same-role
* messages merge into one message with multiple content blocks; tool results
* arrive as user messages with `tool_result` blocks; system-role messages are
* handled by {@link toAnthropicSystem} and skipped here. Reasoning blocks are
* not replayed (v1). Images must arrive pre-resolved
* ({@link TranslatableMessage}); an unresolved ImageBlock is skipped because
* its bytes are unreachable here.
* @param messages - ordered conversation messages with resolved images.
* @returns Anthropic messages in conversation order.
*/
function toAnthropicMessages(messages) {
	const out = [];
	for (const message of messages) {
		if (message.role === "system") continue;
		const role = message.role;
		const blocks = [];
		for (const block of message.content) switch (block.type) {
			case "text":
				blocks.push({
					type: "text",
					text: block.text
				});
				break;
			case "tool-call":
				blocks.push({
					type: "tool_use",
					id: String(block.id),
					name: block.name,
					input: parseToolInput(block.arguments)
				});
				break;
			case "tool-result":
				blocks.push({
					type: "tool_result",
					tool_use_id: String(block.toolCallId),
					content: toolResultText(block),
					...block.isError === true ? { is_error: true } : {}
				});
				break;
			case "image":
				if ("dataBase64" in block) blocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: block.mediaType,
						data: block.dataBase64
					}
				});
				break;
			default: break;
		}
		if (blocks.length === 0) continue;
		const last = out[out.length - 1];
		if (last !== void 0 && last.role === role) last.content.push(...blocks);
		else out.push({
			role,
			content: blocks
		});
	}
	return out;
}
/**
* Build the Anthropic `system` array: the mandatory Claude Code identity
* block, then the explicit system prompt, then any system-role messages.
* @param system - explicit system prompt, when set.
* @param messages - conversation messages; their system-role text is appended.
* @returns the system content blocks.
*/
function toAnthropicSystem(system, messages) {
	const blocks = [{
		type: "text",
		text: CLAUDE_CODE_IDENTITY
	}];
	if (system !== void 0 && system.length > 0) blocks.push({
		type: "text",
		text: system
	});
	for (const message of messages ?? []) {
		if (message.role !== "system") continue;
		for (const block of message.content) if (block.type === "text") blocks.push({
			type: "text",
			text: block.text
		});
	}
	return blocks;
}
/**
* Map harness tool schemas to Anthropic tools.
* @param tools - tool schemas from the request.
* @returns Anthropic `tools` array entries.
*/
function toAnthropicTools(tools) {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters
	}));
}
/** Assemble the final ContentBlock for one open block. */
function closeBlock(block) {
	switch (block.kind) {
		case "text": return {
			type: "text",
			text: block.text
		};
		case "reasoning": return {
			type: "reasoning",
			text: block.text
		};
		case "tool-call": return {
			type: "tool-call",
			id: CallId(block.callId),
			name: block.name ?? "",
			arguments: block.text
		};
	}
}
/**
* Classify an Anthropic `error` event into a thrown LlmError.
* @param error - the wire error object.
* @returns the mapped error.
*/
function anthropicFailure(error) {
	const type = error?.type ?? "unknown_error";
	const message = error?.message ?? `Anthropic reported ${type}`;
	if (type === "invalid_request_error" && /prompt is too long/i.test(message)) return new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE);
	if (type === "rate_limit_error") return new LlmError(message, "RATE_LIMIT");
	if (type === "authentication_error") return new LlmError(message, "AUTH");
	return new LlmError(message, "SERVER");
}
/**
* Push-model Anthropic SSE translator: feed each parsed event object to
* {@link push} and collect the emitted harness StreamChunks. Block indexes
* are allocated in first-seen order; `usage` is emitted before the terminal
* `finish`, and nothing is emitted after it. `error` events throw
* {@link LlmError}.
*/
var AnthropicStreamTranslator = class {
	blocks = /* @__PURE__ */ new Map();
	nextIndex = 0;
	sawAnyBlock = false;
	pendingUsage;
	outputTokens;
	stopReason = "stop";
	usageEmitted = false;
	/** Set once `message_stop` produced the terminal finish chunk. */
	terminated = false;
	open(wireIndex, kind, chunks, callId = "", name$1) {
		const block = {
			index: this.nextIndex++,
			kind,
			text: "",
			callId,
			...name$1 === void 0 ? {} : { name: name$1 }
		};
		this.blocks.set(wireIndex, block);
		this.sawAnyBlock = true;
		chunks.push({
			type: "block-start",
			index: block.index,
			blockType: kind
		});
		return block;
	}
	emitUsage(chunks) {
		if (this.usageEmitted) return;
		this.usageEmitted = true;
		const usage = {
			inputTokens: this.pendingUsage?.inputTokens ?? 0,
			outputTokens: this.outputTokens ?? 0,
			...this.pendingUsage?.cacheReadTokens !== void 0 ? { cacheReadTokens: this.pendingUsage.cacheReadTokens } : {},
			...this.pendingUsage?.cacheWriteTokens !== void 0 ? { cacheWriteTokens: this.pendingUsage.cacheWriteTokens } : {}
		};
		chunks.push({
			type: "usage",
			usage
		});
	}
	/**
	* Process one parsed Anthropic SSE event.
	* @param event - the parsed event object.
	* @returns the StreamChunks this event produced (possibly none).
	*/
	push(event) {
		if (this.terminated) return [];
		const chunks = [];
		switch (event.type) {
			case "message_start": {
				const usage = event.message?.usage;
				if (usage !== void 0) {
					this.pendingUsage = {
						inputTokens: usage.input_tokens ?? 0,
						...usage.cache_read_input_tokens !== void 0 ? { cacheReadTokens: usage.cache_read_input_tokens } : {},
						...usage.cache_creation_input_tokens !== void 0 ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {}
					};
					this.outputTokens = usage.output_tokens ?? this.outputTokens;
				}
				return chunks;
			}
			case "content_block_start": {
				const wireIndex = event.index ?? 0;
				const block = event.content_block;
				switch (block?.type) {
					case "text":
						this.open(wireIndex, "text", chunks);
						break;
					case "thinking":
						this.open(wireIndex, "reasoning", chunks);
						break;
					case "tool_use": {
						const opened = this.open(wireIndex, "tool-call", chunks, block.id ?? "", block.name);
						chunks.push({
							type: "tool-call-delta",
							index: opened.index,
							id: CallId(opened.callId),
							...block.name === void 0 ? {} : { name: block.name },
							argumentsDelta: ""
						});
						break;
					}
					default: break;
				}
				return chunks;
			}
			case "content_block_delta": {
				const wireIndex = event.index ?? 0;
				const block = this.blocks.get(wireIndex);
				const delta = event.delta;
				if (block === void 0 || delta === void 0) return chunks;
				switch (delta.type) {
					case "text_delta":
						block.text += delta.text ?? "";
						chunks.push({
							type: "text-delta",
							index: block.index,
							text: delta.text ?? ""
						});
						break;
					case "thinking_delta":
						block.text += delta.thinking ?? "";
						chunks.push({
							type: "reasoning-delta",
							index: block.index,
							text: delta.thinking ?? ""
						});
						break;
					case "input_json_delta":
						block.text += delta.partial_json ?? "";
						chunks.push({
							type: "tool-call-delta",
							index: block.index,
							id: CallId(block.callId),
							...block.name === void 0 ? {} : { name: block.name },
							argumentsDelta: delta.partial_json ?? ""
						});
						break;
					default: break;
				}
				return chunks;
			}
			case "content_block_stop": {
				const wireIndex = event.index ?? 0;
				const block = this.blocks.get(wireIndex);
				if (block === void 0) return chunks;
				this.blocks.delete(wireIndex);
				chunks.push({
					type: "block-end",
					index: block.index,
					block: closeBlock(block)
				});
				return chunks;
			}
			case "message_delta":
				if (event.usage?.output_tokens !== void 0) this.outputTokens = event.usage.output_tokens;
				switch (event.delta?.stop_reason) {
					case "end_turn":
					case "stop_sequence":
						this.stopReason = "stop";
						break;
					case "tool_use":
						this.stopReason = "tool-calls";
						break;
					case "max_tokens":
						this.stopReason = "max-tokens";
						break;
					default: break;
				}
				return chunks;
			case "message_stop":
				this.terminated = true;
				for (const [wireIndex, block] of [...this.blocks]) {
					this.blocks.delete(wireIndex);
					chunks.push({
						type: "block-end",
						index: block.index,
						block: closeBlock(block)
					});
				}
				this.emitUsage(chunks);
				if (this.stopReason === "stop" && !this.sawAnyBlock) chunks.push({
					type: "finish",
					reason: {
						kind: "error",
						failure: {
							message: "model returned a completed response with no content",
							code: EMPTY_RESPONSE_CODE
						}
					}
				});
				else chunks.push({
					type: "finish",
					reason: { kind: this.stopReason }
				});
				return chunks;
			case "error": throw anthropicFailure(event.error);
			default: return chunks;
		}
	}
};
/**
* Consume an Anthropic SSE byte stream and yield harness StreamChunks.
* @param stream - raw response body.
* @param onActivity - transport-activity callback for the idle watchdog.
* @returns the chunk stream; throws when the stream ends before `message_stop`.
*/
async function* streamAnthropic(stream, onActivity) {
	const translator = new AnthropicStreamTranslator();
	for await (const sseEvent of parseSse(stream, onActivity)) {
		let event;
		try {
			event = JSON.parse(sseEvent.data);
		} catch {
			throw new LlmError(`malformed SSE payload: ${sseEvent.data.slice(0, 120)}`, "MALFORMED_RESPONSE");
		}
		yield* translator.push(event);
		if (translator.terminated) return;
	}
	throw new LlmError("Anthropic SSE stream ended before message_stop", "STREAM_CLOSED");
}

//#endregion
//#region src/providers/claude.ts
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN_URL = "https://claude.ai/v1/oauth/token";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages?beta=true";
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models?beta=true";
const CLAUDE_SCOPE = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const CLAUDE_CONTEXT_WINDOW = 2e5;
const CLAUDE_DEFAULT_MAX_TOKENS = 32e3;
/** Refresh when the access token has less than this much life left. */
const CLAUDE_PREEMPT_MS = 5 * 6e4;
/**
* The subscription endpoint only serves requests presenting as Claude Code,
* so these headers impersonate the CLI; the harness attribution user-agent
* cannot be sent here (one user-agent slot, and the CLI's wins).
*/
const CLAUDE_CLI_FALLBACK_VERSION = "2.1.234";
function detectClaudeVersion() {
	try {
		const match = execFileSync("claude", ["--version"], {
			timeout: 3e3,
			encoding: "utf8"
		}).match(/^(\d+\.\d+\.\d+)/);
		if (match) return match[1];
	} catch {}
	return CLAUDE_CLI_FALLBACK_VERSION;
}
let claudeCliUserAgent;
function getClaudeCliUserAgent() {
	if (claudeCliUserAgent === void 0) claudeCliUserAgent = `claude-cli/${detectClaudeVersion()} (external, cli)`;
	return claudeCliUserAgent;
}
const CLAUDE_BETA_FALLBACK = [
	"claude-code-20250219",
	"oauth-2025-04-20",
	"interleaved-thinking-2025-05-14",
	"context-management-2025-06-27",
	"effort-2025-11-24",
	"compact-2026-01-12",
	"files-api-2025-04-14"
].join(",");
const CLAUDE_BETA_FLAGS = CLAUDE_BETA_FALLBACK;
/** Best-effort account profile; login must not fail when this does. */
async function fetchClaudeProfile(accessToken) {
	try {
		const response = await fetch(CLAUDE_PROFILE_URL, { headers: { authorization: `Bearer ${accessToken}` } });
		if (!response.ok) return {};
		const profile = await response.json();
		const account = typeof profile.account === "object" && profile.account !== null ? profile.account : {};
		const email = profile.emailAddress ?? profile.email ?? account.email_address ?? account.email;
		const subscription = profile.subscriptionType ?? profile.subscription_type ?? account.subscription_type;
		return {
			...typeof email === "string" && email.length > 0 ? { emailAddress: email } : {},
			...typeof subscription === "string" && subscription.length > 0 ? { subscriptionType: subscription } : {}
		};
	} catch {
		return {};
	}
}
/** Build a session from a token response. */
async function claudeSession(tokens, fallbackRefreshToken, withProfile) {
	if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) throw new Error("claude token endpoint returned no access token");
	const refreshToken = tokens.refresh_token ?? fallbackRefreshToken;
	if (refreshToken === void 0) throw new Error("claude token endpoint returned no refresh token");
	if (typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) throw new Error("claude token endpoint returned no usable expiry");
	const profile = withProfile ? await fetchClaudeProfile(tokens.access_token) : {};
	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt: Date.now() + tokens.expires_in * 1e3,
		scopes: tokens.scope ?? CLAUDE_SCOPE,
		...profile
	};
}
/**
* Exchange an authorization code for a claude session (JSON grant).
* @param code - the authorization code from the callback.
* @param verifier - the PKCE verifier minted for the attempt.
* @param redirectUri - the attempt's redirect URI.
* @param state - the attempt's state (echoed to the token endpoint).
* @returns the session to store.
*/
async function exchangeClaudeCode(code, verifier, redirectUri, state) {
	const response = await fetch(CLAUDE_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: CLAUDE_CLIENT_ID,
			code_verifier: verifier,
			state
		})
	});
	if (!response.ok) throw await oauthEndpointError(response, "claude");
	return claudeSession(await response.json(), void 0, true);
}
/**
* Refresh a claude session (JSON grant echoing the issued scope).
* @param session - the stored session.
* @returns the fresh session to store.
*/
async function refreshClaude(session) {
	const response = await fetch(CLAUDE_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: session.refreshToken,
			client_id: CLAUDE_CLIENT_ID,
			scope: session.scopes
		})
	});
	if (!response.ok) throw await oauthEndpointError(response, "claude");
	return {
		...await claudeSession(await response.json(), session.refreshToken, false),
		...session.emailAddress === void 0 ? {} : { emailAddress: session.emailAddress },
		...session.subscriptionType === void 0 ? {} : { subscriptionType: session.subscriptionType }
	};
}
/**
* Whether a claude refresh failure means the login is permanently gone.
* @param error - the thrown refresh error.
* @returns true when re-login is the only fix.
*/
function isClaudePermanentRefreshError(error) {
	return error instanceof OAuthEndpointError && (error.oauthCode === "invalid_grant" || error.oauthCode === "invalid_token");
}
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/** RFC3339 `resets_at` value â†’ epoch ms, or undefined when absent/unparsable. */
function claudeResetsAt(value) {
	if (typeof value !== "string" || value.length === 0) return void 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/** Map one legacy `{utilization, resets_at}` bucket; undefined when null or unusable. */
function claudeLegacyWindow(value, kind, scope) {
	if (typeof value !== "object" || value === null) return void 0;
	const bucket = value;
	if (typeof bucket.utilization !== "number" || !Number.isFinite(bucket.utilization)) return void 0;
	const resetsAt = claudeResetsAt(bucket.resets_at);
	return {
		kind,
		...scope === void 0 ? {} : { scope },
		usedPercent: bucket.utilization,
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/** Map the modern `limits` array; empty when absent or carrying nothing usable. */
function claudeLimitsWindows(value) {
	if (!Array.isArray(value)) return [];
	const windows = [];
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw;
		if (typeof entry.percent !== "number" || !Number.isFinite(entry.percent)) continue;
		const kind = entry.kind === "session" ? "session" : entry.kind === "weekly_all" || entry.kind === "weekly_scoped" ? "weekly" : "other";
		const scope = entry.scope?.model?.display_name;
		const resetsAt = claudeResetsAt(entry.resets_at);
		windows.push({
			kind,
			...typeof scope === "string" && scope.length > 0 ? { scope } : {},
			usedPercent: entry.percent,
			...resetsAt === void 0 ? {} : { resetsAt }
		});
	}
	return windows;
}
/**
* Fetch the claude subscription usage from the OAuth usage endpoint (the
* source of Claude Code's `/usage` screen). Newer responses carry a
* structured `limits` array; older ones the flat `five_hour`/`seven_day*`
* buckets â€” both shapes are read, the array winning when it has entries.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @param signal - caller cancellation from the RPC transport.
* @returns the mapped usage snapshot.
*/
async function fetchClaudeUsage(session, fetchFn = fetch, signal) {
	const response = await fetchFn(CLAUDE_USAGE_URL, {
		headers: {
			"authorization": `Bearer ${session.accessToken}`,
			"anthropic-beta": "oauth-2025-04-20",
			"user-agent": getClaudeCliUserAgent(),
			"accept": "application/json"
		},
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) throw await oauthEndpointError(response, "claude usage");
	const payload = await response.json();
	const modern = claudeLimitsWindows(payload.limits);
	if (modern.length > 0) return {
		supported: true,
		windows: modern
	};
	const windows = [];
	const legacy = [
		claudeLegacyWindow(payload.five_hour, "session"),
		claudeLegacyWindow(payload.seven_day, "weekly"),
		claudeLegacyWindow(payload.seven_day_opus, "weekly", "Opus"),
		claudeLegacyWindow(payload.seven_day_sonnet, "weekly", "Sonnet")
	];
	for (const window of legacy) if (window !== void 0) windows.push(window);
	return {
		supported: true,
		windows
	};
}
function claudeThinkingType(capabilities) {
	const types = capabilities?.thinking?.types;
	if (types?.enabled?.supported === true) return "enabled";
	if (types?.adaptive?.supported === true) return "adaptive";
}
/** Effort levels in display order; a model exposes only the ones it advertises as supported. */
const CLAUDE_EFFORT_LEVELS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function claudeReasoning(capabilities) {
	const effort = capabilities?.effort;
	if (effort?.supported !== true) return void 0;
	const efforts = CLAUDE_EFFORT_LEVELS.filter((level) => effort[level]?.supported === true).map((level) => ({
		id: ReasoningEffortId(level),
		name: level[0].toUpperCase() + level.slice(1)
	}));
	return efforts.length > 0 ? { efforts } : void 0;
}
/** Fetch the live model catalog from the subscription endpoint. */
async function fetchClaudeModels(session, fetchFn = fetch) {
	const response = await fetchFn(CLAUDE_MODELS_URL, { headers: {
		"authorization": `Bearer ${session.accessToken}`,
		"anthropic-version": "2023-06-01",
		"user-agent": getClaudeCliUserAgent(),
		"anthropic-dangerous-direct-browser-access": "true",
		"accept": "application/json"
	} });
	if (!response.ok) throw await httpLlmError(response, "claude models API");
	const payload = await response.json();
	if (!Array.isArray(payload.data)) throw new Error("claude models API returned an invalid catalog");
	const models = payload.data.filter((m) => typeof m.id === "string").map((m) => {
		const thinkingType = claudeThinkingType(m.capabilities);
		const reasoning = claudeReasoning(m.capabilities);
		return {
			id: m.id,
			name: m.display_name ?? m.id,
			...thinkingType === void 0 ? {} : { thinkingType },
			...reasoning === void 0 ? {} : { reasoning }
		};
	});
	if (models.length === 0) throw new Error("claude models API returned an empty catalog");
	return models;
}
/**
* Claude Code's own SDK retry shape: exponential backoff starting at 1s,
* doubling per attempt, capped at 60s, plus jitter. `maxRetries` is the
* count of retries after the first attempt (Claude Code defaults to 10).
*/
const CLAUDE_RETRY_INITIAL_DELAY_MS = 1e3;
const CLAUDE_RETRY_MAX_DELAY_MS = 6e4;
const CLAUDE_RETRY_JITTER_RATIO = .2;
/** The Claude 4.5 family accepts image input. */
const CLAUDE_MODALITIES = ["text", "image"];
/** Claude wire adapter: one instance serves the `claude` provider route. */
var ClaudeAdapter = class extends LlmAdapter {
	catalog;
	constructor(options) {
		super();
		this.options = options;
		this.catalog = new ModelCatalogCache(options.catalogStore);
	}
	async fetchCatalog() {
		return fetchClaudeModels(await this.options.tokens.session(), this.options.fetchFn);
	}
	async discovered(model) {
		if (!this.options.discovery) return void 0;
		return (await this.catalog.resolve(() => this.fetchCatalog()))?.find((entry) => entry.id === model);
	}
	staticModels(provider) {
		return this.options.models.map((model) => ({
			provider,
			id: model.id,
			name: model.name ?? model.id,
			inputModalities: model.inputModalities ?? CLAUDE_MODALITIES
		}));
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: "Claude (Subscription)"
		};
	}
	providerRetryPolicy(provider) {
		if (this.options.maxRetries === void 0) return void 0;
		return resolveRetryPolicy({
			mode: "normal",
			maxRetries: this.options.maxRetries,
			backoff: {
				initialDelayMs: CLAUDE_RETRY_INITIAL_DELAY_MS,
				maxDelayMs: CLAUDE_RETRY_MAX_DELAY_MS,
				jitterRatio: CLAUDE_RETRY_JITTER_RATIO
			}
		}, `claude: provider "${provider}" retryPolicy`);
	}
	async listModels(provider) {
		if (await this.options.tokens.peek() === void 0) return [];
		if (!this.options.discovery) return this.staticModels(provider);
		try {
			return (await this.catalog.get(() => this.fetchCatalog())).map((model) => ({
				provider,
				id: model.id,
				name: model.name,
				inputModalities: CLAUDE_MODALITIES
			}));
		} catch (error) {
			if (error instanceof LlmError && (error.code === "MISSING_CREDENTIAL" || error.code === "INVALID_CREDENTIAL")) return [];
			if (error instanceof LlmError && error.code === "AUTH") this.catalog.invalidate();
			this.options.onWarn?.(`claude model discovery failed; using the built-in catalog (${errorChain(error)})`);
			return this.staticModels(provider);
		}
	}
	async resolveModel(provider, model) {
		const disc = await this.discovered(model);
		const configured = this.options.models.find((entry) => entry.id === model);
		const reasoning = disc?.reasoning;
		return {
			provider,
			id: model,
			name: disc?.name ?? configured?.name ?? model,
			inputModalities: configured?.inputModalities ?? CLAUDE_MODALITIES,
			context: { contextWindow: disc?.contextWindow ?? configured?.contextWindow ?? CLAUDE_CONTEXT_WINDOW },
			defaultMaxTokens: configured?.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS,
			...reasoning === void 0 ? {} : { reasoning }
		};
	}
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			let session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) {
				session = await this.options.tokens.session(true);
				response = await this.request(options, session, watchdog.signal);
			}
			if (!response.ok) throw await httpLlmError(response, "claude API");
			if (response.body === null) throw new LlmError("claude API returned no response body", EMPTY_RESPONSE_CODE);
			yield* streamAnthropic(response.body, () => {
				watchdog.pulse();
			});
		} catch (error) {
			throw mapFetchFailure("claude API", error, watchdog, options.signal);
		} finally {
			watchdog.stop();
		}
	}
	/**
	* `display: 'summarized'` is set explicitly on both shapes: `adaptive`-type
	* models default to `display: 'omitted'`, which returns thinking blocks with
	* an empty `thinking` field â€” without this override the "Think" panel would
	* always render empty even though real reasoning (and billed thinking_tokens)
	* ran.
	*/
	thinkingParam(thinkingType, maxTokens) {
		if (thinkingType === "adaptive") return {
			type: "adaptive",
			display: "summarized"
		};
		if (thinkingType === "enabled") {
			const budget = Math.min(Math.max(1024, Math.floor(maxTokens * .5)), maxTokens - 100);
			if (budget < 1024) return void 0;
			return {
				type: "enabled",
				budget_tokens: budget,
				display: "summarized"
			};
		}
	}
	async request(options, session, signal) {
		const messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
		const maxTokens = options.maxTokens ?? this.options.models.find((entry) => entry.id === options.model)?.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS;
		const disc = await this.discovered(options.model);
		const thinking = this.thinkingParam(disc?.thinkingType, maxTokens);
		const effort = options.reasoningEffort !== void 0 && disc?.reasoning !== void 0 ? { output_config: { effort: String(options.reasoningEffort) } } : {};
		const body = {
			model: options.model,
			max_tokens: maxTokens,
			system: toAnthropicSystem(options.system, messages),
			messages: toAnthropicMessages(messages),
			...options.tools !== void 0 && options.tools.length > 0 ? { tools: toAnthropicTools(options.tools) } : {},
			...thinking === void 0 ? {} : { thinking },
			...effort,
			stream: true,
			...options.sessionId !== void 0 ? { metadata: { user_id: String(options.sessionId) } } : {}
		};
		return fetch(CLAUDE_API_URL, {
			method: "POST",
			headers: {
				"authorization": `Bearer ${session.accessToken}`,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": CLAUDE_BETA_FLAGS,
				"user-agent": getClaudeCliUserAgent(),
				"x-app": "cli",
				"anthropic-dangerous-direct-browser-access": "true",
				"accept": "text/event-stream",
				"content-type": "application/json"
			},
			body: JSON.stringify(body),
			signal
		});
	}
};

//#endregion
//#region src/providers/grok.ts
const GROK_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const GROK_DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
const GROK_API_URL = "https://api.x.ai/v1/responses";
const GROK_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const GROK_CALLBACK_PATH = "/callback";
const GROK_CONTEXT_WINDOW = 256e3;
const GROK_DEFAULT_MAX_TOKENS = 32e3;
/** Refresh when the access token has less than this much life left. */
const GROK_PREEMPT_MS = 2 * 6e4;
/** A discovered URL must be https on x.ai or a subdomain; anything else is a hostile document. */
function assertXaiEndpoint(url, field) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`grok OIDC discovery returned an invalid ${field}`);
	}
	if (parsed.protocol !== "https:" || parsed.hostname !== "x.ai" && !parsed.hostname.endsWith(".x.ai")) throw new Error(`grok OIDC discovery returned a non-x.ai ${field}: ${url}`);
	return url;
}
let discoveryCache;
/**
* Resolve the xAI OIDC endpoints (cached after the first fetch).
* @returns validated authorization and token endpoints.
*/
async function grokDiscovery() {
	if (discoveryCache !== void 0) return discoveryCache;
	const response = await fetch(GROK_DISCOVERY_URL);
	if (!response.ok) throw await oauthEndpointError(response, "grok OIDC discovery");
	const document = await response.json();
	if (typeof document.authorization_endpoint !== "string" || typeof document.token_endpoint !== "string") throw new Error("grok OIDC discovery document is missing endpoints");
	discoveryCache = {
		authorizationEndpoint: assertXaiEndpoint(document.authorization_endpoint, "authorization_endpoint"),
		tokenEndpoint: assertXaiEndpoint(document.token_endpoint, "token_endpoint")
	};
	return discoveryCache;
}
/**
* Build the grok flow facts for the OAuth flow engine (async because the
* authorize URL comes from OIDC discovery).
* @returns the flow spec for one attempt.
*/
async function grokFlow() {
	const discovery = await grokDiscovery();
	return {
		callbackPath: GROK_CALLBACK_PATH,
		listen: {
			host: "127.0.0.1",
			ports: [56121]
		},
		buildAuthorizeUrl({ redirectUri, state, pkce, nonce }) {
			const params = new URLSearchParams({
				response_type: "code",
				client_id: GROK_CLIENT_ID,
				redirect_uri: redirectUri,
				scope: GROK_SCOPE,
				code_challenge: pkce.challenge,
				code_challenge_method: "S256",
				state,
				nonce,
				plan: "generic",
				referrer: "dsh-plugin-subscriptions"
			});
			return `${discovery.authorizationEndpoint}?${params.toString()}`;
		}
	};
}
/**
* Display names for the numeric `tier` claim xAI stamps on OAuth access
* tokens (the `prod_auth.SubscriptionTier` proto enum; the mapping mirrors
* grok-build's `jwt_tier_claim`). Unknown values fall through to the raw
* number so a future tier still shows something.
*/
const GROK_TIER_NAMES = {
	0: "Free",
	1: "SuperGrok",
	2: "X Basic",
	3: "X Premium",
	4: "X Premium+",
	5: "SuperGrok Heavy",
	6: "SuperGrok Lite",
	7: "SuperGrok Plus"
};
/**
* The subscription tier encoded in a grok access token's `tier` claim (no
* verification â€” same trust posture as the other claim reads).
* @param accessToken - the stored access token.
* @returns the display tier name, or undefined when the claim is absent.
*/
function grokTierName(accessToken) {
	const tier = decodeJwtPayload(accessToken)?.tier;
	if (typeof tier !== "number" || !Number.isInteger(tier)) return void 0;
	return GROK_TIER_NAMES[tier] ?? String(tier);
}
/** Pick a display account from an id token's claims. */
function grokAccount(idToken) {
	const payload = idToken === void 0 ? void 0 : decodeJwtPayload(idToken);
	const claim = payload?.email ?? payload?.preferred_username ?? payload?.name ?? payload?.sub;
	return typeof claim === "string" && claim.length > 0 ? claim : void 0;
}
/** Build a session from a token response. */
function grokSession(tokens, tokenEndpoint, fallbackRefreshToken) {
	if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) throw new Error("grok token endpoint returned no access token");
	const refreshToken = tokens.refresh_token ?? fallbackRefreshToken;
	if (refreshToken === void 0) throw new Error("grok token endpoint returned no refresh token");
	if (typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) throw new Error("grok token endpoint returned no usable expiry");
	const account = grokAccount(tokens.id_token);
	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt: Date.now() + tokens.expires_in * 1e3,
		tokenEndpoint,
		...typeof tokens.scope === "string" ? { scopes: tokens.scope } : {},
		...account === void 0 ? {} : { account }
	};
}
/**
* Exchange an authorization code for a grok session (form-encoded grant that
* echoes the PKCE challenge as well as the verifier, per the xAI flow).
* A 403 here means the X plan lacks the API OAuth entitlement.
* @param code - the authorization code from the callback.
* @param verifier - the PKCE verifier minted for the attempt.
* @param redirectUri - the attempt's redirect URI.
* @param challenge - the PKCE challenge sent at authorize time.
* @returns the session to store.
*/
async function exchangeGrokCode(code, verifier, redirectUri, challenge) {
	const discovery = await grokDiscovery();
	const response = await fetch(discovery.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: GROK_CLIENT_ID,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
			code_challenge: challenge,
			code_challenge_method: "S256"
		}).toString()
	});
	if (response.status === 403) throw new OAuthEndpointError("grok token endpoint refused the exchange (HTTP 403): your X plan does not include the API OAuth entitlement; an X Premium or xAI subscription with API access is required", 403);
	if (!response.ok) throw await oauthEndpointError(response, "grok");
	return grokSession(await response.json(), discovery.tokenEndpoint);
}
/**
* Refresh a grok session (form-encoded grant).
* @param session - the stored session.
* @returns the fresh session to store.
*/
async function refreshGrok(session) {
	const response = await fetch(session.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: GROK_CLIENT_ID,
			refresh_token: session.refreshToken
		}).toString()
	});
	if (!response.ok) throw await oauthEndpointError(response, "grok");
	const next = grokSession(await response.json(), session.tokenEndpoint, session.refreshToken);
	return {
		...next,
		...session.account === void 0 ? {} : { account: session.account },
		...next.scopes === void 0 && session.scopes !== void 0 ? { scopes: session.scopes } : {}
	};
}
/**
* Whether a grok refresh failure means the login is permanently gone.
* @param error - the thrown refresh error.
* @returns true when re-login is the only fix.
*/
function isGrokPermanentRefreshError(error) {
	return error instanceof OAuthEndpointError && error.oauthCode === "invalid_grant";
}
/**
* The Grok Build CLI chat proxy's billing endpoint (the source of the CLI's
* `/usage` "Usage limit" panel; see xai-org/grok-build
* `extensions/billing.rs`). Forwards to the backend `GetGrokCreditsConfig`.
*/
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
/** RFC3339 timestamp â†’ epoch ms, or undefined when absent/unparsable. */
function grokResetsAt(value) {
	if (typeof value !== "string" || value.length === 0) return void 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/**
* Fetch the grok subscription usage from the Grok Build CLI chat proxy. The
* newer credits config carries a ready-made percentage plus the current
* (typically weekly) period; the legacy shape carries cent-valued
* `monthlyLimit`/`used`, from which the percentage is derived.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @param signal - caller cancellation from the RPC transport.
* @returns the mapped usage snapshot.
*/
async function fetchGrokUsage(session, fetchFn = fetch, signal) {
	const response = await fetchFn(GROK_BILLING_URL, {
		headers: {
			"authorization": `Bearer ${session.accessToken}`,
			"x-xai-token-auth": "xai-grok-cli",
			"accept": "application/json",
			...attributionHeaders()
		},
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) throw await oauthEndpointError(response, "grok billing");
	const payload = await response.json();
	const config = typeof payload.config === "object" && payload.config !== null ? payload.config : {};
	const windows = [];
	if (typeof config.creditUsagePercent === "number" && Number.isFinite(config.creditUsagePercent)) {
		const kind = config.currentPeriod?.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "weekly" : "other";
		const resetsAt = grokResetsAt(config.currentPeriod?.end);
		windows.push({
			kind,
			usedPercent: config.creditUsagePercent,
			...resetsAt === void 0 ? {} : { resetsAt }
		});
	} else if (typeof config.monthlyLimit?.val === "number" && config.monthlyLimit.val > 0) {
		const used = typeof config.used?.val === "number" ? config.used.val : 0;
		const resetsAt = grokResetsAt(config.billingPeriodEnd);
		windows.push({
			kind: "other",
			usedPercent: used / config.monthlyLimit.val * 100,
			...resetsAt === void 0 ? {} : { resetsAt }
		});
	}
	const plan = typeof payload.subscriptionTier === "string" && payload.subscriptionTier.length > 0 ? payload.subscriptionTier : grokTierName(session.accessToken);
	return {
		supported: true,
		windows,
		...plan === void 0 ? {} : { plan }
	};
}
const GROK_MODELS_URL = "https://api.x.ai/v1/models";
/**
* Input modalities for one grok model: chat models (grok-4 family) accept
* images; code and embedding models are text-only.
*/
function grokModalities(id) {
	return /code|embed/i.test(id) ? ["text"] : ["text", "image"];
}
/**
* The Grok Build CLI chat proxy's model catalog â€” the only grok endpoint that
* advertises reasoning capability. The `api.x.ai/v1/models` and
* `/v1/language-models` payloads carry pricing, context, and aliases only, so
* effort metadata must come from here (the same source the official CLI's
* picker uses).
*/
const GROK_CLI_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models";
/** Map one CLI catalog entry's reasoning fields, or undefined when unsupported. */
function grokCliReasoning(entry) {
	if (entry.supports_reasoning_effort !== true) return void 0;
	const efforts = (entry.reasoning_efforts ?? []).filter((level) => typeof level.value === "string" && level.value.length > 0).map((level) => ({
		id: ReasoningEffortId(level.value),
		name: typeof level.label === "string" && level.label.length > 0 ? level.label : level.value,
		...typeof level.description === "string" && level.description.length > 0 ? { description: level.description } : {}
	}));
	if (efforts.length === 0) return void 0;
	const defaultEffort = typeof entry.reasoning_effort === "string" && efforts.some((effort) => effort.id === ReasoningEffortId(entry.reasoning_effort)) ? ReasoningEffortId(entry.reasoning_effort) : void 0;
	return {
		efforts,
		...defaultEffort === void 0 ? {} : { defaultEffort }
	};
}
/**
* Fetch the CLI catalog and index its per-model metadata by model id.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @returns model id â†’ contributed metadata.
*/
async function fetchGrokCliCatalog(session, fetchFn = fetch) {
	const response = await fetchFn(GROK_CLI_MODELS_URL, { headers: {
		"authorization": `Bearer ${session.accessToken}`,
		"x-xai-token-auth": "xai-grok-cli",
		"accept": "application/json",
		...attributionHeaders()
	} });
	if (!response.ok) throw await oauthEndpointError(response, "grok CLI catalog");
	const payload = await response.json();
	if (!Array.isArray(payload.data)) throw new Error("grok CLI catalog returned no data array");
	const catalog = /* @__PURE__ */ new Map();
	for (const entry of payload.data) {
		if (typeof entry.id !== "string" || entry.id.length === 0) continue;
		const reasoning = grokCliReasoning(entry);
		catalog.set(entry.id, {
			...typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {},
			...typeof entry.description === "string" && entry.description.length > 0 ? { description: entry.description } : {},
			...typeof entry.context_window === "number" && entry.context_window > 0 ? { contextWindow: entry.context_window } : {},
			...reasoning === void 0 ? {} : { reasoning }
		});
	}
	return catalog;
}
/**
* The /v1/models list also serves generation models that cannot chat
* (grok-imagine-image*, grok-imagine-video*) and embedding models; the picker
* must not offer them. Heuristic over the id substring, verified against the
* live catalog (grok-build-0.1 and the grok-4 family pass).
*/
function isChatModel(id) {
	return !/imagine|image-|video|embed/i.test(id);
}
/**
* Fetch the live grok model list, enriched with the CLI catalog's per-model
* metadata (display name, context window, reasoning efforts). The api.x.ai
* list stays authoritative for which models exist; the CLI catalog is
* enrichment only, so its failure degrades to a plain list instead of taking
* discovery down â€” models it does not cover simply expose no efforts.
* @param session - the stored session (used as-is; never refreshed here).
* @param fetchFn - fetch implementation (injectable for tests).
* @param onWarn - warning sink for a failed CLI catalog fetch.
* @returns discovered chat models in endpoint order.
*/
async function fetchGrokModels(session, fetchFn = fetch, onWarn) {
	const [response, cliCatalog] = await Promise.all([fetchFn(GROK_MODELS_URL, { headers: {
		"authorization": `Bearer ${session.accessToken}`,
		"accept": "application/json",
		...attributionHeaders()
	} }), fetchGrokCliCatalog(session, fetchFn).catch((error) => {
		onWarn?.(`grok CLI catalog fetch failed; reasoning efforts are unavailable (${errorChain(error)})`);
	})]);
	if (!response.ok) throw await oauthEndpointError(response, "grok models");
	const payload = await response.json();
	if (!Array.isArray(payload.data)) throw new Error("grok models endpoint returned no data array");
	const seen = /* @__PURE__ */ new Set();
	const discovered = [];
	for (const entry of payload.data) {
		if (typeof entry.id !== "string" || entry.id.length === 0 || seen.has(entry.id)) continue;
		if (!isChatModel(entry.id)) continue;
		seen.add(entry.id);
		discovered.push({
			id: entry.id,
			name: entry.id,
			...cliCatalog?.get(entry.id)
		});
	}
	if (discovered.length === 0) throw new Error("grok models endpoint returned an empty catalog");
	return discovered;
}
/** Grok wire adapter: one instance serves the `grok` provider route. */
var GrokAdapter = class extends LlmAdapter {
	catalog;
	constructor(options) {
		super();
		this.options = options;
		this.catalog = new ModelCatalogCache(options.catalogStore);
	}
	/** Discovery fetcher: resolves the session through the refresh-aware path. */
	async fetchCatalog() {
		return fetchGrokModels(await this.options.tokens.session(), this.options.fetchFn, this.options.onWarn);
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: "Grok (Subscription)"
		};
	}
	staticModels(provider) {
		return this.options.models.map((model) => ({
			provider,
			id: model.id,
			name: model.name ?? model.id,
			inputModalities: model.inputModalities ?? grokModalities(model.id)
		}));
	}
	async listModels(provider) {
		if (await this.options.tokens.peek() === void 0) return [];
		if (!this.options.discovery) return this.staticModels(provider);
		try {
			return (await this.catalog.get(() => this.fetchCatalog())).map((model) => ({
				provider,
				id: model.id,
				name: model.name,
				...model.description === void 0 ? {} : { description: model.description },
				inputModalities: grokModalities(model.id)
			}));
		} catch (error) {
			if (error instanceof LlmError && (error.code === "MISSING_CREDENTIAL" || error.code === "INVALID_CREDENTIAL")) return [];
			if (error instanceof OAuthEndpointError && error.status === 401) this.catalog.invalidate();
			this.options.onWarn?.(`grok model discovery failed; using the built-in catalog (${errorChain(error)})`);
			return this.staticModels(provider);
		}
	}
	/**
	* The discovered entry for one model. Resolved through the cache's
	* stale-while-revalidate path: capability metadata must stay stable across
	* a long conversation â€” a session that selected a reasoning effort calls
	* this on EVERY step, and forgetting the efforts just because the TTL
	* lapsed mid-turn would fail the call with UNSUPPORTED_REASONING_EFFORT
	* before provider I/O.
	*/
	async discovered(model) {
		if (!this.options.discovery) return void 0;
		return (await this.catalog.resolve(() => this.fetchCatalog()))?.find((entry) => entry.id === model);
	}
	async resolveModel(provider, model) {
		const discovered = await this.discovered(model);
		const configured = this.options.models.find((entry) => entry.id === model);
		return {
			provider,
			id: model,
			name: discovered?.name ?? configured?.name ?? model,
			...discovered?.description === void 0 ? {} : { description: discovered.description },
			inputModalities: configured?.inputModalities ?? grokModalities(model),
			context: { contextWindow: discovered?.contextWindow ?? configured?.contextWindow ?? GROK_CONTEXT_WINDOW },
			defaultMaxTokens: configured?.maxTokens ?? GROK_DEFAULT_MAX_TOKENS,
			...discovered?.reasoning === void 0 ? {} : { reasoning: discovered.reasoning }
		};
	}
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			let session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) {
				session = await this.options.tokens.session(true);
				response = await this.request(options, session, watchdog.signal);
			}
			if (!response.ok) throw await httpLlmError(response, "grok API");
			if (response.body === null) throw new LlmError("grok API returned no response body", EMPTY_RESPONSE_CODE);
			yield* streamResponses(response.body, () => {
				watchdog.pulse();
			});
		} catch (error) {
			throw mapFetchFailure("grok API", error, watchdog, options.signal);
		} finally {
			watchdog.stop();
		}
	}
	async request(options, session, signal) {
		const { instructions, input } = toResponsesInput(await resolveImages(options.messages, this.options.resolveAttachments?.(), signal), options.system);
		const body = {
			model: options.model,
			...instructions === void 0 ? {} : { instructions },
			input,
			...options.tools !== void 0 && options.tools.length > 0 ? { tools: toResponsesTools(options.tools) } : {},
			tool_choice: "auto",
			parallel_tool_calls: true,
			...options.maxTokens !== void 0 ? { max_output_tokens: options.maxTokens } : {},
			...options.reasoningEffort !== void 0 ? { reasoning: { effort: String(options.reasoningEffort) } } : {},
			store: false,
			stream: true
		};
		return fetch(GROK_API_URL, {
			method: "POST",
			headers: {
				"authorization": `Bearer ${session.accessToken}`,
				"accept": "text/event-stream",
				"content-type": "application/json",
				...attributionHeaders()
			},
			body: JSON.stringify(body),
			signal
		});
	}
};

//#endregion
//#region src/tools/x-search.ts
/** Endpoint the search request is posted to. */
const X_SEARCH_URL = "https://api.x.ai/v1/responses";
/** Grok model the search runs on (a catalog model of the grok provider). */
const X_SEARCH_MODEL = "grok-4";
/** xAI caps each handle filter list at ten entries. */
const MAX_HANDLES = 10;
/**
* Validate and assemble the request facts from tool arguments. Throws plain
* Errors for argument problems the schema DSL cannot express (non-empty
* query, handle caps, mutually exclusive filters).
*/
function buildXSearchRequest(args) {
	const query = args.query.trim();
	if (query.length === 0) throw new Error("x_search: query must be a non-empty string");
	const allowed = normalizeHandles(args.allowed_x_handles, "allowed_x_handles");
	const excluded = normalizeHandles(args.excluded_x_handles, "excluded_x_handles");
	if (allowed.length > 0 && excluded.length > 0) throw new Error("x_search: allowed_x_handles and excluded_x_handles cannot be used together");
	const tool = { type: "x_search" };
	if (allowed.length > 0) tool.allowed_x_handles = allowed;
	if (excluded.length > 0) tool.excluded_x_handles = excluded;
	if (args.from_date !== void 0 && args.from_date.trim().length > 0) tool.from_date = args.from_date.trim();
	if (args.to_date !== void 0 && args.to_date.trim().length > 0) tool.to_date = args.to_date.trim();
	if (args.enable_image_understanding === true) tool.enable_image_understanding = true;
	if (args.enable_video_understanding === true) tool.enable_video_understanding = true;
	return {
		query,
		tool
	};
}
/** Strip `@` prefixes, drop blanks, and enforce the provider's handle cap. */
function normalizeHandles(value, field) {
	if (value === void 0) return [];
	const handles = value.map((handle) => handle.trim().replace(/^@+/, "")).filter((handle) => handle.length > 0);
	if (handles.length > MAX_HANDLES) throw new Error(`x_search: ${field} supports at most ${MAX_HANDLES} handles`);
	return handles;
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Extract the answer text and citation URLs from a Responses payload: the
* `output_text` shortcut or message output parts for the answer, and both
* top-level `citations` and inline `url_citation` annotations for sources.
*/
function parseXSearchResponse(payload) {
	const body = isRecord$1(payload) ? payload : {};
	let answer = typeof body.output_text === "string" ? body.output_text.trim() : "";
	const citations = [];
	const push = (url) => {
		if (typeof url === "string" && url.length > 0 && !citations.includes(url)) citations.push(url);
	};
	if (Array.isArray(body.citations)) for (const citation of body.citations) push(citation);
	const parts = [];
	if (Array.isArray(body.output)) for (const item of body.output) {
		if (!isRecord$1(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
		for (const part of item.content) {
			if (!isRecord$1(part)) continue;
			if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string" && part.text.trim().length > 0) parts.push(part.text.trim());
			if (Array.isArray(part.annotations)) {
				for (const annotation of part.annotations) if (isRecord$1(annotation) && annotation.type === "url_citation") push(annotation.url);
			}
		}
	}
	if (answer.length === 0) answer = parts.join("\n\n");
	return {
		answer,
		citations
	};
}
/** Bound a call-card title's query. */
function truncate$2(text, max = 60) {
	return text.length <= max ? text : `${text.slice(0, max - 1)}â€¦`;
}
/**
* Build the `x_search` tool definition.
* @param options - grok session source and fetch implementation.
* @returns the tool to register on `ctx.tools`.
*/
function createXSearchTool(options) {
	return defineTool({
		name: "x_search",
		description: "Search X (Twitter) posts, profiles, and threads using the grok subscription's hosted xAI x_search. Use this for current discussion, reactions, or claims on X rather than general web pages.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "What to look up on X."
			},
			allowed_x_handles: {
				type: "array",
				items: { type: "string" },
				description: "X handles to include exclusively (max 10)."
			},
			excluded_x_handles: {
				type: "array",
				items: { type: "string" },
				description: "X handles to exclude (max 10)."
			},
			from_date: {
				type: "string",
				description: "Optional start date in YYYY-MM-DD format."
			},
			to_date: {
				type: "string",
				description: "Optional end date in YYYY-MM-DD format."
			},
			enable_image_understanding: {
				type: "boolean",
				description: "Whether xAI should analyze images attached to matching posts."
			},
			enable_video_understanding: {
				type: "boolean",
				description: "Whether xAI should analyze videos attached to matching posts."
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					answer: {
						type: "string",
						required: true
					},
					citations: {
						type: "array",
						items: { type: "string" },
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: value.citations.length > 0 ? `${value.answer}\n\nSources:\n${value.citations.map((citation) => `- ${citation}`).join("\n")}` : value.answer
			}],
			presentationMeta: (_args, value) => ({
				answer: value.answer,
				citations: value.citations
			})
		},
		presentCall: (args) => ({
			card: "generic",
			title: `x_search: ${truncate$2(args.query)}`,
			kind: "search"
		}),
		presentResult: (_args, result) => {
			if (result.isError || !isRecord$1(result.meta)) return void 0;
			return {
				card: "web",
				kind: "search",
				sources: (Array.isArray(result.meta.citations) ? result.meta.citations : []).filter((citation) => typeof citation === "string").map((url) => ({ url })),
				...typeof result.meta.answer === "string" && result.meta.answer.length > 0 ? { answer: result.meta.answer } : {},
				truncated: false
			};
		},
		async execute(args, exec) {
			const request = buildXSearchRequest(args);
			const session = await options.tokens.session();
			const response = await (options.fetchFn ?? fetch)(X_SEARCH_URL, {
				method: "POST",
				headers: {
					"authorization": `Bearer ${session.accessToken}`,
					"content-type": "application/json",
					"accept": "application/json"
				},
				body: JSON.stringify({
					model: X_SEARCH_MODEL,
					input: [{
						role: "user",
						content: request.query
					}],
					tools: [request.tool],
					store: false
				}),
				signal: exec.signal
			});
			if (!response.ok) throw await httpLlmError(response, "x_search");
			return parseXSearchResponse(await response.json());
		}
	});
}

//#endregion
//#region src/tools/image-generate.ts
/** Endpoint the codex generation request is posted to. */
const IMAGE_GENERATE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
/** The image model the codex subscription endpoint serves. */
const IMAGE_GENERATE_MODEL = "gpt-image-2";
/** Endpoint the grok generation request is posted to. */
const GROK_IMAGE_GENERATE_URL = "https://api.x.ai/v1/images/generations";
/** The image model the grok subscription endpoint serves. */
const GROK_IMAGE_GENERATE_MODEL = "grok-imagine-image-2.0";
/**
* Assemble the codex request body from tool arguments (hand-checks the
* non-empty prompt the schema DSL cannot express).
*/
function buildImageGenerateBody(args) {
	const prompt = args.prompt.trim();
	if (prompt.length === 0) throw new Error("image_generate: prompt must be a non-empty string");
	return {
		prompt,
		model: IMAGE_GENERATE_MODEL,
		...args.size === void 0 ? {} : { size: args.size },
		...args.quality === void 0 ? {} : { quality: args.quality }
	};
}
/** The codex `size` values mapped onto grok aspect ratios. */
const GROK_ASPECT_RATIOS = {
	"1024x1024": "1:1",
	"1024x1536": "2:3",
	"1536x1024": "3:2",
	"auto": "auto"
};
/**
* Assemble the grok request body from the same tool arguments: `size` maps
* onto the nearest `aspect_ratio`, and `quality` folds into grok's low/medium
* pair (`high` â†’ `medium`, `auto` â†’ provider default).
*/
function buildGrokImageGenerateBody(args) {
	const prompt = args.prompt.trim();
	if (prompt.length === 0) throw new Error("image_generate: prompt must be a non-empty string");
	const quality = args.quality === "low" ? "low" : args.quality === "medium" || args.quality === "high" ? "medium" : void 0;
	return {
		prompt,
		model: GROK_IMAGE_GENERATE_MODEL,
		response_format: "b64_json",
		...args.size === void 0 ? {} : { aspect_ratio: GROK_ASPECT_RATIOS[args.size] },
		...quality === void 0 ? {} : { quality }
	};
}
/**
* Parse the generations response into decodable images. Throws when the
* payload carries no usable `b64_json` entries.
*/
function parseImageGenerateResponse(payload) {
	const body = typeof payload === "object" && payload !== null ? payload : {};
	const entries = Array.isArray(body.data) ? body.data : [];
	const images = [];
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		if (typeof record.b64_json !== "string" || record.b64_json.length === 0) continue;
		images.push({
			data: Buffer.from(record.b64_json, "base64"),
			...typeof record.revised_prompt === "string" && record.revised_prompt.length > 0 ? { revisedPrompt: record.revised_prompt } : {}
		});
	}
	if (images.length === 0) throw new Error("image_generate: the response carried no image data");
	return images;
}
/** Directory the generated image files are written to. */
function imagesDirectory() {
	return dshHomePath("plugins", "subscriptions", "images");
}
/**
* Sniff a generated image's media type from its magic bytes (codex serves
* PNG; grok's format is undocumented, so trust the bytes). Unrecognized data
* defaults to PNG, matching the historical behavior.
*/
function sniffImageMediaType(data) {
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp";
	return "image/png";
}
/** File extension for one sniffed media type. */
const MEDIA_TYPE_EXTENSIONS = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp"
};
/** Timestamped, collision-safe file name for one generated image. */
function imageFileName(index, mediaType) {
	return `image-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}-${index}.${MEDIA_TYPE_EXTENSIONS[mediaType]}`;
}
/** Bound a call-card title's prompt. */
function truncate$1(text, max = 60) {
	return text.length <= max ? text : `${text.slice(0, max - 1)}â€¦`;
}
/**
* Non-throwing image-capability check for the calling route (read_image's
* gate, softened: a generated image that cannot enter history degrades to the
* text-only result instead of failing the call). Resolves the session's
* latest routed provider/model and answers whether the exact route declares
* image input; any resolution failure means "no".
*/
async function routeDeclaresImageInput(resolveLlm, exec) {
	const llm = resolveLlm?.();
	const routed = exec.agent?.session.requestHeader()?.config;
	const provider = routed?.provider ?? exec.agent?.options.provider;
	const model = routed?.model ?? exec.agent?.options.model;
	if (llm === void 0 || provider === void 0 || model === void 0) return false;
	try {
		return (await llm.resolveModelInfo(provider, model, exec.signal)).inputModalities?.includes("image") === true;
	} catch {
		return false;
	}
}
/** Re-brand one canonical image entry into the attachment reference an ImageBlock carries. */
function imageRefFromValue(image) {
	return {
		attachmentId: AttachmentId(image.attachmentId),
		mediaType: image.mediaType,
		bytes: image.bytes,
		width: image.width,
		height: image.height,
		...image.name === void 0 ? {} : { name: image.name }
	};
}
/** Project the canonical value into the model-facing text + image blocks. */
function imageGenerateContent(value) {
	return [imageGenerateText(value), ...(value.images ?? []).map((image) => ({
		type: "image",
		attachment: imageRefFromValue(image)
	}))];
}
/** The text summary of one generation, shared by the model content and the UI card. */
function imageGenerateText(value) {
	return {
		type: "text",
		text: `Saved ${value.paths.length} image(s):\n${value.paths.map((path) => `- ${path}`).join("\n")}` + (value.revisedPrompt === void 0 ? "" : `\n\nRevised prompt: ${value.revisedPrompt}`)
	};
}
/**
* Build the `image_generate` tool definition.
* @param options - codex session source, fetch implementation, and image directory.
* @returns the tool to register on `ctx.tools`.
*/
function createImageGenerateTool(options) {
	return defineTool({
		name: "image_generate",
		description: "Generate an image with the ChatGPT subscription (gpt-image-2) or the Grok subscription (grok-imagine-image-2.0) and save it as an image file. The `provider` parameter picks the preferred provider (default gpt); when the preferred one is logged out the other serves as fallback. Returns the saved file paths; on image-capable models the image itself is attached.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "What the image should show."
			},
			size: {
				type: "string",
				enum: [
					"1024x1024",
					"1024x1536",
					"1536x1024",
					"auto"
				],
				description: "Image dimensions; omit for the provider default."
			},
			quality: {
				type: "string",
				enum: [
					"low",
					"medium",
					"high",
					"auto"
				],
				description: "Rendering quality; omit for the provider default."
			},
			provider: {
				type: "string",
				enum: ["gpt", "grok"],
				description: "Preferred provider (default gpt); the other one serves as fallback when the preferred is logged out."
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					paths: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					images: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								attachmentId: {
									type: "string",
									required: true
								},
								mediaType: {
									type: "string",
									enum: [
										"image/png",
										"image/jpeg",
										"image/webp",
										"image/gif"
									],
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								},
								name: { type: "string" }
							}
						}
					},
					revisedPrompt: { type: "string" }
				},
				additionalProperties: false
			},
			render: (_args, value) => imageGenerateContent(value)
		},
		presentCall: (args) => ({
			card: "generic",
			title: `image_generate: ${truncate$1(args.prompt)}`
		}),
		presentResult: (_args, result) => ({
			card: "generic",
			content: result.content.filter((block) => block.type === "text")
		}),
		async execute(args, exec) {
			const fetchFn = options.fetchFn ?? fetch;
			const preferGrok = args.provider === "grok";
			const codexReady = options.codexTokens !== void 0 && await options.codexTokens.hasSession();
			const grokReady = options.grokTokens !== void 0 && await options.grokTokens.hasSession();
			const useGrok = preferGrok ? grokReady : grokReady && !codexReady;
			const useCodex = !useGrok && codexReady;
			let response;
			if (useCodex && options.codexTokens !== void 0) {
				const session = await options.codexTokens.session();
				response = await fetchFn(IMAGE_GENERATE_URL, {
					method: "POST",
					headers: {
						"authorization": `Bearer ${session.accessToken}`,
						"chatgpt-account-id": session.accountId,
						"originator": "codex_cli_rs",
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify(buildImageGenerateBody(args)),
					signal: exec.signal
				});
			} else if (useGrok && options.grokTokens !== void 0) {
				const session = await options.grokTokens.session();
				response = await fetchFn(GROK_IMAGE_GENERATE_URL, {
					method: "POST",
					headers: {
						"authorization": `Bearer ${session.accessToken}`,
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify(buildGrokImageGenerateBody(args)),
					signal: exec.signal
				});
			} else {
				const manager = preferGrok ? options.grokTokens ?? options.codexTokens : options.codexTokens ?? options.grokTokens;
				if (manager === void 0) throw new Error("image_generate: no image provider is configured");
				await manager.session();
				throw new Error("image_generate: no image provider is logged in");
			}
			if (!response.ok) throw await httpLlmError(response, "image_generate");
			const images = parseImageGenerateResponse(await response.json());
			const directory = options.imagesDir ?? imagesDirectory();
			await mkdir(directory, { recursive: true });
			const paths = [];
			const mediaTypes = [];
			for (const [index, image] of images.entries()) {
				const mediaType = sniffImageMediaType(image.data);
				const path = join(directory, imageFileName(index, mediaType));
				await writeFile(path, image.data);
				paths.push(path);
				mediaTypes.push(mediaType);
			}
			const attachments = options.resolveAttachments?.();
			const imageCapable = attachments !== void 0 && await routeDeclaresImageInput(options.resolveLlm, exec);
			const refs = [];
			if (attachments !== void 0 && imageCapable) for (const [index, image] of images.entries()) {
				const ref = await attachments.saveImage({
					data: image.data,
					mediaType: mediaTypes[index],
					name: basename(paths[index])
				});
				refs.push({
					attachmentId: ref.attachmentId,
					mediaType: ref.mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					...ref.name === void 0 ? {} : { name: ref.name }
				});
			}
			const revisedPrompt = images.find((image) => image.revisedPrompt !== void 0)?.revisedPrompt;
			return {
				paths,
				...refs.length > 0 ? { images: refs } : {},
				...revisedPrompt === void 0 ? {} : { revisedPrompt }
			};
		}
	});
}

//#endregion
//#region src/tools/video-generate.ts
/** Endpoint the generation request is posted to. */
const VIDEO_GENERATE_URL = "https://api.x.ai/v1/videos/generations";
/** The video model the grok subscription endpoint serves. */
const VIDEO_GENERATE_MODEL = "grok-imagine-video-1.5";
/** Polling endpoint for one generation request. */
function videoStatusUrl(requestId) {
	return `https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`;
}
/** Default delay between two status polls. */
const DEFAULT_POLL_INTERVAL_MS = 3e3;
/** Default overall deadline for one generation (submit â†’ done). */
const DEFAULT_MAX_WAIT_MS = 10 * 6e4;
/** xAI's supported clip length range in seconds. */
const DURATION_RANGE = {
	min: 1,
	max: 15
};
/**
* Assemble the request body from tool arguments (hand-checks the non-empty
* prompt and the duration range the schema DSL cannot express).
*/
function buildVideoGenerateBody(args) {
	const prompt = args.prompt.trim();
	if (prompt.length === 0) throw new Error("video_generate: prompt must be a non-empty string");
	if (args.duration !== void 0 && (!Number.isInteger(args.duration) || args.duration < DURATION_RANGE.min || args.duration > DURATION_RANGE.max)) throw new Error(`video_generate: duration must be an integer between ${String(DURATION_RANGE.min)} and ${String(DURATION_RANGE.max)} seconds`);
	const imageUrl = args.image_url?.trim();
	return {
		prompt,
		model: VIDEO_GENERATE_MODEL,
		...args.duration === void 0 ? {} : { duration: args.duration },
		...args.aspect_ratio === void 0 ? {} : { aspect_ratio: args.aspect_ratio },
		...args.resolution === void 0 ? {} : { resolution: args.resolution },
		...imageUrl === void 0 || imageUrl.length === 0 ? {} : { image: { url: imageUrl } }
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Extract the request id from the submit response. Throws when the payload
* carries none.
*/
function parseVideoStartResponse(payload) {
	const body = isRecord(payload) ? payload : {};
	if (typeof body.request_id !== "string" || body.request_id.length === 0) throw new Error("video_generate: the response carried no request_id");
	return body.request_id;
}
/**
* Decode one poll response. A `done` payload without a video URL and an
* unrecognized status both throw (the poll loop cannot make progress on
* either).
*/
function parseVideoStatusResponse(payload) {
	const body = isRecord(payload) ? payload : {};
	switch (body.status) {
		case "pending": return { status: "pending" };
		case "done": {
			const video = isRecord(body.video) ? body.video : {};
			if (typeof video.url !== "string" || video.url.length === 0) throw new Error("video_generate: the completed response carried no video URL");
			return {
				status: "done",
				url: video.url,
				...typeof video.duration === "number" ? { duration: video.duration } : {}
			};
		}
		case "failed":
		case "expired": {
			const error = isRecord(body.error) ? body.error : {};
			const detail = typeof error.message === "string" && error.message.length > 0 ? error.message : typeof body.error === "string" && body.error.length > 0 ? body.error : void 0;
			return {
				status: body.status,
				...detail === void 0 ? {} : { detail }
			};
		}
		default: throw new Error(`video_generate: unexpected status ${JSON.stringify(body.status)}`);
	}
}
/** Directory the downloaded MP4 files are written to. */
function videosDirectory() {
	return dshHomePath("plugins", "subscriptions", "videos");
}
/** Timestamped, collision-safe file name for one generated video. */
function videoFileName() {
	return `video-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.mp4`;
}
/** Bound a call-card title's prompt. */
function truncate(text, max = 60) {
	return text.length <= max ? text : `${text.slice(0, max - 1)}â€¦`;
}
/** Abort-aware sleep between two polls. */
function sleep(ms, signal) {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("video_generate: aborted"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
/**
* Build the `video_generate` tool definition.
* @param options - grok session source, fetch implementation, and video directory.
* @returns the tool to register on `ctx.tools`.
*/
function createVideoGenerateTool(options) {
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	return defineTool({
		name: "video_generate",
		description: `Generate a short video (1-15 seconds) with the grok subscription (${VIDEO_GENERATE_MODEL}) and save it as an MP4 file. Generation is asynchronous and may take a minute or more; the tool waits for completion and returns the saved file path. Optionally animate a still image by passing image_url (image-to-video).`,
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "What the video should show."
			},
			duration: {
				type: "integer",
				description: "Clip length in seconds (1-15); omit for the provider default."
			},
			aspect_ratio: {
				type: "string",
				enum: [
					"16:9",
					"9:16",
					"1:1",
					"4:3",
					"3:4",
					"3:2",
					"2:3"
				],
				description: "Output aspect ratio; omit for the provider default (16:9)."
			},
			resolution: {
				type: "string",
				enum: [
					"480p",
					"720p",
					"1080p"
				],
				description: "Output resolution; omit for the provider default (480p). Higher is slower."
			},
			image_url: {
				type: "string",
				description: "Optional public URL or base64 data URL of a JPEG/PNG/WebP image to animate (image-to-video); the image becomes the starting frame."
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					path: {
						type: "string",
						required: true
					},
					url: {
						type: "string",
						required: true
					},
					duration: { type: "number" }
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: `Saved video to ${value.path}` + (value.duration === void 0 ? "" : ` (${String(value.duration)}s)`) + `\nTemporary provider URL (expires soon): ${value.url}`
			}],
			presentationMeta: (_args, value) => ({
				fileName: basename(value.path),
				...value.duration === void 0 ? {} : { duration: value.duration }
			})
		},
		presentCall: (args) => ({
			card: "generic",
			title: `video_generate: ${truncate(args.prompt)}`
		}),
		async execute(args, exec) {
			const body = buildVideoGenerateBody(args);
			const session = await options.tokens.session();
			const fetchFn = options.fetchFn ?? fetch;
			const headers = {
				"authorization": `Bearer ${session.accessToken}`,
				"accept": "application/json"
			};
			const submit = await fetchFn(VIDEO_GENERATE_URL, {
				method: "POST",
				headers: {
					...headers,
					"content-type": "application/json"
				},
				body: JSON.stringify(body),
				signal: exec.signal
			});
			if (!submit.ok) throw await httpLlmError(submit, "video_generate");
			const requestId = parseVideoStartResponse(await submit.json());
			const deadline = Date.now() + maxWaitMs;
			let done;
			for (;;) {
				await sleep(pollIntervalMs, exec.signal);
				const poll = await fetchFn(videoStatusUrl(requestId), {
					method: "GET",
					headers,
					signal: exec.signal
				});
				if (!poll.ok) throw await httpLlmError(poll, "video_generate");
				const status = parseVideoStatusResponse(await poll.json());
				if (status.status === "done") {
					done = status;
					break;
				}
				if (status.status === "failed" || status.status === "expired") throw new Error(`video_generate: generation ${status.status} (request ${requestId})` + (status.detail === void 0 ? "" : `: ${status.detail}`));
				if (Date.now() >= deadline) throw new Error(`video_generate: timed out after ${String(maxWaitMs)}ms waiting for request ${requestId}`);
			}
			const download = await fetchFn(done.url, {
				method: "GET",
				signal: exec.signal
			});
			if (!download.ok) throw await httpLlmError(download, "video_generate download");
			const data = Buffer.from(await download.arrayBuffer());
			const directory = options.videosDir ?? videosDirectory();
			await mkdir(directory, { recursive: true });
			const path = join(directory, videoFileName());
			await writeFile(path, data);
			return {
				path,
				url: done.url,
				...done.duration === void 0 ? {} : { duration: done.duration }
			};
		}
	});
}

//#endregion
//#region src/providers/antigravity.ts
/** Google Antigravity subscription provider: OAuth against the public
 * Antigravity desktop client, streaming against the Cloud Code Code Assist
 * `v1internal:streamGenerateContent` backend (the same reachable by `agy`).
 * Requires a Google One AI Premium / Antigravity subscription. */
/** Client ID for Antigravity's Google OAuth app; set via ANTIGRAVITY_CLIENT_ID env var. */
function antigravityClientId() { return process.env.ANTIGRAVITY_CLIENT_ID ?? ""; }
/** Client secret for Antigravity's Google OAuth app; set via ANTIGRAVITY_CLIENT_SECRET env var. */
function antigravityClientSecret() { return process.env.ANTIGRAVITY_CLIENT_SECRET ?? ""; }
const ANTIGRAVITY_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** The public Antigravity redirect URI; the loopback callback must bind this exact port. */
const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const ANTIGRAVITY_CALLBACK_PATH = "/oauth-callback";
const ANTIGRAVITY_SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs"
].join(" ");
const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_ENDPOINTS = [
	ANTIGRAVITY_ENDPOINT_DAILY,
	ANTIGRAVITY_ENDPOINT_AUTOPUSH,
	ANTIGRAVITY_ENDPOINT_PROD
];
const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";
const ANTIGRAVITY_VERSION = "1.18.3";
const ANTIGRAVITY_PREEMPT_MS = 5 * 6e4;
const ANTIGRAVITY_CONTEXT_WINDOW = 1_048_576;
const ANTIGRAVITY_DEFAULT_MAX_TOKENS = 8192;
const ANTIGRAVITY_MODALITIES = ["text", "image"];
const ANTIGRAVITY_PERMANENT_REFRESH_CODES = new Set([
	"invalid_grant",
	"invalid_client",
	"unauthorized_client"
]);
const antigravityFlow = {
	callbackPath: ANTIGRAVITY_CALLBACK_PATH,
	listen: { host: "localhost", ports: [51121] },
	buildAuthorizeUrl({ state, pkce }) {
		return `${ANTIGRAVITY_AUTHORIZE_URL}?${new URLSearchParams({
			client_id: antigravityClientId(),
			response_type: "code",
			redirect_uri: ANTIGRAVITY_REDIRECT_URI,
			scope: ANTIGRAVITY_SCOPES,
			code_challenge: pkce.challenge,
			code_challenge_method: "S256",
			state,
			access_type: "offline",
			prompt: "consent"
		}).toString()}`;
	}
};
function antigravityPlatform() {
	return typeof process === "object" && process !== null && process.platform === "win32" ? "WINDOWS" : "MACOS";
}
function antigravityHeaders() {
	return {
		"User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ANTIGRAVITY_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": `{"ideType":"ANTIGRAVITY","platform":"${antigravityPlatform()}","pluginType":"GEMINI"}`
	};
}
function antigravitySession(tokens, fallback) {
	if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) throw new Error("antigravity token endpoint returned no access token");
	const refreshToken = tokens.refresh_token ?? fallback?.refreshToken;
	if (refreshToken === void 0) throw new Error("antigravity token endpoint returned no refresh token");
	let expiresAt;
	if (typeof tokens.expires_in === "number" && tokens.expires_in > 0) expiresAt = Date.now() + tokens.expires_in * 1000;
	else {
		const exp = decodeJwtPayload(tokens.access_token)?.exp;
		if (typeof exp === "number" && exp > 0) expiresAt = exp * 1000;
	}
	if (expiresAt === void 0) throw new Error("antigravity token endpoint returned no usable expiry");
	const idToken = tokens.id_token ?? fallback?.idToken;
	let emailAddress = fallback?.emailAddress;
	if (emailAddress === void 0 && typeof tokens.access_token === "string") {
		const email = decodeJwtPayload(tokens.access_token)?.email;
		if (typeof email === "string" && email.length > 0) emailAddress = email;
	}
	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt,
		...idToken === void 0 ? {} : { idToken },
		...emailAddress === void 0 ? {} : { emailAddress },
		...fallback?.projectId === void 0 ? {} : { projectId: fallback.projectId }
	};
}
async function antigravityProjectId(accessToken, fetchFn) {
	for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
		try {
			const response = await fetchFn(`${endpoint}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers: { ...antigravityHeaders(), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY", platform: antigravityPlatform(), pluginType: "GEMINI" } })
			});
			if (!response.ok) continue;
			const data = await response.json();
			const project = data.cloudaicompanionProject;
			const id = typeof project === "string" && project.length > 0 ? project
				: project !== null && typeof project === "object" && typeof project.id === "string" && project.id.length > 0 ? project.id
				: void 0;
			if (id !== void 0) return id;
		} catch { /* try next endpoint */ }
	}
	return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}
async function exchangeAntigravityCode(code, verifier) {
	const tokens = await fetch(ANTIGRAVITY_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "*/*", "User-Agent": "google-api-nodejs-client/9.15.1" },
		body: new URLSearchParams({
			client_id: antigravityClientId(),
			client_secret: antigravityClientSecret(),
			code,
			grant_type: "authorization_code",
			redirect_uri: ANTIGRAVITY_REDIRECT_URI
		}).toString()
	});
	if (!tokens.ok) throw await oauthEndpointError(tokens, "antigravity");
	const sessionData = antigravitySession(await tokens.json(), void 0);
	const projectId = await antigravityProjectId(sessionData.accessToken, fetch);
	return { ...sessionData, projectId };
}
async function refreshAntigravity(session) {
	const response = await fetch(ANTIGRAVITY_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: antigravityClientId(),
			client_secret: antigravityClientSecret(),
			refresh_token: session.refreshToken
		}).toString()
	});
	if (!response.ok) throw await oauthEndpointError(response, "antigravity");
	return antigravitySession(await response.json(), session);
}
function isAntigravityPermanentRefreshError(error) {
	if (!(error instanceof OAuthEndpointError)) return false;
	return ANTIGRAVITY_PERMANENT_REFRESH_CODES.has(error.oauthCode);
}
const callNames = new Map([
	["search_x", "x_search"], ["generate_image", "image_generate"],
	["generate_video", "video_generate"], ["read_file", "read_file"],
	["write_file", "write_file"], ["edit_file", "edit_file"],
	["list_directory", "list_directory"], ["run_command", "run_command"]
]);
function antigravityToolArguments(arguments$1) {
	if (typeof arguments$1 === "string") return arguments$1;
	if (arguments$1 === void 0 || arguments$1 === null) return "{}";
	return JSON.stringify(arguments$1);
}
function antigravityGeminiRequest(options, messages) {
	const system = messages.find((m) => m.role === "system");
	const contentMessages = messages.filter((m) => m.role !== "system");
	const merged = [];
	for (const msg of contentMessages) {
		const last = merged[merged.length - 1];
		if (last && last.role === msg.role) {
			if (typeof last.content === "string" && typeof msg.content === "string") {
				last.content = last.content + "\n" + msg.content;
			} else if (Array.isArray(last.content) && Array.isArray(msg.content)) {
				last.content = last.content.concat(msg.content);
			} else {
				merged.push(msg);
			}
		} else {
			merged.push(msg);
		}
	}
	const parts = [];
	for (const msg of merged) {
		if (msg.role === "user" || msg.role === "model") {
			if (typeof msg.content === "string") {
				parts.push({ text: msg.content });
			} else if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "text") parts.push({ text: part.text });
					else if (part.type === "function_call") parts.push({ functionCall: part.functionCall });
					else if (part.type === "function_response") parts.push({ functionResponse: { name: callNames.get(part.name) ?? part.name, response: toolResultValue(part) } });
					else if (part.type === "executable_code") parts.push({ executableCode: part.executableCode });
					else if (part.type === "code_execution_result") parts.push({ codeExecutionResult: part.codeExecutionResult });
				}
			}
		} else if (msg.role === "assistant") {
			if (typeof msg.content === "string") parts.push({ text: msg.content });
			else if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "function_call") parts.push({ functionCall: part.functionCall });
					else if (part.type === "text") parts.push({ text: part.text });
				}
			}
		}
	}
	const request = {
		schema: { type: "content", parts },
		...system ? { systemInstruction: typeof system.content === "string" ? { parts: [{ text: system.content }] } : system.content } : {},
		...options.tools !== void 0 && options.tools.length > 0 ? { tools: [{ functionDeclarations: options.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }] } : {}
	};
	return request;
}
function toolResultValue(block) {
	if (Array.isArray(block.content)) {
		const texts = [];
		for (const part of block.content) if (part.type === "text") texts.push(part.text);
		return texts.length === 1 ? { result: texts[0] } : { result: texts.join("\n") };
	}
	return { result: String(block.content) };
}
class AntigravityStreamTranslator {
	chunks = [];
	blockIndex = 0;
	sawToolCall = false;
	push(chunk) {
		const response = chunk.response;
		if (response === void 0 || typeof response !== "object" || response === null) return;
		if (response.error !== void 0 && response.error !== null) {
			const message = typeof response.error.message === "string" ? response.error.message : String(response.error);
			throw new LlmError(`antigravity API: ${message}`, "SERVER");
		}
		const usage = response.usageMetadata;
		if (usage !== void 0 && typeof usage === "object" && usage !== null) {
			const prompt = tokenCount(usage.promptTokenCount);
			const candidates = tokenCount(usage.candidatesTokenCount);
			const thoughts = tokenCount(usage.thoughtsTokenCount);
			this.chunks.push({ type: "usage", usage: { inputTokens: prompt, outputTokens: candidates, ...thoughts > 0 ? { reasoningTokens: thoughts } : {} } });
		}
		const candidates$ = response.candidates;
		if (!Array.isArray(candidates$) || candidates$.length === 0) return;
		const candidate = candidates$[0];
		const parts = candidate?.content?.parts;
		if (!Array.isArray(parts)) return;
		for (const part of parts) {
			if (part === void 0 || typeof part !== "object") continue;
			if (typeof part.text === "string" && part.text.length > 0) {
				if (part.thought === true) this.chunks.push({ type: "reasoning-delta", index: this.blockIndex, text: part.text });
				else this.chunks.push({ type: "text-delta", index: this.blockIndex, text: part.text });
			}
			if (part.functionCall !== void 0 && part.functionCall !== null) {
				this.sawToolCall = true;
				const fc = part.functionCall;
				this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, id: CallId(typeof fc.id === "string" && fc.id.length > 0 ? fc.id : `call_${this.blockIndex}`), ...typeof fc.name === "string" && fc.name.length > 0 ? { name: fc.name } : {}, argumentsDelta: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args ?? {}) });
			}
		}
	}
	finish() {
		this.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
		return this.chunks;
	}
}
function tokenCount(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
class AntigravityAdapter extends LlmAdapter {
	constructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			let session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) { session = await this.options.tokens.session(true); response = await this.request(options, session, watchdog.signal); }
			if (!response.ok) throw await httpLlmError(response, "antigravity API");
			if (response.body === null) throw new LlmError("antigravity API returned no response body", EMPTY_RESPONSE_CODE);
			const translator = new AntigravityStreamTranslator();
			for await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
				let parsed;
				try { parsed = JSON.parse(sseEvent.data); }
				catch { throw new LlmError("antigravity API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
				translator.push(parsed);
				for (const emitted of translator.chunks) yield emitted;
				translator.chunks = [];
			}
			yield* translator.finish();
		} catch (error) { throw mapFetchFailure("antigravity API", error, watchdog, options.signal); }
		finally { watchdog.stop(); }
	}
	async request(options, session, signal) {
		const resolved = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
		const request = antigravityGeminiRequest(options, resolved);
		const endpoint = this.options.endpoint ?? ANTIGRAVITY_ENDPOINT_DAILY;
		const projectId = session.projectId ?? ANTIGRAVITY_DEFAULT_PROJECT_ID;
		return fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
			method: "POST",
			headers: { ...antigravityHeaders(), Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream" },
			body: JSON.stringify({ request, model: options.model, project: projectId }),
			signal
		});
	}
	providerInfo(provider) { return { id: provider, name: "Google Antigravity" }; }
	staticModels(provider) {
		return (this.options.models ?? ANTIGRAVITY_MODELS).map((model) => ({ provider, id: model.id, name: model.name ?? model.id, ...model.description === void 0 ? {} : { description: model.description }, inputModalities: model.inputModalities ?? ANTIGRAVITY_MODALITIES }));
	}
	async listModels(provider) {
		if (await this.options.tokens.peek() === void 0) return [];
		return this.staticModels(provider);
	}
	async resolveModel(provider, model) {
		const configured = (this.options.models ?? ANTIGRAVITY_MODELS).find((entry) => entry.id === model);
		return { provider, id: model, name: configured?.name ?? model, ...configured?.description === void 0 ? {} : { description: configured.description }, inputModalities: ANTIGRAVITY_MODALITIES, context: { contextWindow: configured?.contextWindow ?? ANTIGRAVITY_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? ANTIGRAVITY_DEFAULT_MAX_TOKENS };
	}
}
const ANTIGRAVITY_MODELS = [
	{ id: "antigravity-gemini-3-pro", name: "Gemini 3 Pro (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
	{ id: "antigravity-gemini-3.1-pro", name: "Gemini 3.1 Pro (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
	{ id: "antigravity-gemini-3-flash", name: "Gemini 3 Flash (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
	{ id: "antigravity-claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Antigravity)", contextWindow: 200_000, maxTokens: 32768 },
	{ id: "antigravity-claude-opus-4-6-thinking", name: "Claude Opus 4.6 Thinking (Antigravity)", contextWindow: 200_000, maxTokens: 32768 }
];
//#endregion
//#region src/providers/openrouter.ts
/** OpenRouter subscription provider: OAuth PKCE → user-controlled API key.
 *
 * OpenRouter exposes a public OAuth PKCE flow (no registered client).
 * The user authorises once, and the exchange returns a static API key that
 * is used as a Bearer token against the OpenAI-compatible chat/completions
 * endpoint for the lifetime of that login. There is no refresh token or
 * expiry — the TokenManager is treated as read-only after the initial
 * exchange.
 *
 * Docs: https://openrouter.ai/docs/guides/overview/auth/oauth */
const OPENROUTER_AUTHORIZE_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_CALLBACK_PATH = "/callback";
const OPENROUTER_CONTEXT_WINDOW = 128e3;
const OPENROUTER_DEFAULT_MAX_TOKENS = 16384;
const OPENROUTER_PREEMPT_MS = 5 * 6e4;
const OPENROUTER_MODALITIES = ["text"];
const OPENROUTER_MODELS = [
	{ id: "openai/gpt-4o", name: "GPT-4o (OpenRouter)", contextWindow: 128e3, maxTokens: 16384 },
	{ id: "openai/gpt-4o-mini", name: "GPT-4o Mini (OpenRouter)", contextWindow: 128e3, maxTokens: 16384 },
	{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (OpenRouter)", contextWindow: 200e3, maxTokens: 32768 },
	{ id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (OpenRouter)", contextWindow: 200e3, maxTokens: 32768 },
	{ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (OpenRouter)", contextWindow: 1e6, maxTokens: 65536 }
];
const openrouterFlow = {
	callbackPath: OPENROUTER_CALLBACK_PATH,
	listen: { host: "localhost", ports: [0] },
	buildAuthorizeUrl({ state, pkce }) {
		const url = new URL(`${OPENROUTER_AUTHORIZE_URL}?`);
		url.searchParams.set("code_challenge", pkce.challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("state", state);
		url.searchParams.set("callback_url", openrouterFlow.listen.host);
		return url.toString();
	}
};
async function exchangeOpenRouterCode(code, verifier) {
	const response = await fetch(OPENROUTER_KEYS_URL, {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" })
	});
	if (!response.ok) throw await oauthEndpointError(response, "openrouter");
	const data = await response.json();
	const key = typeof data.key === "string" && data.key.length > 0 ? data.key : void 0;
	if (key === void 0) throw new Error("openrouter exchange returned no API key");
	return { accessToken: key, emailAddress: void 0 };
}
function isPermanentOpenRouterExchangeError(error) {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return msg.includes("invalid code") || msg.includes("expired") || msg.includes("403") || msg.includes("401");
}
class OpenRouterStreamTranslator {
	chunks = []; blockIndex = 0; sawToolCall = false;
	push(event) {
		if (!event?.choices?.length) return;
		const choice = event.choices[0];
		if (choice?.finish_reason) { this.sawToolCall = choice.finish_reason === "tool_calls"; return; }
		const delta = choice.delta;
		if (delta === void 0 || delta === null) return;
		if (typeof delta.content === "string" && delta.content.length > 0) this.chunks.push({ type: "text-delta", index: this.blockIndex, text: delta.content });
		const tcs = delta.tool_calls;
		if (!Array.isArray(tcs)) return;
		for (const tc of tcs) {
			if (tc?.index !== void 0) this.blockIndex = tc.index;
			if (tc?.id !== void 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, id: CallId(tc.id) });
			if (tc?.type !== void 0 && tc.type !== "function") continue;
			const fn = tc.function;
			if (fn === void 0) continue;
			if (typeof fn.name === "string" && fn.name.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, name: fn.name });
			if (typeof fn.arguments === "string" && fn.arguments.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, argumentsDelta: fn.arguments });
		}
	}
	finish() {
		this.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
		if (this.chunks.length > 0 && this.chunks[this.chunks.length - 1].type !== "usage") this.chunks.push({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } });
		return this.chunks;
	}
}
class OpenRouterAdapter extends LlmAdapter {
	constructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
	providerInfo(provider) { return { id: provider, name: "OpenRouter (Subscription)" }; }
	staticModels(provider) { return (this.options.models ?? OPENROUTER_MODELS).map((m) => ({ provider, id: m.id, name: m.name ?? m.id, inputModalities: m.inputModalities ?? OPENROUTER_MODALITIES })); }
	async listModels(provider) { if (await this.options.tokens.peek() === void 0) return []; return this.staticModels(provider); }
	async resolveModel(provider, model) {
		const configured = (this.options.models ?? OPENROUTER_MODELS).find((m) => m.id === model);
		return { provider, id: model, name: configured?.name ?? model, inputModalities: OPENROUTER_MODALITIES, context: { contextWindow: configured?.contextWindow ?? OPENROUTER_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? OPENROUTER_DEFAULT_MAX_TOKENS };
	}
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			const session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) throw new LlmError("openrouter API key invalid; re-login via Settings → Subscriptions", "INVALID_CREDENTIAL");
			if (!response.ok) throw await httpLlmError(response, "openrouter API");
			if (response.body === null) throw new LlmError("openrouter API returned no response body", EMPTY_RESPONSE_CODE);
			const translator = new OpenRouterStreamTranslator();
			for await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
				let event;
				try { event = JSON.parse(sseEvent.data); }
				catch { throw new LlmError("openrouter API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
				translator.push(event);
				for (const emitted of translator.chunks) yield emitted;
				translator.chunks = [];
			}
			yield* translator.finish();
		} catch (error) { throw mapFetchFailure("openrouter API", error, watchdog, options.signal); }
		finally { watchdog.stop(); }
	}
	async request(options, session, signal) {
		const messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
		const chatMessages = messages.map((m) => {
			if (m.role === "system") return { role: "system", content: m.content };
			if (m.role === "user" && typeof m.content === "string") return { role: "user", content: m.content };
			if (m.role === "user" && Array.isArray(m.content)) {
				const parts = [];
				for (const c of m.content) { if (c.type === "text") parts.push({ type: "text", text: c.text }); else if (c.type === "image_url") parts.push(c); }
				return { role: "user", content: parts.length === 1 ? parts[0].text : parts };
			}
			if (m.role === "assistant" && typeof m.content === "string") return { role: "assistant", content: m.content };
			return m;
		});
		const body = {
			model: options.model, messages: chatMessages, stream: true,
			...options.maxTokens !== void 0 ? { max_tokens: options.maxTokens } : {},
			...options.temperature !== void 0 ? { temperature: options.temperature } : {},
			...options.seed !== void 0 ? { seed: options.seed } : {},
			...options.tools !== void 0 && options.tools.length > 0 ? { tools: options.tools.map((t) => ({ type: "function", function: t.function })) } : {}
		};
		return fetch(OPENROUTER_API_URL, {
			method: "POST",
			headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() },
			body: JSON.stringify(body), signal
		});
	}
}
//#endregion
//#region src/providers/agnes.ts
/** Agnes AI subscription provider: OAuth PKCE → access token.
 *
 * AgnesCode opens the authorization URL in the browser, then the browser
 * tries to open the `agnes://auth/callback` deep link. Since DSH has no
 * protocol handler, the login flow uses manual pasting: the user pastes the
 * full callback URL (or just the authorization code) into the DSH UI and
 * the plugin exchanges it against the Agnes BFF backend.
 *
 * Source: reverse-engineered from AgnesCode v1.0.26 renderer bundle.
 * Docs: https://wiki.agnes-ai.com/en/docs/overview */
const AGNES_CLIENT_ID = "agnes-code";
const AGNES_AUTHORIZE_URL = "https://app.agnes-ai.com/login";
const AGNES_CALLBACK_URI = "agnes://auth/callback";
const AGNES_EXCHANGE_URL = "https://api-agnes-code.agnes-ai.com/api/v1/code/auth/exchange-code";
const AGNES_REFRESH_URL = "https://api-agnes-code.agnes-ai.com/api/v1/user/refresh-token";
const AGNES_API_BASE = "https://api-agnes-code.agnes-ai.com/v1";
const AGNES_CALLBACK_PATH = "/callback";
const AGNES_CONTEXT_WINDOW = 524288;
const AGNES_DEFAULT_MAX_TOKENS = 16384;
const AGNES_PREEMPT_MS = 5 * 6e4;
const AGNES_MODALITIES = ["text", "image"];
const AGNES_MODELS = [
	{ id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextWindow: 524288, maxTokens: 16384 },
	{ id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextWindow: 262144, maxTokens: 16384 },
	{ id: "openai/gpt-4o", name: "GPT-4o (via Agnes)", contextWindow: 128e3, maxTokens: 16384 },
	{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (via Agnes)", contextWindow: 200e3, maxTokens: 32768 }
];
const agnesFlow = {
	callbackPath: AGNES_CALLBACK_PATH,
	listen: { host: "localhost", ports: [0] },
	buildAuthorizeUrl({ state, pkce }) {
		const url = new URL(AGNES_AUTHORIZE_URL);
		url.searchParams.set("client", AGNES_CLIENT_ID);
		url.searchParams.set("redirect_uri", AGNES_CALLBACK_URI);
		url.searchParams.set("state", state);
		return url.toString();
	}
};
function tr(session) {
	if (!session || typeof session !== "object") return false;
	const s = session;
	if (typeof s.accessToken !== "string" || !s.accessToken.trim() || s.accessToken.length > 65536) return false;
	if (!s.userInfo || typeof s.userInfo !== "object" || Array.isArray(s.userInfo)) return false;
	const uid = typeof s.userInfo.id === "string" ? s.userInfo.id : typeof s.userInfo.id === "number" && Number.isFinite(s.userInfo.id) ? String(s.userInfo.id) : null;
	if (typeof uid !== "string" || uid.length === 0) return false;
	if (typeof s.newapiReady !== "boolean" || typeof s.newapiInitialized !== "boolean") return false;
	if (typeof s.bffPublicBaseUrl !== "string") return false;
	try { const u = new URL(s.bffPublicBaseUrl); if (u.protocol !== "https:" && u.protocol !== "http:") return false; if (u.username || u.password) return false; } catch { return false; }
	return true;
}
async function exchangeAgnesCode(code, state) {
	const response = await fetch(AGNES_EXCHANGE_URL, {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code, redirect_uri: AGNES_CALLBACK_URI, state, client_id: AGNES_CLIENT_ID })
	});
	if (!response.ok) throw await oauthEndpointError(response, "agnes");
	const text = await response.text();
	let data;
	try { data = JSON.parse(text); } catch { throw new Error("agnes exchange returned non-JSON"); }
	const apiCode = data?.code;
	if (apiCode !== 0 && apiCode !== "000000") {
		const msg = data?.message ?? `Login failed (HTTP ${response.status})`;
		throw response.status === 401 || response.status === 403 ? new Error(`Authentication denied: ${msg}`) : new Error(msg);
	}
	const accessToken = data?.data?.access_token;
	if (!accessToken || typeof accessToken !== "string") throw new Error("agnes exchange returned no access token");
	return { accessToken, userInfo: data?.data?.user_info ?? {}, newapiReady: true, newapiInitialized: true, bffPublicBaseUrl: AGNES_API_BASE };
}
async function refreshAgnes(session) {
	const response = await fetch(AGNES_REFRESH_URL, {
		method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }
	});
	if (!response.ok) throw await oauthEndpointError(response, "agnes");
	const text = await response.text();
	let data;
	try { data = JSON.parse(text); } catch { throw new Error("agnes refresh returned non-JSON"); }
	const apiCode = data?.code;
	if (apiCode !== 0 && apiCode !== "000000") throw new Error(data?.message ?? `Token refresh failed (HTTP ${response.status})`);
	const newToken = data?.data?.access_token;
	if (!newToken || typeof newToken !== "string") throw new Error("agnes refresh returned no access token");
	return { ...session, accessToken: newToken };
}
function isPermanentAgnesError(error) {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return msg.includes("authentication denied") || msg.includes("login expired") || msg.includes("invalid grant") || msg.includes("401") || msg.includes("403");
}
class AgnesStreamTranslator {
	chunks = []; blockIndex = 0; sawToolCall = false;
	push(event) {
		if (!event?.choices?.length) return;
		const choice = event.choices[0];
		if (choice?.finish_reason) { this.sawToolCall = choice.finish_reason === "tool_calls"; return; }
		const delta = choice.delta;
		if (delta === void 0 || delta === null) return;
		if (typeof delta.content === "string" && delta.content.length > 0) this.chunks.push({ type: "text-delta", index: this.blockIndex, text: delta.content });
		const tcs = delta.tool_calls;
		if (!Array.isArray(tcs)) return;
		for (const tc of tcs) {
			if (tc?.index !== void 0) this.blockIndex = tc.index;
			if (tc?.id !== void 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, id: CallId(tc.id) });
			if (tc?.type !== void 0 && tc.type !== "function") continue;
			const fn = tc.function;
			if (fn === void 0) continue;
			if (typeof fn.name === "string" && fn.name.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, name: fn.name });
			if (typeof fn.arguments === "string" && fn.arguments.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, argumentsDelta: fn.arguments });
		}
	}
	finish() {
		this.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
		if (this.chunks.length > 0 && this.chunks[this.chunks.length - 1].type !== "usage") this.chunks.push({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } });
		return this.chunks;
	}
}
class AgnesAdapter extends LlmAdapter {
	constructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
	providerInfo(provider) { return { id: provider, name: "Agnes AI (Subscription)" }; }
	staticModels(provider) { return (this.options.models ?? AGNES_MODELS).map((m) => ({ provider, id: m.id, name: m.name ?? m.id, inputModalities: m.inputModalities ?? AGNES_MODALITIES })); }
	async listModels(provider) { if (await this.options.tokens.peek() === void 0) return []; return this.staticModels(provider); }
	async resolveModel(provider, model) {
		const configured = (this.options.models ?? AGNES_MODELS).find((m) => m.id === model);
		return { provider, id: model, name: configured?.name ?? model, inputModalities: AGNES_MODALITIES, context: { contextWindow: configured?.contextWindow ?? AGNES_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? AGNES_DEFAULT_MAX_TOKENS };
	}
	async *stream(options) {
		const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
		try {
			const session = await this.options.tokens.session();
			let response = await this.request(options, session, watchdog.signal);
			if (response.status === 401) throw new LlmError("agnes API key invalid; re-login via Settings → Subscriptions", "INVALID_CREDENTIAL");
			if (!response.ok) throw await httpLlmError(response, "agnes API");
			if (response.body === null) throw new LlmError("agnes API returned no response body", EMPTY_RESPONSE_CODE);
			const translator = new AgnesStreamTranslator();
			for await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
				let event;
				try { event = JSON.parse(sseEvent.data); }
				catch { throw new LlmError("agnes API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
				translator.push(event);
				for (const emitted of translator.chunks) yield emitted;
				translator.chunks = [];
			}
			yield* translator.finish();
		} catch (error) { throw mapFetchFailure("agnes API", error, watchdog, options.signal); }
		finally { watchdog.stop(); }
	}
	async request(options, session, signal) {
		const messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
		const chatMessages = messages.map((m) => {
			if (m.role === "system") return { role: "system", content: m.content };
			if (m.role === "user" && typeof m.content === "string") return { role: "user", content: m.content };
			if (m.role === "user" && Array.isArray(m.content)) {
				const parts = [];
				for (const c of m.content) { if (c.type === "text") parts.push({ type: "text", text: c.text }); else if (c.type === "image_url") parts.push(c); }
				return { role: "user", content: parts.length === 1 ? parts[0].text : parts };
			}
			if (m.role === "assistant" && typeof m.content === "string") return { role: "assistant", content: m.content };
			return m;
		});
		const body = {
			model: options.model, messages: chatMessages, stream: true,
			...options.maxTokens !== void 0 ? { max_tokens: options.maxTokens } : {},
			...options.temperature !== void 0 ? { temperature: options.temperature } : {},
			...options.tools !== void 0 && options.tools.length > 0 ? { tools: options.tools.map((t) => ({ type: "function", function: t.function })) } : {}
		};
		return fetch(AGNES_API_BASE + "/chat/completions", {
			method: "POST",
			headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() },
			body: JSON.stringify(body), signal
		});
	}
}
//#endregion

//#region src/index.ts
const name = "dsh-plugin-subscriptions";
const inject = ["llm"];
/** Default maximum provider idle time while one stream read is outstanding. */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
const providerIdSchema = z.union([
	"codex",
	"claude",
	"grok",
	"antigravity",
	"openrouter",
	"agnes"
]);
const modelEntrySchema = z.object({
	id: z.string().required(),
	name: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	inputModalities: z.array(z.union(["text", "image"]))
});
const Config = z.object({
	providers: z.array(providerIdSchema).default([
		"codex",
		"claude",
		"grok",
		"antigravity",
		"openrouter",
		"agnes"
	]),
	streamIdleTimeoutMs: z.number().min(1).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
	models: z.object({
		codex: z.array(modelEntrySchema),
		claude: z.array(modelEntrySchema),
		grok: z.array(modelEntrySchema),
		antigravity: z.array(modelEntrySchema),
		openrouter: z.array(modelEntrySchema),
		agnes: z.array(modelEntrySchema)
	})
});
/** Built-in catalogs used when the config does not override a provider's models. */
const DEFAULT_MODELS = {
	codex: [
		{
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex"
		},
		{
			id: "gpt-5.1-codex-mini",
			name: "GPT-5.1 Codex Mini"
		},
		{
			id: "gpt-5.1",
			name: "GPT-5.1"
		}
	],
	claude: [
		{
			id: "claude-opus-5",
			name: "Claude Opus 5",
			maxTokens: 128e3,
			contextWindow: 1e6
		},
		{
			id: "claude-sonnet-5",
			name: "Claude Sonnet 5",
			maxTokens: 128e3,
			contextWindow: 1e6
		},
		{
			id: "claude-fable-5",
			name: "Claude Fable 5",
			maxTokens: 128e3,
			contextWindow: 1e6
		},
		{
			id: "claude-haiku-4-5-20251001",
			name: "Claude Haiku 4.5",
			maxTokens: 64e3
		}
	],
	grok: [
		{
			id: "grok-4",
			name: "Grok 4"
		},
		{
			id: "grok-4-fast-reasoning",
			name: "Grok 4 Fast Reasoning"
		},
		{
			id: "grok-code-fast-1",
			name: "Grok Code Fast 1"
		}
	],
	antigravity: [
		{ id: "antigravity-gemini-3-pro", name: "Gemini 3 Pro (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
		{ id: "antigravity-gemini-3.1-pro", name: "Gemini 3.1 Pro (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
		{ id: "antigravity-gemini-3-flash", name: "Gemini 3 Flash (Antigravity)", contextWindow: 1_048_576, maxTokens: 65536 },
		{ id: "antigravity-claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Antigravity)", contextWindow: 200_000, maxTokens: 32768 },
		{ id: "antigravity-claude-opus-4-6-thinking", name: "Claude Opus 4.6 Thinking (Antigravity)", contextWindow: 200_000, maxTokens: 32768 }
	],
	openrouter: [
		{ id: "openai/gpt-4o", name: "GPT-4o (OpenRouter)", contextWindow: 128e3, maxTokens: 16384 },
		{ id: "openai/gpt-4o-mini", name: "GPT-4o Mini (OpenRouter)", contextWindow: 128e3, maxTokens: 16384 },
		{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (OpenRouter)", contextWindow: 200e3, maxTokens: 32768 },
		{ id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (OpenRouter)", contextWindow: 200e3, maxTokens: 32768 },
		{ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (OpenRouter)", contextWindow: 1e6, maxTokens: 65536 }
	],
	agnes: [
		{ id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextWindow: 524288, maxTokens: 16384 },
		{ id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextWindow: 262144, maxTokens: 16384 },
		{ id: "openai/gpt-4o", name: "GPT-4o (via Agnes)", contextWindow: 128e3, maxTokens: 16384 },
		{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (via Agnes)", contextWindow: 200e3, maxTokens: 32768 }
	]
};
/** Validate and detach the model catalog for every provider. */
function resolveCatalog(models) {
	const resolve = (provider) => {
		const configured = models?.[provider];
		return validateModels(configured !== void 0 && configured.length > 0 ? configured : DEFAULT_MODELS[provider], `${name}: models.${provider}`);
	};
	return {
		codex: resolve("codex"),
		claude: resolve("claude"),
		grok: resolve("grok"),
		antigravity: resolve("antigravity"),
		openrouter: resolve("openrouter"),
		agnes: resolve("agnes")
	};
}
/** The display account of a stored session, for the status endpoint. */
function accountOf(provider, session) {
	if (session === void 0) return void 0;
	switch (provider) {
		case "codex": {
			const codex = session;
			return codex.emailAddress ?? codexProfileClaims(codex.idToken).emailAddress ?? codex.accountId;
		}
		case "claude": return session.emailAddress;
		case "grok": return session.account;
		case "antigravity": return session.emailAddress;
		case "openrouter": return session.emailAddress ?? "OpenRouter user";
		case "agnes": return session.userInfo?.id ?? "Agnes user";
	}
}
/**
* Auth operations behind the `/subscriptions-auth` RPC channel: start/complete
* OAuth attempts in the background, feed pasted codes, cancel, log out, and
* answer usage lookups.
*/
var SubscriptionsAuthController = class {
	/** Last login failure per provider, surfaced as `detail` until the next success. */
	lastError = /* @__PURE__ */ new Map();
	constructor(flows, onAuthChanged, resolveAttachments, usageFetchers = {}) {
		this.flows = flows;
		this.onAuthChanged = onAuthChanged;
		this.resolveAttachments = resolveAttachments;
		this.usageFetchers = usageFetchers;
	}
	usage(provider, signal) {
		const fetcher = this.usageFetchers[provider];
		if (fetcher === void 0) return Promise.resolve({ supported: false });
		return fetcher(signal);
	}
	async readImage(ref, signal) {
		const attachments = this.resolveAttachments();
		if (attachments === void 0) throw new Error("no attachment service is mounted; generated-image bytes are unavailable");
		const stored = await attachments.readImage(ref, signal);
		return {
			mediaType: stored.ref.mediaType,
			dataBase64: Buffer.from(stored.data).toString("base64")
		};
	}
	async readVideo(name$1, signal) {
		return {
			mediaType: "video/mp4",
			dataBase64: (await readFile(join(videosDirectory(), name$1), { signal })).toString("base64")
		};
	}
	async status(provider) {
		const session = await getSession(provider);
		const account = accountOf(provider, session);
		const detail = this.lastError.get(provider);
		return {
			loggedIn: session !== void 0,
			busy: this.flows.isBusy(provider),
			...session === void 0 ? {} : { expiresAt: session.expiresAt },
			...account === void 0 ? {} : { account },
			...detail === void 0 ? {} : { detail }
		};
	}
	async login(provider) {
		if (provider === "claude") {
			const session = readClaudeCodeCredentials();
			if (session) {
				await this.persist("claude", session);
				this.lastError.delete("claude");
				this.onAuthChanged("claude");
				return { authorizeUrl: "" };
			}
			throw new Error("Claude Code credentials not found. Run \"claude\" first to log in.");
		}
		const spec = provider === "grok" ? await grokFlow() : provider === "antigravity" ? antigravityFlow : provider === "openrouter" ? openrouterFlow : provider === "agnes" ? agnesFlow : codexFlow;
		const attempt = await this.flows.start(provider, spec);
		this.complete(provider, attempt);
		return { authorizeUrl: attempt.authorizeUrl };
	}
	/** Drive one attempt to a stored session; records failures for the status endpoint. */
	async complete(provider, attempt) {
		try {
			const code = await attempt.waitCode();
			const session = await this.exchange(provider, code, attempt);
			await this.persist(provider, session);
			this.lastError.delete(provider);
			this.onAuthChanged(provider);
		} catch (error) {
			if (!(error instanceof Error && error.message === "login cancelled")) this.lastError.set(provider, errorChain(error));
		}
	}
	exchange(provider, code, attempt) {
		switch (provider) {
			case "codex": return exchangeCodexCode(code, attempt.pkce.verifier, attempt.redirectUri);
			case "claude": return exchangeClaudeCode(code, attempt.pkce.verifier, attempt.redirectUri, attempt.state);
			case "grok": return exchangeGrokCode(code, attempt.pkce.verifier, attempt.redirectUri, attempt.pkce.challenge);
			case "antigravity": return exchangeAntigravityCode(code, attempt.pkce.verifier);
			case "openrouter": return exchangeOpenRouterCode(code, attempt.pkce.verifier);
			case "agnes": return exchangeAgnesCode(code, attempt.state);
		}
	}
	persist(provider, session) {
		switch (provider) {
			case "codex": return saveSession("codex", session);
			case "claude": return saveSession("claude", session);
			case "grok": return saveSession("grok", session);
			case "antigravity": return saveSession("antigravity", session);
			case "openrouter": return saveSession("openrouter", session);
			case "agnes": return saveSession("agnes", session);
		}
	}
	manual(provider, input) {
		const attempt = this.flows.pending(provider);
		if (attempt === void 0) return Promise.reject(/* @__PURE__ */ new Error(`no ${provider} login attempt is in progress`));
		attempt.manual(input);
		return Promise.resolve();
	}
	cancel(provider) {
		this.flows.pending(provider)?.cancel();
		return Promise.resolve();
	}
	async logout(provider) {
		this.flows.pending(provider)?.cancel();
		await deleteSession(provider);
		this.lastError.delete(provider);
		this.onAuthChanged(provider);
	}
};
function apply(ctx, config) {
	const providers = [...new Set(config.providers ?? [...PROVIDER_IDS])];
	const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
	if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) throw new Error(`${name}: streamIdleTimeoutMs must be a positive finite number`);
	const catalog = resolveCatalog(config.models);
	const overridden = new Set(PROVIDER_IDS.filter((provider) => (config.models?.[provider]?.length ?? 0) > 0));
	const flows = new OAuthFlowManager();
	const onWarn = (message) => {
		ctx.logger.warn(`dsh-plugin-subscriptions: ${message}`);
	};
	const resolveAttachments = () => ctx.get("attachments");
	const handles = /* @__PURE__ */ new Map();
	const authChanged = (provider) => {
		handles.get(provider)?.replace([provider]);
	};
	let codexTokens;
	let claudeTokens;
	let grokTokens;
	const usageFetchers = {};
	const speedBySession = /* @__PURE__ */ new Map();
	let codexAdapter;
	for (const provider of providers) switch (provider) {
		case "codex": {
			const tokens = new TokenManager({
				displayName: "ChatGPT (Codex)",
				preemptMs: CODEX_PREEMPT_MS,
				load: () => getSession("codex"),
				save: (session) => saveSession("codex", session),
				remove: () => deleteSession("codex"),
				refresh: refreshCodex,
				isPermanent: isCodexPermanentRefreshError,
				onRemoved: () => {
					authChanged("codex");
				}
			});
			codexTokens = tokens;
			usageFetchers.codex = async (signal) => fetchCodexUsage(await tokens.session(), fetch, signal);
			let adapter;
			adapter = new CodexAdapter({
				models: catalog.codex,
				streamIdleTimeoutMs,
				tokens,
				discovery: !overridden.has("codex"),
				onWarn,
				resolveAttachments,
				catalogStore: catalogStore("codex"),
				speedFor: (sessionId, model) => sessionId !== void 0 && speedBySession.get(sessionId) === "fast" && adapter.supportsFastTier(model)
			});
			codexAdapter = adapter;
			handles.set("codex", ctx.llm.registerAdapter(["codex"], adapter));
			break;
		}
		case "claude": {
			const tokens = new TokenManager({
				displayName: "Claude (Subscription)",
				preemptMs: CLAUDE_PREEMPT_MS,
				load: () => getSession("claude"),
				save: (session) => saveSession("claude", session),
				remove: () => deleteSession("claude"),
				refresh: (session) => refreshClaudeSynced(session, refreshClaude),
				isPermanent: isClaudePermanentRefreshError,
				onRemoved: () => {
					authChanged("claude");
				}
			});
			claudeTokens = tokens;
			usageFetchers.claude = async (signal) => fetchClaudeUsage(await tokens.session(), fetch, signal);
			handles.set("claude", ctx.llm.registerAdapter(["claude"], new ClaudeAdapter({
				models: catalog.claude,
				streamIdleTimeoutMs,
				tokens,
				discovery: !overridden.has("claude"),
				onWarn,
				maxRetries: 10,
				resolveAttachments,
				catalogStore: catalogStore("claude")
			})));
			break;
		}
		case "grok": {
			const tokens = new TokenManager({
				displayName: "Grok (Subscription)",
				preemptMs: GROK_PREEMPT_MS,
				load: () => getSession("grok"),
				save: (session) => saveSession("grok", session),
				remove: () => deleteSession("grok"),
				refresh: refreshGrok,
				isPermanent: isGrokPermanentRefreshError,
				onRemoved: () => {
					authChanged("grok");
				}
			});
			grokTokens = tokens;
			usageFetchers.grok = async (signal) => fetchGrokUsage(await tokens.session(), fetch, signal);
			handles.set("grok", ctx.llm.registerAdapter(["grok"], new GrokAdapter({
				models: catalog.grok,
				streamIdleTimeoutMs,
				tokens,
				discovery: !overridden.has("grok"),
				onWarn,
				resolveAttachments,
				catalogStore: catalogStore("grok")
			})));
			break;
		}
		case "antigravity": {
			const tokens = new TokenManager({
				displayName: "Google Antigravity",
				preemptMs: ANTIGRAVITY_PREEMPT_MS,
				load: () => getSession("antigravity"),
				save: (session) => saveSession("antigravity", session),
				remove: () => deleteSession("antigravity"),
				refresh: refreshAntigravity,
				isPermanent: isAntigravityPermanentRefreshError,
				onRemoved: () => { authChanged("antigravity"); }
			});
			handles.set("antigravity", ctx.llm.registerAdapter(["antigravity"], new AntigravityAdapter({
				models: catalog.antigravity, streamIdleTimeoutMs, tokens,
				discovery: !overridden.has("antigravity"), resolveAttachments, catalogStore: catalogStore("antigravity")
			})));
			break;
		}
		case "openrouter": {
			const openrouterTokens = new TokenManager({
				displayName: "OpenRouter (Subscription)",
				preemptMs: OPENROUTER_PREEMPT_MS,
				load: () => getSession("openrouter"),
				save: (session) => saveSession("openrouter", session),
				remove: () => deleteSession("openrouter"),
				refresh: () => { throw new Error("openrouter API key has no refresh endpoint; log out and re-login to replace"); },
				isPermanent: isPermanentOpenRouterExchangeError,
				onRemoved: () => { authChanged("openrouter"); }
			});
			handles.set("openrouter", ctx.llm.registerAdapter(["openrouter"], new OpenRouterAdapter({
				models: catalog.openrouter, streamIdleTimeoutMs, tokens: openrouterTokens,
				discovery: !overridden.has("openrouter"), resolveAttachments, catalogStore: catalogStore("openrouter")
			})));
			break;
		}
		case "agnes": {
			const agnesTokens = new TokenManager({
				displayName: "Agnes AI (Subscription)",
				preemptMs: AGNES_PREEMPT_MS,
				load: () => getSession("agnes"),
				save: (session) => saveSession("agnes", session),
				remove: () => deleteSession("agnes"),
				refresh: refreshAgnes,
				isPermanent: isPermanentAgnesError,
				onRemoved: () => { authChanged("agnes"); }
			});
			handles.set("agnes", ctx.llm.registerAdapter(["agnes"], new AgnesAdapter({
				models: catalog.agnes, streamIdleTimeoutMs, tokens: agnesTokens,
				discovery: !overridden.has("agnes"), resolveAttachments, catalogStore: catalogStore("agnes")
			})));
			break;
		}
	}
	registerAuthRpc(ctx, new SubscriptionsAuthController(flows, authChanged, resolveAttachments, usageFetchers), {
		async speed(sessionId) {
			return {
				tier: speedBySession.get(sessionId) ?? "standard",
				fastModels: await codexAdapter?.fastCapableModels() ?? []
			};
		},
		async setSpeed(sessionId, tier) {
			if (tier === "standard") speedBySession.delete(sessionId);
			else speedBySession.set(sessionId, tier);
		}
	});
	if (claudeTokens !== void 0) {
		const syncTimer = setInterval(() => {
			claudeTokens?.session().catch(() => {});
		}, 5 * 6e4);
		ctx.effect(() => () => {
			clearInterval(syncTimer);
		}, "dsh-plugin-subscriptions: claude background sync timer");
	}
	ctx.inject(["tools"], (toolsCtx) => {
		if (grokTokens !== void 0) {
			toolsCtx.tools.register(createXSearchTool({ tokens: grokTokens }));
			toolsCtx.tools.register(createVideoGenerateTool({ tokens: grokTokens }));
		}
		if (codexTokens !== void 0 || grokTokens !== void 0) toolsCtx.tools.register(createImageGenerateTool({
			...codexTokens === void 0 ? {} : { codexTokens },
			...grokTokens === void 0 ? {} : { grokTokens },
			resolveAttachments,
			resolveLlm: () => ctx.get("llm")
		}));
	});
}

//#endregion
export { Config, DEFAULT_STREAM_IDLE_TIMEOUT_MS, apply, inject, name };












