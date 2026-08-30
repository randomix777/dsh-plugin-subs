window.__ModuleLoader__.load({ id: "dsh-plugin-subscriptions", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);
let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
__deepseek_ai_dsh_client_ui_primitives = __toESM(__deepseek_ai_dsh_client_ui_primitives);

//#region src/client/locales.ts
/** Copy dictionaries for the Subscriptions settings section. */
/** English strings (the key-set source of truth for this pair). */
const en = {
	nav: "Subscriptions",
	intro: "Log a subscription provider in or out. Login opens the provider’s authorization page in a new tab; headless setups can paste the callback URL or code instead.",
	unavailable: "Connection unavailable; subscription status cannot be loaded.",
	checking: "Checking…",
	loginInProgress: "Login in progress…",
	loggedIn: "Logged in",
	loggedInAccount: "Logged in as {account}",
	loggedInExpires: "Logged in · expires {date}",
	loggedInAccountExpires: "Logged in as {account} · expires {date}",
	notLoggedIn: "Not logged in",
	login: "Log in",
	cancel: "Cancel",
	logout: "Log out",
	logoutConfirm: "Log out of {provider}?",
	manualSummary: "Browser flow not working? Paste the callback URL or code",
	manualPlaceholder: "Paste the callback URL or code",
	submit: "Submit",
	loginMissingUrl: "login answered without an authorizeUrl",
	usageTitle: "Usage",
	usageRefresh: "Refresh",
	usageLoading: "Loading usage…",
	usageEmpty: "No usage windows reported.",
	usageError: "Usage lookup failed: {message}",
	usageSession: "5-hour window",
	usageWeekly: "Weekly",
	usageWindow: "Window",
	usageResets: "resets {date}",
	usagePlan: "Plan: {plan}",
	generating: "Generating image…",
	image: "image",
	viewImage: "View image",
	viewImageNamed: "View {name}",
	imageLoading: "Loading…",
	imageLoadFailed: "Retry",
	imagePreview: "Image preview",
	imageClose: "Close",
	generatingVideo: "Generating video…",
	videoLoading: "Loading video…",
	videoLoadFailed: "Video failed to load: {message}",
	speed: "Speed",
	speedStandard: "Standard",
	speedStandardDescription: "Default speed",
	speedFast: "Fast",
	speedFastDescription: "1.5x speed, more usage",
	commandFast: "Switch the Codex speed tier (Standard/Fast)",
	commandFastUnavailable: "The current model has no fast tier; /fast only works on Codex models whose catalog advertises one",
	deviceFlowInstruction: "Open this URL in a browser and enter the code below",
	deviceFlowCode: "User code: {code}",
	deviceFlowExpiresIn: "Expires in {minutes} min",
	deviceFlowCopyCode: "Copy code",
	deviceFlowCopied: "Copied!",
	deviceFlowUrl: "Verification URL",
	deviceFlowCancelPolling: "Stop polling"
};
/** zh strings, one per {@link en} key. */
const zh = {
	nav: "订阅",
	intro: "在此登录或退出订阅服务商。点击登录会在新标签页打开服务商的授权页面；无浏览器环境可改为粘贴回调 URL 或授权码。",
	unavailable: "连接不可用，无法加载订阅状态。",
	checking: "查询中…",
	loginInProgress: "登录中…",
	loggedIn: "已登录",
	loggedInAccount: "已登录：{account}",
	loggedInExpires: "已登录 · 过期时间 {date}",
	loggedInAccountExpires: "已登录：{account} · 过期时间 {date}",
	notLoggedIn: "未登录",
	login: "登录",
	cancel: "取消",
	logout: "退出登录",
	logoutConfirm: "确定退出 {provider} 的登录吗？",
	manualSummary: "浏览器流程无法完成？粘贴回调 URL 或授权码",
	manualPlaceholder: "粘贴回调 URL 或授权码",
	submit: "提交",
	loginMissingUrl: "login 响应缺少 authorizeUrl",
	usageTitle: "用量",
	usageRefresh: "刷新",
	usageLoading: "用量加载中…",
	usageEmpty: "服务商未返回任何用量窗口。",
	usageError: "用量查询失败：{message}",
	usageSession: "5 小时窗口",
	usageWeekly: "每周",
	usageWindow: "窗口",
	usageResets: "{date} 重置",
	usagePlan: "计划：{plan}",
	generating: "正在生成图片…",
	image: "图片",
	viewImage: "查看图片",
	viewImageNamed: "查看 {name}",
	imageLoading: "加载中…",
	imageLoadFailed: "重试",
	imagePreview: "图片预览",
	imageClose: "关闭",
	generatingVideo: "正在生成视频…",
	videoLoading: "视频加载中…",
	videoLoadFailed: "视频加载失败：{message}",
	speed: "速度",
	speedStandard: "标准",
	speedStandardDescription: "默认速度",
	speedFast: "快速",
	speedFastDescription: "约 1.5 倍速度，消耗更多用量",
	commandFast: "切换 Codex 速度档（标准/快速）",
	commandFastUnavailable: "当前模型不支持快速档；/fast 仅对目录声明了 fast tier 的 Codex 模型可用",
	deviceFlowInstruction: "在浏览器中打开以下 URL 并输入下方验证码",
	deviceFlowCode: "验证码：{code}",
	deviceFlowExpiresIn: "剩余 {minutes} 分钟",
	deviceFlowCopyCode: "复制验证码",
	deviceFlowCopied: "已复制",
	deviceFlowUrl: "验证 URL",
	deviceFlowCancelPolling: "停止轮询"
};

//#endregion
//#region src/client/SubscriptionsSection.tsx
/** Logical RPC channel served by the node half of this plugin. */
const SUBSCRIPTIONS_AUTH_CHANNEL$2 = "/subscriptions-auth";
/** Poll cadence while a provider login attempt is busy. */
const POLL_INTERVAL_MS$1 = 2e3;
/** Card display metadata, in page order (names are brand names, not translated). */
const PROVIDERS = [
	{
		id: "codex",
		name: "Codex (ChatGPT)"
	},
	{
		id: "claude",
		name: "Claude"
	},
	{
		id: "grok",
		name: "Grok (X Premium)"
	},
	{
		id: "gemini",
		name: "Gemini (Google AI Studio)"
	},
	{
		id: "perplexity",
		name: "Perplexity AI"
	},
	{
		id: "github-copilot",
		name: "GitHub Copilot"
	},
	{
		id: "mistral",
		name: "Mistral AI"
	},
	{
		id: "agnes",
		name: "Agnes AI"
	},
	{
		id: "cursor",
		name: "Cursor"
	},
	{
		id: "huggingface",
		name: "Hugging Face"
	},
	{
		id: "windsurf",
		name: "Windsurf (Codeium)"
	},
	{
		id: "openrouter",
		name: "OpenRouter"
	},
	{
		id: "replicate",
		name: "Replicate"
	},
	{
		id: "fal",
		name: "fal.ai"
	},
	{
		id: "cohere",
		name: "Cohere"
	},
	{
		id: "voyage",
		name: "Voyage AI"
	},
	{
		id: "lepton",
		name: "Lepton AI"
	},
	{
		id: "octoai",
		name: "OctoAI"
	},
	{
		id: "qwen",
		name: "Qwen Code"
	}
];
/** Business error returned by the `/subscriptions-auth` channel (error branch message). */
var SubscriptionsAuthError = class extends Error {};
/**
* Call one `/subscriptions-auth` endpoint and unwrap the business result.
* Shared by the settings section and the composer Speed toggle.
* @param rpc - Connection RPC caller.
* @param endpoint - channel-relative endpoint.
* @param payload - channel-owned request payload.
* @returns the success value, cast by the caller to the endpoint's shape.
*/
async function callSubscriptionsAuth(rpc, endpoint, payload) {
	let result;
	try {
		result = await rpc.call(SUBSCRIPTIONS_AUTH_CHANNEL$2, endpoint, payload);
	} catch (error) {
		throw new SubscriptionsAuthError(error instanceof Error ? error.message : String(error));
	}
	if (!result.ok) throw new SubscriptionsAuthError(result.error.message);
	return result.value;
}
/** Human text of an action failure, SubscriptionsAuthError or not. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* English-dictionary fallback for a missing inject `t` (standalone renders);
* the slot inject always supplies the locale-bound one.
* @param key - dictionary key.
* @param params - `{name}` template params.
* @returns the template with params substituted.
*/
function fallbackTranslate$3(key, params) {
	let text = en[key];
	for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}
const styles$4 = {
	section: {
		display: "flex",
		flexDirection: "column",
		gap: 12,
		maxWidth: 560,
		color: "var(--dsw-alias-label-primary)"
	},
	intro: {
		margin: 0,
		color: "var(--dsw-alias-label-tertiary)",
		fontSize: 14,
		lineHeight: "22px"
	},
	card: {
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 12,
		padding: "12px 14px",
		display: "flex",
		flexDirection: "column",
		gap: 6
	},
	cardHeader: {
		display: "flex",
		alignItems: "center",
		gap: 8
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: "50%",
		flexShrink: 0
	},
	name: {
		fontWeight: 500,
		fontSize: 14,
		lineHeight: "22px",
		color: "var(--dsw-alias-label-primary)"
	},
	statusLine: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary)"
	},
	errorLine: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-state-error-primary)"
	},
	actions: {
		display: "flex",
		gap: 8,
		marginTop: 4,
		alignItems: "center",
		flexWrap: "wrap"
	},
	button: {
		boxSizing: "border-box",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		height: 28,
		padding: "0 10px",
		borderRadius: 14,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "transparent",
		color: "var(--dsw-alias-label-primary)",
		font: "inherit",
		fontSize: 12,
		lineHeight: "18px",
		cursor: "pointer"
	},
	usage: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		marginTop: 4,
		borderTop: "1px solid var(--dsw-alias-border-l2)",
		paddingTop: 8
	},
	usageHeader: {
		display: "flex",
		alignItems: "center",
		gap: 8
	},
	usageTitle: {
		fontSize: 12,
		lineHeight: "18px",
		fontWeight: 500,
		color: "var(--dsw-alias-label-secondary)"
	},
	usagePlan: {
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary)"
	},
	usageRefresh: {
		boxSizing: "border-box",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		height: 22,
		padding: "0 8px",
		borderRadius: 11,
		marginLeft: "auto",
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		font: "inherit",
		fontSize: 12,
		lineHeight: "18px",
		cursor: "pointer"
	},
	usageRow: {
		display: "flex",
		flexDirection: "column",
		gap: 3
	},
	usageMeta: {
		display: "flex",
		justifyContent: "space-between",
		gap: 8,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary)"
	},
	usageTrack: {
		height: 6,
		borderRadius: 3,
		overflow: "hidden",
		background: "var(--dsw-alias-bg-layer-1)",
		border: "1px solid var(--dsw-alias-border-l2)"
	},
	usageFill: {
		height: "100%",
		borderRadius: 3
	},
	manual: {
		marginTop: 4,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-secondary)"
	},
	manualRow: {
		display: "flex",
		gap: 8,
		marginTop: 6
	},
	manualInput: {
		flex: 1,
		height: 32,
		boxSizing: "border-box",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 8,
		padding: "0 10px",
		font: "inherit",
		fontSize: 14,
		lineHeight: "22px",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-primary)"
	},
	deviceFlowBox: {
		marginTop: 4,
		padding: "8px 10px",
		borderRadius: 8,
		background: "var(--dsw-alias-bg-layer-1)",
		border: "1px solid var(--dsw-alias-border-l2)",
		display: "flex",
		flexDirection: "column",
		gap: 4
	},
	deviceFlowUrl: {
		margin: 0,
		fontSize: 11,
		lineHeight: "17px",
		color: "var(--dsw-alias-label-tertiary)",
		wordBreak: "break-all"
	},
	deviceFlowCode: {
		margin: 0,
		fontSize: 13,
		lineHeight: "19px",
		fontWeight: 600,
		color: "var(--dsw-alias-label-primary)",
		letterSpacing: 0.5
	},
	deviceFlowExpires: {
		margin: 0,
		fontSize: 11,
		lineHeight: "17px",
		color: "var(--dsw-alias-state-warn-label)"
	},
	copyButton: {
		alignSelf: "flex-start",
		marginTop: 2,
		boxSizing: "border-box",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		height: 24,
		padding: "0 8px",
		borderRadius: 12,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		font: "inherit",
		fontSize: 11,
		lineHeight: "17px",
		cursor: "pointer"
	}
};
/** Status dot color for one provider state. */
function dotColor(status) {
	if (status?.busy === true) return "var(--dsw-alias-state-warn-label)";
	if (status?.loggedIn === true) return "var(--dsw-alias-state-success-primary)";
	return "var(--dsw-alias-label-dimmed)";
}
/**
* One-line status text for one provider state.
* @param t - section translate.
* @param status - the provider's last reported state.
* @returns the localized status line.
*/
function statusText(t, status) {
	if (status === void 0) return t("checking");
	if (status.busy) return t("loginInProgress");
	if (status.loggedIn) {
		const params = {};
		if (status.account !== void 0) params.account = status.account;
		if (status.expiresAt !== void 0) params.date = new Date(status.expiresAt).toLocaleString();
		if (params.account !== void 0 && params.date !== void 0) return t("loggedInAccountExpires", params);
		if (params.account !== void 0) return t("loggedInAccount", params);
		if (params.date !== void 0) return t("loggedInExpires", params);
		return t("loggedIn");
	}
	return t("notLoggedIn");
}
/**
* Localized label of one usage window (kind, plus the model scope when named).
* @param t - section translate.
* @param window - the reported window.
* @returns e.g. "5-hour window" or "Weekly · Opus".
*/
function usageWindowLabel(t, window$1) {
	const base = window$1.kind === "session" ? t("usageSession") : window$1.kind === "weekly" ? t("usageWeekly") : t("usageWindow");
	return window$1.scope !== void 0 && window$1.scope !== "" ? `${base} · ${window$1.scope}` : base;
}
/** Bar fill color: success normally, warn from 80%, error from 95%. */
function usageBarColor(usedPercent) {
	if (usedPercent >= 95) return "var(--dsw-alias-state-error-primary)";
	if (usedPercent >= 80) return "var(--dsw-alias-state-warn-label)";
	return "var(--dsw-alias-state-success-primary)";
}
/**
* The Subscriptions settings page component.
* @param props - the slot inject face ({@link SubscriptionsSectionInjected}).
* @returns the section body, or a notice while the RPC face is absent.
*/
function SubscriptionsSection(props) {
	const { rpc } = props;
	const t = props.t ?? fallbackTranslate$3;
	const [statuses, setStatuses] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [deviceFlowInfo, setDeviceFlowInfo] = (0, react.useState)({});
	const [manualDrafts, setManualDrafts] = (0, react.useState)({
		codex: "",
		claude: "",
		grok: "",
		gemini: "",
		perplexity: "",
		"github-copilot": "",
		mistral: "",
		agnes: "",
		cursor: "",
		huggingface: "",
		windsurf: "",
		openrouter: "",
		replicate: "",
		fal: "",
		cohere: "",
		voyage: "",
		lepton: "",
		octoai: ""
	});
	const [usages, setUsages] = (0, react.useState)({});
	const [usageErrors, setUsageErrors] = (0, react.useState)({});
	const [usageLoading, setUsageLoading] = (0, react.useState)({});
	const mountedRef = (0, react.useRef)(true);
	const pollersRef = (0, react.useRef)(/* @__PURE__ */ new Map());
	/** Providers with a `usage` call in flight; guards the auto-fetch effect against re-entry. */
	const usageInflightRef = (0, react.useRef)(/* @__PURE__ */ new Set());
	const setProviderError = (0, react.useCallback)((provider, message) => {
		if (!mountedRef.current) return;
		setErrors((prev) => {
			const next = { ...prev };
			if (message === void 0) delete next[provider];
			else next[provider] = message;
			return next;
		});
	}, []);
	const stopPolling = (0, react.useCallback)((provider) => {
		const poller = pollersRef.current.get(provider);
		if (poller !== void 0) {
			clearInterval(poller);
			pollersRef.current.delete(provider);
		}
	}, []);
	/** Refetch every provider's status; stop a provider's poller once its attempt settles. */
	const refresh = (0, react.useCallback)(async () => {
		if (rpc === void 0) return;
		let response;
		try {
			response = await callSubscriptionsAuth(rpc, "status", {});
		} catch {
			return;
		}
		if (!mountedRef.current) return;
		setStatuses(response.providers);
		for (const { id } of PROVIDERS) {
			const status = response.providers[id];
			if (status.loggedIn || !status.busy) {
				stopPolling(id);
				if (!status.busy) {
					setDeviceFlowInfo((prev) => {
						const next = { ...prev };
						delete next[id];
						return next;
					});
				}
			}
		}
	}, [rpc, stopPolling]);
	const startPolling = (0, react.useCallback)((provider) => {
		if (pollersRef.current.has(provider)) return;
		pollersRef.current.set(provider, setInterval(() => {
			refresh();
		}, POLL_INTERVAL_MS$1));
	}, [refresh]);
	(0, react.useEffect)(() => {
		mountedRef.current = true;
		refresh().then(() => {
			if (!mountedRef.current) return;
			setStatuses((current) => {
				for (const { id } of PROVIDERS) if (current[id]?.busy === true) startPolling(id);
				return current;
			});
		});
		return () => {
			mountedRef.current = false;
			for (const poller of pollersRef.current.values()) clearInterval(poller);
			pollersRef.current.clear();
		};
	}, [refresh, startPolling]);
	const loadUsage = (0, react.useCallback)(async (provider) => {
		if (rpc === void 0 || usageInflightRef.current.has(provider)) return;
		usageInflightRef.current.add(provider);
		setUsageLoading((prev) => ({
			...prev,
			[provider]: true
		}));
		try {
			const usage = await callSubscriptionsAuth(rpc, "usage", { provider });
			if (!mountedRef.current) return;
			setUsages((prev) => ({
				...prev,
				[provider]: usage
			}));
			setUsageErrors((prev) => {
				const next = { ...prev };
				delete next[provider];
				return next;
			});
		} catch (error) {
			if (mountedRef.current) setUsageErrors((prev) => ({
				...prev,
				[provider]: messageOf(error)
			}));
		} finally {
			usageInflightRef.current.delete(provider);
			if (mountedRef.current) setUsageLoading((prev) => ({
				...prev,
				[provider]: false
			}));
		}
	}, [rpc]);
	(0, react.useEffect)(() => {
		for (const { id } of PROVIDERS) {
			const status = statuses[id];
			if (status === void 0) continue;
			if (status.loggedIn) {
				if (usages[id] === void 0 && usageErrors[id] === void 0) loadUsage(id);
			} else if (usages[id] !== void 0 || usageErrors[id] !== void 0) {
				setUsages((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
				setUsageErrors((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
			}
		}
	}, [
		statuses,
		usages,
		usageErrors,
		loadUsage
	]);
	const login = (0, react.useCallback)(async (provider) => {
		if (rpc === void 0) return;
		setProviderError(provider, void 0);
		try {
			const response = await callSubscriptionsAuth(rpc, "login", { provider });
			if (typeof response.authorizeUrl === "string" && response.authorizeUrl === "") {
				await refresh();
				return;
			}
			if (typeof response.authorizeUrl !== "string") throw new SubscriptionsAuthError(t("loginMissingUrl"));
			// Device-flow response (Qwen): show verification UI immediately.
			if (response.busy === true && (response.userCode !== void 0 || response.authorizeUrl !== "")) {
				if (!mountedRef.current) return;
				setDeviceFlowInfo((prev) => ({ ...prev, [provider]: response }));
				setStatuses((prev) => ({
					...prev,
					[provider]: { ...prev[provider], busy: true, loggedIn: false }
				}));
				startPolling(provider);
				return;
			}
			window.open(response.authorizeUrl, "_blank", "noopener");
			if (!mountedRef.current) return;
			setStatuses((prev) => ({
				...prev,
				[provider]: {
					...prev[provider],
					busy: true,
					loggedIn: false
				}
			}));
			startPolling(provider);
		} catch (error) {
			setProviderError(provider, messageOf(error));
		}
	}, [
		rpc,
		t,
		setProviderError,
		startPolling
	]);
	const cancel = (0, react.useCallback)(async (provider) => {
		if (rpc === void 0) return;
		stopPolling(provider);
		setDeviceFlowInfo((prev) => {
			const next = { ...prev };
			delete next[provider];
			return next;
		});
		try {
			await callSubscriptionsAuth(rpc, "cancel", { provider });
		} catch (error) {
			setProviderError(provider, messageOf(error));
		}
		await refresh();
	}, [
		rpc,
		stopPolling,
		setProviderError,
		refresh
	]);
	const submitManual = (0, react.useCallback)(async (provider) => {
		if (rpc === void 0) return;
		const input = manualDrafts[provider].trim();
		if (input === "") return;
		setProviderError(provider, void 0);
		try {
			await callSubscriptionsAuth(rpc, "manual", {
				provider,
				input
			});
			if (mountedRef.current) setManualDrafts((prev) => ({
				...prev,
				[provider]: ""
			}));
		} catch (error) {
			setProviderError(provider, messageOf(error));
		}
		await refresh();
	}, [
		rpc,
		manualDrafts,
		setProviderError,
		refresh
	]);
	const logout = (0, react.useCallback)(async (provider, name) => {
		if (rpc === void 0) return;
		if (!window.confirm(t("logoutConfirm", { provider: name }))) return;
		setProviderError(provider, void 0);
		setDeviceFlowInfo((prev) => {
			const next = { ...prev };
			delete next[provider];
			return next;
		});
		try {
			await callSubscriptionsAuth(rpc, "logout", { provider });
		} catch (error) {
			setProviderError(provider, messageOf(error));
		}
		await refresh();
	}, [
		rpc,
		t,
		setProviderError,
		refresh
	]);
	if (rpc === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		style: styles$4.intro,
		children: t("unavailable")
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: styles$4.section,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: styles$4.intro,
			children: t("intro")
		}), PROVIDERS.map(({ id, name }) => {
			const status = statuses[id];
			const busy = status?.busy === true;
			const usage = usages[id];
			const usageError = usageErrors[id];
			const showUsage = status?.loggedIn === true && usage?.supported !== false && (usage !== void 0 || usageError !== void 0 || usageLoading[id] === true);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles$4.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$4.cardHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							...styles$4.dot,
							background: dotColor(status)
						} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles$4.name,
							children: name
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles$4.statusLine,
						children: statusText(t, status)
					}),
					status?.detail !== void 0 && status.detail !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles$4.statusLine,
						children: status.detail
					}),
					errors[id] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles$4.errorLine,
						children: errors[id]
					}),
					deviceFlowInfo[id] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$4.deviceFlowBox,
						children: [
							deviceFlowInfo[id].authorizeUrl !== void 0 && deviceFlowInfo[id].authorizeUrl !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.deviceFlowUrl,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									children: [t("deviceFlowUrl"), " ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: deviceFlowInfo[id].authorizeUrl,
										target: "_blank",
										rel: "noopener",
										style: { color: "inherit" },
										children: deviceFlowInfo[id].authorizeUrl
									})]
								})
							}),
							deviceFlowInfo[id].userCode !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.deviceFlowCode,
								children: t("deviceFlowCode", { code: deviceFlowInfo[id].userCode })
							}),
							deviceFlowInfo[id].expiresAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.deviceFlowExpires,
								children: (() => {
									const remaining = Math.max(0, Math.ceil((deviceFlowInfo[id].expiresAt - Date.now()) / 60000));
									return t("deviceFlowExpiresIn", { minutes: remaining });
								})()
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles$4.copyButton,
								onClick: () => {
									navigator.clipboard.writeText(deviceFlowInfo[id].userCode ?? "").then(() => {
										setDeviceFlowInfo((prev) => ({ ...prev, [id]: { ...prev[id], copied: true } }));
										setTimeout(() => setDeviceFlowInfo((prev) => ({ ...prev, [id]: { ...prev[id], copied: void 0 } })), 1500);
									});
								},
								children: deviceFlowInfo[id].copied === true ? t("deviceFlowCopied") : t("deviceFlowCopyCode")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$4.actions,
						children: [
							!busy && status?.loggedIn !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles$4.button,
								onClick: () => {
									login(id);
								},
								children: t("login")
							}),
							busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles$4.button,
								onClick: () => {
									cancel(id);
								},
								children: t("cancel")
							}),
							status?.loggedIn === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles$4.button,
								onClick: () => {
									logout(id, name);
								},
								children: t("logout")
							})
						]
					}),
					showUsage && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$4.usage,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles$4.usageHeader,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles$4.usageTitle,
										children: t("usageTitle")
									}),
									usage?.plan !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles$4.usagePlan,
										children: t("usagePlan", { plan: usage.plan })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...styles$4.usageRefresh,
											...usageLoading[id] === true ? {
												opacity: .5,
												cursor: "default"
											} : {}
										},
										disabled: usageLoading[id] === true,
										onClick: () => {
											loadUsage(id);
										},
										children: t("usageRefresh")
									})
								]
							}),
							usage === void 0 && usageError === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.statusLine,
								children: t("usageLoading")
							}),
							usageError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.errorLine,
								children: t("usageError", { message: usageError })
							}),
							usage?.windows !== void 0 && usage.windows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$4.statusLine,
								children: t("usageEmpty")
							}),
							(usage?.windows ?? []).map((window$1, index) => {
								const percent = Math.min(100, Math.max(0, window$1.usedPercent));
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles$4.usageRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles$4.usageMeta,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: usageWindowLabel(t, window$1) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [`${String(Math.round(percent))}%`, window$1.resetsAt !== void 0 && ` · ${t("usageResets", { date: new Date(window$1.resetsAt).toLocaleString() })}`] })]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: styles$4.usageTrack,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
											...styles$4.usageFill,
											width: `${String(percent)}%`,
											background: usageBarColor(percent)
										} })
									})]
								}, index);
							})
						]
					}),
					busy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						style: styles$4.manual,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("manualSummary") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles$4.manualRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: styles$4.manualInput,
								value: manualDrafts[id],
								placeholder: t("manualPlaceholder"),
								onChange: (event) => setManualDrafts((prev) => ({
									...prev,
									[id]: event.target.value
								}))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles$4.button,
								onClick: () => {
									submitManual(id);
								},
								children: t("submit")
							})]
						})]
					})
				]
			}, id);
		})]
	});
}

//#endregion
//#region src/client/ImageGallery.tsx
/** Display box for a lone image (platform rule): long edge 240px with the
* rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
* `object-fit: cover` — and never upscaled past the image's natural size. The
* crop anchor keeps the top of very tall images and the left of very wide
* ones, where the informative content usually starts. */
function singleFit(attachment) {
	const natural = attachment.width / attachment.height;
	const ratio = Math.min(4, Math.max(.25, natural));
	const box = ratio >= 1 ? {
		width: 240,
		height: 240 / ratio
	} : {
		width: 240 * ratio,
		height: 240
	};
	const scale = Math.min(1, attachment.width / box.width, attachment.height / box.height);
	return {
		width: Math.max(1, Math.round(box.width * scale)),
		height: Math.max(1, Math.round(box.height * scale)),
		objectPosition: natural < .25 ? "center top" : natural > 4 ? "left center" : "center"
	};
}
const styles$3 = {
	gallery: {
		display: "flex",
		flexWrap: "wrap",
		gap: 8,
		justifyContent: "flex-start"
	},
	frame: {
		display: "grid",
		placeItems: "center",
		overflow: "hidden",
		padding: 0,
		border: "1px solid var(--dsw-alias-border-l2-darkmode-thin)",
		borderRadius: 8,
		background: "var(--dsw-alias-interactive-bg-hover-solid)",
		cursor: "zoom-in"
	},
	tile: {
		width: 64,
		height: 64
	},
	img: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
		display: "block"
	},
	loading: {
		fontSize: 12,
		color: "var(--dsw-alias-label-tertiary)",
		padding: "0 8px"
	},
	error: {
		fontSize: 12,
		color: "var(--dsw-alias-state-error-primary)",
		cursor: "pointer",
		border: "1px solid var(--dsw-alias-border-l2-darkmode-thin)",
		borderRadius: 8,
		background: "transparent",
		padding: "6px 10px"
	},
	overlay: {
		position: "fixed",
		inset: 0,
		zIndex: 1e3,
		display: "grid",
		placeItems: "center",
		background: "rgba(0, 0, 0, 0.72)",
		padding: 24
	},
	overlayImg: {
		maxWidth: "92vw",
		maxHeight: "92vh",
		objectFit: "contain",
		borderRadius: 4
	},
	close: {
		position: "absolute",
		top: 12,
		right: 12,
		width: 32,
		height: 32,
		display: "grid",
		placeItems: "center",
		border: "none",
		borderRadius: "50%",
		cursor: "pointer",
		background: "rgba(255, 255, 255, 0.16)",
		color: "#fff",
		fontSize: 16,
		lineHeight: 1
	}
};
/**
* Full-viewport original-image preview: backdrop or close-control click and
* Escape all dismiss; the image itself is inert so a click on it does not
* fall through to the backdrop dismissal.
*/
function ImageLightbox({ src, alt, labels, onClose }) {
	(0, react.useEffect)(() => {
		const onKey = (event) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		role: "dialog",
		"aria-label": labels.dialog,
		style: styles$3.overlay,
		onClick: onClose,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
			src,
			alt,
			style: styles$3.overlayImg,
			onClick: (event) => {
				event.stopPropagation();
			}
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			"aria-label": labels.close,
			style: styles$3.close,
			onClick: onClose,
			children: "×"
		})]
	});
}
/**
* Compact history renderer with retryable loading and click-to-open original
* preview. A lone image renders at its `singleFit` size; an image among
* several renders as a fixed 64px square tile.
*/
function MessageImage({ attachment, load, variant, labels }) {
	const [src, setSrc] = (0, react.useState)(null);
	const [error, setError] = (0, react.useState)(false);
	const [open, setOpen] = (0, react.useState)(false);
	const [attempt, setAttempt] = (0, react.useState)(0);
	const retry = (0, react.useCallback)(() => {
		setAttempt((a) => a + 1);
	}, []);
	const close = (0, react.useCallback)(() => {
		setOpen(false);
	}, []);
	const fit = (0, react.useMemo)(() => variant === "single" ? singleFit(attachment) : void 0, [attachment, variant]);
	(0, react.useEffect)(() => {
		let live = true;
		setError(false);
		setSrc(null);
		load(attachment).then((url) => {
			if (live) setSrc(url);
		}).catch(() => {
			if (live) setError(true);
		});
		return () => {
			live = false;
		};
	}, [
		attachment,
		load,
		attempt
	]);
	const label = attachment.name ?? labels.image;
	if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		style: styles$3.error,
		onClick: retry,
		children: labels.loadFailed
	});
	const box = fit === void 0 ? styles$3.tile : {
		width: fit.width,
		height: fit.height
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		style: {
			...styles$3.frame,
			...box
		},
		title: labels.open,
		"aria-label": labels.openNamed(label),
		onClick: () => {
			if (src !== null) setOpen(true);
		},
		children: src === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: styles$3.loading,
			children: labels.loading
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
			src,
			alt: label,
			style: {
				...styles$3.img,
				objectPosition: fit?.objectPosition
			}
		})
	}), open && src !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageLightbox, {
		src,
		alt: label,
		labels: labels.lightbox,
		onClose: close
	})] });
}
/** Wrapping image group: a lone image renders large, several render as 64px
* square tiles (same rule as the platform gallery). */
function ImageGallery({ images, load, labels }) {
	if (images.length === 0) return null;
	const variant = images.length === 1 ? "single" : "tile";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: styles$3.gallery,
		children: images.map((image, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageImage, {
			attachment: image.attachment,
			load,
			variant,
			labels
		}, `${image.attachment.attachmentId}:${index}`))
	});
}

//#endregion
//#region src/client/ImageGenerateToolview.tsx
/** Logical RPC channel served by the node half of this plugin. */
const SUBSCRIPTIONS_AUTH_CHANNEL$1 = "/subscriptions-auth";
/** Title prompt truncation budget (characters). */
const PROMPT_MAX_LENGTH$1 = 60;
/**
* Call one `/subscriptions-auth` endpoint and unwrap the business result.
* @param rpc - Connection RPC caller.
* @param endpoint - channel-relative endpoint.
* @param payload - channel-owned request payload.
* @returns the success value, cast by the caller to the endpoint's shape.
*/
async function callSubscriptionsAuth$1(rpc, endpoint, payload) {
	const result = await rpc.call(SUBSCRIPTIONS_AUTH_CHANNEL$1, endpoint, payload);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}
/**
* Build the ImageGallery loader over the `image` endpoint.
* @param rpc - Connection RPC caller.
* @returns loader resolving an attachment ref to a data URL.
*/
function createImageLoader(rpc) {
	return (attachment) => callSubscriptionsAuth$1(rpc, "image", { ...attachment }).then((result) => `data:${result.mediaType};base64,${result.dataBase64}`);
}
/**
* English-dictionary fallback for a missing locale seat (standalone renders);
* the framework always supplies the namespace-bound one.
* @param key - dictionary key.
* @param params - `{name}` template params.
* @returns the template with params substituted.
*/
function fallbackTranslate$2(key, params) {
	let text = en[key];
	for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}
/** Extract the prompt from the call's raw args JSON; falls back to the first string value, then the raw line. */
function derivePrompt$1(argsRaw) {
	let parsed;
	try {
		parsed = JSON.parse(argsRaw);
	} catch {
		parsed = void 0;
	}
	let prompt;
	if (typeof parsed === "object" && parsed !== null) {
		const args = parsed;
		if (typeof args.prompt === "string" && args.prompt !== "") prompt = args.prompt;
		else for (const value of Object.values(args)) if (typeof value === "string" && value !== "") {
			prompt = value;
			break;
		}
	}
	const line = (prompt ?? argsRaw).split("\n", 1)[0] ?? "";
	return line.length > PROMPT_MAX_LENGTH$1 ? `${line.slice(0, PROMPT_MAX_LENGTH$1)}…` : line;
}
/** Flatten a settled result's text blocks (the degraded text-only route and the error line). */
function resultText$1(block) {
	if (!("kind" in block)) return "";
	const parts = [];
	for (const part of block.content) if (part.type === "text") parts.push(part.text);
	if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
	return parts.join("\n");
}
/** Image attachments of a settled result; empty while running or on the text-only route. */
function resultImages(block) {
	if (!("kind" in block)) return [];
	const images = [];
	for (const part of block.content) if (part.type === "image") images.push({ attachment: part.attachment });
	return images;
}
const styles$2 = {
	container: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		padding: "4px 0"
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: 6,
		minWidth: 0
	},
	icon: {
		display: "inline-flex",
		flexShrink: 0,
		color: "var(--dsw-alias-label-tertiary)"
	},
	title: {
		fontSize: 13,
		lineHeight: "20px",
		color: "var(--dsw-alias-label-primary)",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	subtle: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary)"
	},
	output: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-secondary)",
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere"
	},
	error: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-state-error-primary)"
	}
};
/**
* The `image_generate` keyed toolview component.
* @param props - owner share, inject face, and locale seat (spread flat).
* @returns the call row plus, once settled, the gallery / text / error body.
*/
function ImageGenerateToolview(props) {
	const { block, load } = props;
	const t = props.t ?? fallbackTranslate$2;
	if (block === void 0) return null;
	const settled = "kind" in block;
	const title = `image_generate: ${derivePrompt$1((settled ? block.call?.argsRaw : block.argsRaw) ?? "")}`;
	const images = resultImages(block);
	const text = settled ? resultText$1(block) : "";
	const labels = {
		image: t("image"),
		open: t("viewImage"),
		openNamed: (name) => t("viewImageNamed", { name }),
		loading: t("imageLoading"),
		loadFailed: t("imageLoadFailed"),
		lightbox: {
			dialog: t("imagePreview"),
			close: t("imageClose")
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: styles$2.container,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles$2.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$2.icon,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 14 })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$2.title,
					children: title
				})]
			}),
			!settled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$2.subtle,
				children: t("generating")
			}),
			settled && block.isError && text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$2.error,
				children: text.split("\n", 1)[0]
			}),
			settled && !block.isError && images.length > 0 && load !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageGallery, {
				images,
				load,
				labels
			}),
			settled && !block.isError && images.length === 0 && text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$2.output,
				children: text
			})
		]
	});
}

//#endregion
//#region src/client/VideoGenerateToolview.tsx
/** Logical RPC channel served by the node half of this plugin. */
const SUBSCRIPTIONS_AUTH_CHANNEL = "/subscriptions-auth";
/** Title prompt truncation budget (characters). */
const PROMPT_MAX_LENGTH = 60;
/**
* Build the video loader over the `/subscriptions-auth` `video` endpoint.
* @param rpc - Connection RPC caller.
* @returns loader resolving a bare file name to the decoded bytes.
*/
function createVideoLoader(rpc) {
	return async (name) => {
		const result = await rpc.call(SUBSCRIPTIONS_AUTH_CHANNEL, "video", { name });
		if (!result.ok) throw new Error(result.error.message);
		return result.value;
	};
}
/**
* English-dictionary fallback for a missing locale seat (standalone renders);
* the framework always supplies the namespace-bound one.
*/
function fallbackTranslate$1(key, params) {
	let text = en[key];
	for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}
/** Extract the prompt from the call's raw args JSON; falls back to the first string value, then the raw line. */
function derivePrompt(argsRaw) {
	let parsed;
	try {
		parsed = JSON.parse(argsRaw);
	} catch {
		parsed = void 0;
	}
	let prompt;
	if (typeof parsed === "object" && parsed !== null) {
		const args = parsed;
		if (typeof args.prompt === "string" && args.prompt !== "") prompt = args.prompt;
		else for (const value of Object.values(args)) if (typeof value === "string" && value !== "") {
			prompt = value;
			break;
		}
	}
	const line = (prompt ?? argsRaw).split("\n", 1)[0] ?? "";
	return line.length > PROMPT_MAX_LENGTH ? `${line.slice(0, PROMPT_MAX_LENGTH)}…` : line;
}
/** Flatten a settled result's text blocks (the fallback body and the error line). */
function resultText(block) {
	if (!("kind" in block)) return "";
	const parts = [];
	for (const part of block.content) if (part.type === "text") parts.push(part.text);
	if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
	return parts.join("\n");
}
/**
* The generated video's bare file name: presentation meta first (top-level
* dispatches), then the render text's "Saved video to …" line (nested
* dispatches compute no meta).
*/
function resolveFileName(block) {
	if (!("kind" in block)) return void 0;
	const meta = block.meta;
	if (typeof meta === "object" && meta !== null) {
		const fileName = meta.fileName;
		if (typeof fileName === "string" && fileName.length > 0) return fileName;
	}
	const match = /^Saved video to (.+\.mp4)/m.exec(resultText(block));
	if (match === null) return void 0;
	const path = match[1];
	return path.slice(path.lastIndexOf("/") + 1);
}
/** Decode a base64 payload into bytes (browser-side; no Buffer). */
function base64Bytes(dataBase64) {
	const binary = atob(dataBase64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
const styles$1 = {
	container: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		padding: "4px 0"
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: 6,
		minWidth: 0
	},
	icon: {
		display: "inline-flex",
		flexShrink: 0,
		color: "var(--dsw-alias-label-tertiary)"
	},
	title: {
		fontSize: 13,
		lineHeight: "20px",
		color: "var(--dsw-alias-label-primary)",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	subtle: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary)"
	},
	output: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-secondary)",
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere"
	},
	error: {
		margin: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-state-error-primary)"
	},
	video: {
		display: "block",
		maxWidth: 480,
		width: "100%",
		borderRadius: 8,
		backgroundColor: "var(--dsw-alias-fill-tertiary)"
	}
};
/**
* The `video_generate` keyed toolview component.
* @param props - owner share, inject face, and locale seat (spread flat).
* @returns the call row plus, once settled, the player / text / error body.
*/
function VideoGenerateToolview(props) {
	const { block, loadVideo } = props;
	const t = props.t ?? fallbackTranslate$1;
	const settled = block !== void 0 && "kind" in block;
	const isError = settled && block.isError;
	const fileName = block !== void 0 && settled && !isError ? resolveFileName(block) : void 0;
	const [load, setLoad] = (0, react.useState)({ phase: "loading" });
	(0, react.useEffect)(() => {
		if (fileName === void 0 || loadVideo === void 0) return;
		let cancelled = false;
		let objectUrl;
		setLoad({ phase: "loading" });
		loadVideo(fileName).then((video) => {
			if (cancelled) return;
			objectUrl = URL.createObjectURL(new Blob([base64Bytes(video.dataBase64).slice()], { type: video.mediaType }));
			setLoad({
				phase: "ready",
				url: objectUrl
			});
		}, (error) => {
			if (cancelled) return;
			setLoad({
				phase: "failed",
				message: error instanceof Error ? error.message : String(error)
			});
		});
		return () => {
			cancelled = true;
			if (objectUrl !== void 0) URL.revokeObjectURL(objectUrl);
		};
	}, [fileName, loadVideo]);
	if (block === void 0) return null;
	const title = `video_generate: ${derivePrompt((settled ? block.call?.argsRaw : block.argsRaw) ?? "")}`;
	const text = settled ? resultText(block) : "";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: styles$1.container,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles$1.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.icon,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 14 })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.title,
					children: title
				})]
			}),
			!settled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$1.subtle,
				children: t("generatingVideo")
			}),
			settled && isError && text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$1.error,
				children: text.split("\n", 1)[0]
			}),
			settled && !isError && fileName !== void 0 && load.phase === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$1.subtle,
				children: t("videoLoading")
			}),
			settled && !isError && fileName !== void 0 && load.phase === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$1.error,
				children: t("videoLoadFailed", { message: load.message })
			}),
			settled && !isError && fileName !== void 0 && load.phase === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
				style: styles$1.video,
				src: load.url,
				controls: true,
				preload: "metadata"
			}),
			settled && !isError && fileName === void 0 && text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: styles$1.output,
				children: text
			})
		]
	});
}

//#endregion
//#region src/client/SpeedSelect.tsx
/**
* The `loadSpeed` half of the inject face: the plugin's own speed state plus
* the host's current model selection (the visibility gate). A model-RPC
* failure throws rather than answering "hidden" — the caller keeps its last
* known state, so a transient failure never locks the toggle away.
*
* `sessionId` is a plain string: slot and command contexts brand it through
* different dsh-session copies, and only the API-client boundary needs one.
*/
function createSpeedLoader(connection, sessionId) {
	return async () => {
		const state = await callSubscriptionsAuth(connection.rpc, "speed", { sessionId });
		const { result } = await connection.api.sessions.models({ sessionId });
		if (!result.ok) throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`);
		const current = result.value.current;
		return {
			visible: current !== null && current.provider === "codex" && state.fastModels.includes(current.model),
			tier: state.tier
		};
	};
}
/** The `setSpeed` half of the inject face: boolean outcome for the component's busy state. */
function createSpeedSetter(connection, sessionId) {
	return (tier) => callSubscriptionsAuth(connection.rpc, "setSpeed", {
		sessionId,
		tier
	}).then(() => true, () => false);
}
/** English-dictionary fallback for a missing inject `t` (standalone renders). */
function fallbackTranslate(key) {
	return en[key];
}
const TIERS = ["standard", "fast"];
/**
* The composer Speed control: a trigger reading `速度 · 快速`/`速度 · 标准`
* that opens a two-row menu (standard/fast with descriptions, check mark on
* the current tier). Mount and every open reload the host state so a model
* switch made since the last open self-corrects.
*/
/** How often the control re-reads the host state (model switches arrive only by asking). */
const POLL_INTERVAL_MS = 3e3;
/**
* The composer Speed control: a trigger reading `速度 · 快速`/`速度 · 标准`
* that opens a two-row menu (standard/fast with descriptions, check mark on
* the current tier). The host pushes nothing on a model switch, so the
* control re-reads on a slow poll with a single-flight guard; a failed read
* keeps the last known state, so a transient RPC failure can never lock the
* toggle away (the earlier mount-only load had no recovery path).
*/
function SpeedSelect({ loadSpeed, setSpeed, t }) {
	const translate = t ?? fallbackTranslate;
	const [state, setState] = (0, react.useState)(null);
	const [open, setOpen] = (0, react.useState)(false);
	const [busy, setBusy] = (0, react.useState)(false);
	const rootRef = (0, react.useRef)(null);
	const loadRef = (0, react.useRef)(loadSpeed);
	loadRef.current = loadSpeed;
	(0, react.useEffect)(() => {
		if (loadRef.current === void 0) return;
		let cancelled = false;
		let inflight = false;
		const reload = () => {
			const load = loadRef.current;
			if (load === void 0 || inflight) return;
			inflight = true;
			load().then((loaded) => {
				if (!cancelled) setState(loaded);
			}, () => {}).finally(() => {
				inflight = false;
			});
		};
		reload();
		const timer = setInterval(reload, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);
	(0, react.useEffect)(() => {
		if (!open) return;
		const closeOutside = (event) => {
			if (!rootRef.current?.contains(event.target)) setOpen(false);
		};
		document.addEventListener("mousedown", closeOutside);
		return () => {
			document.removeEventListener("mousedown", closeOutside);
		};
	}, [open]);
	if (loadSpeed === void 0 || setSpeed === void 0 || state === null || !state.visible) return null;
	const choose = (tier) => {
		if (busy) return;
		if (tier === state.tier) {
			setOpen(false);
			return;
		}
		setBusy(true);
		setSpeed(tier).then((ok) => {
			setBusy(false);
			if (ok) {
				setState({
					visible: true,
					tier
				});
				setOpen(false);
			}
		});
	};
	const show = () => {
		setOpen(true);
		const load = loadRef.current;
		if (load === void 0) return;
		load().then(setState, () => {});
	};
	const tierName = (tier) => translate(tier === "fast" ? "speedFast" : "speedStandard");
	const tierDescription = (tier) => translate(tier === "fast" ? "speedFastDescription" : "speedStandardDescription");
	const triggerLabel = `${translate("speed")} · ${tierName(state.tier)}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: rootRef,
		style: styles.root,
		onKeyDown: (event) => {
			if (event.key === "Escape" && open) {
				event.preventDefault();
				setOpen(false);
			}
		},
		children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: styles.menu,
			role: "menu",
			"aria-label": translate("speed"),
			children: TIERS.map((tier) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitemradio",
				"aria-checked": tier === state.tier,
				style: styles.item,
				disabled: busy,
				onClick: () => {
					choose(tier);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.itemCheck,
					children: tier === state.tier ? "✓" : ""
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: styles.itemText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.itemName,
						children: tierName(tier)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.itemDescription,
						children: tierDescription(tier)
					})]
				})]
			}, tier))
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			style: styles.trigger,
			"aria-haspopup": "menu",
			"aria-expanded": open,
			title: triggerLabel,
			disabled: busy,
			onClick: () => {
				if (open) setOpen(false);
				else show();
			},
			children: triggerLabel
		})]
	});
}
const styles = {
	root: {
		position: "relative",
		display: "inline-flex"
	},
	trigger: {
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 8,
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		font: "inherit",
		fontSize: 12,
		lineHeight: "18px",
		padding: "2px 8px",
		cursor: "pointer",
		whiteSpace: "nowrap"
	},
	menu: {
		position: "absolute",
		bottom: "100%",
		right: 0,
		marginBottom: 4,
		minWidth: 180,
		padding: 4,
		zIndex: 20,
		background: "var(--dsw-alias-bg-layer-1)",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 8,
		display: "flex",
		flexDirection: "column",
		gap: 2
	},
	item: {
		display: "flex",
		alignItems: "flex-start",
		gap: 6,
		width: "100%",
		border: "none",
		borderRadius: 6,
		background: "transparent",
		padding: "6px 8px",
		cursor: "pointer",
		font: "inherit",
		textAlign: "left"
	},
	itemCheck: {
		width: 14,
		flexShrink: 0,
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-primary)"
	},
	itemText: {
		display: "flex",
		flexDirection: "column"
	},
	itemName: {
		fontSize: 12,
		lineHeight: "18px",
		color: "var(--dsw-alias-label-primary)"
	},
	itemDescription: {
		fontSize: 11,
		lineHeight: "16px",
		color: "var(--dsw-alias-label-tertiary)"
	}
};

//#endregion
//#region src/client/index.ts
/** Dictionary namespace owned by this plugin. */
const NS = "settings.subscriptions";
/**
* Required services (cordis fiber inject): `slots` carries the registration
* seat, `connection` the `/subscriptions-auth` RPC caller, and `locale` the copy
* dictionaries.
*/
const inject = [
	"slots",
	"connection",
	"locale"
];
/**
* Register the Subscriptions section once the `settings.section` declaration
* is on the ledger (the shell's apply order relative to this one is NOT
* constrained; registration depends on the slot through `slots.inject()`).
* @param ctx - client root context.
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-plugin-subscriptions: copy dictionaries");
	const connection = ctx.get("connection");
	const t = ctx.locale.bind(NS);
	const injected = () => ({
		rpc: connection.rpc,
		t
	});
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "subscriptions",
		order: 90,
		label: () => t("nav"),
		inject: injected
	}, SubscriptionsSection));
	const toolviewInjected = () => ({ load: createImageLoader(connection.rpc) });
	ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "image_generate",
		locale: NS,
		inject: toolviewInjected
	}, ImageGenerateToolview));
	const videoToolviewInjected = () => ({ loadVideo: createVideoLoader(connection.rpc) });
	ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "video_generate",
		locale: NS,
		inject: videoToolviewInjected
	}, VideoGenerateToolview));
	ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
		name: "conversation.input.right",
		id: "codex-speed",
		order: 0,
		locale: NS,
		inject: (sessionId) => ({
			loadSpeed: createSpeedLoader(connection, sessionId),
			setSpeed: createSpeedSetter(connection, sessionId)
		})
	}, SpeedSelect));
	ctx.inject(["commandUi"], (scope) => {
		const command = scope.get("commandUi");
		scope.effect(() => command.register({
			name: "fast",
			description: t("commandFast"),
			available: () => true,
			ui: {
				kind: "popupSelect",
				options: async (session) => {
					const state = await createSpeedLoader(connection, session.sessionId)();
					if (!state.visible) throw new Error(t("commandFastUnavailable"));
					return [{
						id: "standard",
						label: t("speedStandard"),
						detail: t("speedStandardDescription")
					}, {
						id: "fast",
						label: t("speedFast"),
						detail: t("speedFastDescription")
					}].map((option) => ({
						...option,
						active: option.id === state.tier
					}));
				},
				onSelect: async (option, session) => {
					await createSpeedSetter(connection, session.sessionId)(option.id);
				}
			}
		}), "dsh-plugin-subscriptions: /fast contribution");
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map