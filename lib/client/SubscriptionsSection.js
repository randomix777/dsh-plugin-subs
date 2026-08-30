import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Subscriptions settings section: one card per subscription provider with an
 * OAuth login/logout flow driven by the node half's `/subscriptions-auth` RPC
 * channel. Login state lives server-side; the page polls `status` only while
 * a login attempt is busy, so an idle page never polls. All state is local
 * React state — the page has no store.
 *
 * Every color resolves through a `--dsw-alias-*` design token (the ui-theme
 * design-platform.css values flip under `body[data-ds-dark-theme]`), and
 * every user-visible string goes through the locale-bound `t` of the
 * 'settings.subscriptions' namespace. Buttons and inputs take the
 * ModelsSection vocabulary minus hover rules, which inline styles cannot
 * express.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { en } from './locales.js';
/** Logical RPC channel served by the node half of this plugin. */
const SUBSCRIPTIONS_AUTH_CHANNEL = '/subscriptions-auth';
/** Poll cadence while a provider login attempt is busy. */
const POLL_INTERVAL_MS = 2000;
/** Card display metadata, in page order (names are brand names, not translated). */
const PROVIDERS = [
    { id: 'codex', name: 'Codex (ChatGPT)' },
    { id: 'claude', name: 'Claude' },
    { id: 'grok', name: 'Grok (X Premium)' },
    { id: 'copilot', name: 'GitHub Copilot' },
    { id: 'antigravity', name: 'Google Antigravity' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'agnes', name: 'Agnes AI' },
    { id: 'qwen', name: 'Qwen Code' },
    { id: 'spark', name: 'iFlytek Spark' },
    { id: 'ernie', name: 'Baidu ERNIE' },
];
/** Business error returned by the `/subscriptions-auth` channel (error branch message). */
class SubscriptionsAuthError extends Error {
}
/**
 * Call one `/subscriptions-auth` endpoint and unwrap the business result.
 * Shared by the settings section and the composer Speed toggle.
 * @param rpc - Connection RPC caller.
 * @param endpoint - channel-relative endpoint.
 * @param payload - channel-owned request payload.
 * @returns the success value, cast by the caller to the endpoint's shape.
 */
export async function callSubscriptionsAuth(rpc, endpoint, payload) {
    let result;
    try {
        result = await rpc.call(SUBSCRIPTIONS_AUTH_CHANNEL, endpoint, payload);
    }
    catch (error) {
        // The transport rejected rather than answering; surface the same way.
        throw new SubscriptionsAuthError(error instanceof Error ? error.message : String(error));
    }
    if (!result.ok)
        throw new SubscriptionsAuthError(result.error.message);
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
function fallbackTranslate(key, params) {
    let text = en[key];
    for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
}
const styles = {
    section: {
        display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560,
        color: 'var(--dsw-alias-label-primary)',
    },
    intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 14, lineHeight: '22px' },
    card: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
    },
    cardHeader: { display: 'flex', alignItems: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    name: { fontWeight: 500, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
    statusLine: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
    errorLine: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
    actions: { display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
    button: {
        boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 28, padding: '0 10px', borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12, lineHeight: '18px',
        cursor: 'pointer',
    },
    usage: {
        display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4,
        borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8,
    },
    usageHeader: { display: 'flex', alignItems: 'center', gap: 8 },
    usageTitle: { fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' },
    usagePlan: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
    usageRefresh: {
        boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 22, padding: '0 8px', borderRadius: 11, marginLeft: 'auto',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 12, lineHeight: '18px',
        cursor: 'pointer',
    },
    usageRow: { display: 'flex', flexDirection: 'column', gap: 3 },
    usageMeta: {
        display: 'flex', justifyContent: 'space-between', gap: 8,
        fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)',
    },
    usageTrack: {
        height: 6, borderRadius: 3, overflow: 'hidden',
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)',
    },
    usageFill: { height: '100%', borderRadius: 3 },
    manual: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    manualRow: { display: 'flex', gap: 8, marginTop: 6 },
    manualInput: {
        flex: 1, height: 32, boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
        padding: '0 10px', font: 'inherit', fontSize: 14, lineHeight: '22px',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
    },
    deviceFlowBox: { marginTop: 4, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 4 },
    deviceFlowUrl: { margin: 0, fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)', wordBreak: 'break-all' },
    deviceFlowCode: { margin: 0, fontSize: 13, lineHeight: '19px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', letterSpacing: 0.5 },
    deviceFlowExpires: { margin: 0, fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-state-warn-label)' },
    copyButton: { alignSelf: 'flex-start', marginTop: 2, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 24, padding: '0 8px', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 11, lineHeight: '17px', cursor: 'pointer' },
};
/** Status dot color for one provider state. */
function dotColor(status) {
    if (status?.busy === true)
        return 'var(--dsw-alias-state-warn-label)';
    if (status?.loggedIn === true)
        return 'var(--dsw-alias-state-success-primary)';
    return 'var(--dsw-alias-label-dimmed)';
}
/**
 * One-line status text for one provider state.
 * @param t - section translate.
 * @param status - the provider's last reported state.
 * @returns the localized status line.
 */
function statusText(t, status) {
    if (status === undefined)
        return t('checking');
    if (status.busy)
        return t('loginInProgress');
    if (status.loggedIn) {
        const params = {};
        if (status.account !== undefined)
            params.account = status.account;
        if (status.expiresAt !== undefined)
            params.date = new Date(status.expiresAt).toLocaleString();
        if (params.account !== undefined && params.date !== undefined)
            return t('loggedInAccountExpires', params);
        if (params.account !== undefined)
            return t('loggedInAccount', params);
        if (params.date !== undefined)
            return t('loggedInExpires', params);
        return t('loggedIn');
    }
    return t('notLoggedIn');
}
/**
 * Localized label of one usage window (kind, plus the model scope when named).
 * @param t - section translate.
 * @param window - the reported window.
 * @returns e.g. "5-hour window" or "Weekly · Opus".
 */
function usageWindowLabel(t, window) {
    const base = window.kind === 'session'
        ? t('usageSession')
        : window.kind === 'weekly' ? t('usageWeekly') : t('usageWindow');
    return window.scope !== undefined && window.scope !== '' ? `${base} · ${window.scope}` : base;
}
/** Bar fill color: success normally, warn from 80%, error from 95%. */
function usageBarColor(usedPercent) {
    if (usedPercent >= 95)
        return 'var(--dsw-alias-state-error-primary)';
    if (usedPercent >= 80)
        return 'var(--dsw-alias-state-warn-label)';
    return 'var(--dsw-alias-state-success-primary)';
}
/**
 * The Subscriptions settings page component.
 * @param props - the slot inject face ({@link SubscriptionsSectionInjected}).
 * @returns the section body, or a notice while the RPC face is absent.
 */
export function SubscriptionsSection(props) {
    const { rpc } = props;
    const t = props.t ?? fallbackTranslate;
    const [statuses, setStatuses] = useState({});
    const [errors, setErrors] = useState({});
    const [deviceFlowInfo, setDeviceFlowInfo] = useState({});
    const [manualDrafts, setManualDrafts] = useState({
        codex: '', claude: '', grok: '',
    });
    const [usages, setUsages] = useState({});
    const [usageErrors, setUsageErrors] = useState({});
    const [usageLoading, setUsageLoading] = useState({});
    const mountedRef = useRef(true);
    const pollersRef = useRef(new Map());
    /** Providers with a `usage` call in flight; guards the auto-fetch effect against re-entry. */
    const usageInflightRef = useRef(new Set());
    const setProviderError = useCallback((provider, message) => {
        if (!mountedRef.current)
            return;
        setErrors((prev) => {
            const next = { ...prev };
            if (message === undefined)
                delete next[provider];
            else
                next[provider] = message;
            return next;
        });
    }, []);
    const stopPolling = useCallback((provider) => {
        const poller = pollersRef.current.get(provider);
        if (poller !== undefined) {
            clearInterval(poller);
            pollersRef.current.delete(provider);
        }
    }, []);
    /** Refetch every provider's status; stop a provider's poller once its attempt settles. */
    const refresh = useCallback(async () => {
        if (rpc === undefined)
            return;
        let response;
        try {
            response = await callSubscriptionsAuth(rpc, 'status', {});
        }
        catch {
            // A failed poll must not kill the page; busy providers keep polling and
            // the action paths report their own errors.
            return;
        }
        if (!mountedRef.current)
            return;
        setStatuses(response.providers);
        for (const { id } of PROVIDERS) {
            const status = response.providers[id];
            if (status.loggedIn || !status.busy) {
                stopPolling(id);
                if (!status.busy) {
                    setDeviceFlowInfo(prev => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                    });
                }
            }
        }
    }, [rpc, stopPolling]);
    const startPolling = useCallback((provider) => {
        if (pollersRef.current.has(provider))
            return;
        pollersRef.current.set(provider, setInterval(() => { void refresh(); }, POLL_INTERVAL_MS));
    }, [refresh]);
    // Initial load; every busy provider (e.g. an attempt started before a page
    // reload) resumes polling. Teardown clears pollers and the mounted guard.
    useEffect(() => {
        mountedRef.current = true;
        void refresh().then(() => {
            if (!mountedRef.current)
                return;
            setStatuses((current) => {
                for (const { id } of PROVIDERS) {
                    if (current[id]?.busy === true)
                        startPolling(id);
                }
                return current;
            });
        });
        return () => {
            mountedRef.current = false;
            for (const poller of pollersRef.current.values())
                clearInterval(poller);
            pollersRef.current.clear();
        };
    }, [refresh, startPolling]);
    const loadUsage = useCallback(async (provider) => {
        if (rpc === undefined || usageInflightRef.current.has(provider))
            return;
        usageInflightRef.current.add(provider);
        setUsageLoading(prev => ({ ...prev, [provider]: true }));
        try {
            const usage = await callSubscriptionsAuth(rpc, 'usage', { provider });
            if (!mountedRef.current)
                return;
            setUsages(prev => ({ ...prev, [provider]: usage }));
            setUsageErrors((prev) => {
                const next = { ...prev };
                delete next[provider];
                return next;
            });
        }
        catch (error) {
            if (mountedRef.current)
                setUsageErrors(prev => ({ ...prev, [provider]: messageOf(error) }));
        }
        finally {
            usageInflightRef.current.delete(provider);
            if (mountedRef.current)
                setUsageLoading(prev => ({ ...prev, [provider]: false }));
        }
    }, [rpc]);
    // Fetch usage once a provider is logged in; drop the cached snapshot on
    // logout so a re-login refetches. A failed lookup does not auto-retry — the
    // per-card Refresh button is the retry path.
    useEffect(() => {
        for (const { id } of PROVIDERS) {
            const status = statuses[id];
            if (status === undefined)
                continue;
            if (status.loggedIn) {
                if (usages[id] === undefined && usageErrors[id] === undefined)
                    void loadUsage(id);
            }
            else if (usages[id] !== undefined || usageErrors[id] !== undefined) {
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
    }, [statuses, usages, usageErrors, loadUsage]);
    const login = useCallback(async (provider) => {
        if (rpc === undefined)
            return;
        setProviderError(provider, undefined);
        try {
            const response = await callSubscriptionsAuth(rpc, 'login', { provider });
            if (typeof response.authorizeUrl === 'string' && response.authorizeUrl === '') {
                // Instant login (e.g. imported from Claude Code credentials)
                await refresh();
                return;
            }
            if (typeof response.authorizeUrl !== 'string') {
                throw new SubscriptionsAuthError(t('loginMissingUrl'));
            }
            // Device-flow response (Qwen): show verification UI immediately.
            if (response.busy === true && (response.userCode !== undefined || response.authorizeUrl !== '')) {
                if (!mountedRef.current)
                    return;
                setDeviceFlowInfo(prev => ({ ...prev, [provider]: response }));
                setStatuses(prev => ({
                    ...prev,
                    [provider]: { ...prev[provider], busy: true, loggedIn: false },
                }));
                startPolling(provider);
                return;
            }
            window.open(response.authorizeUrl, '_blank', 'noopener');
            if (!mountedRef.current)
                return;
            // Optimistic busy so Cancel and the manual fallback appear before the first poll tick.
            setStatuses(prev => ({ ...prev, [provider]: { ...prev[provider], busy: true, loggedIn: false } }));
            startPolling(provider);
        }
        catch (error) {
            setProviderError(provider, messageOf(error));
        }
    }, [rpc, t, setProviderError, startPolling]);
    const cancel = useCallback(async (provider) => {
        if (rpc === undefined)
            return;
        stopPolling(provider);
        setDeviceFlowInfo(prev => {
            const next = { ...prev };
            delete next[provider];
            return next;
        });
        try {
            await callSubscriptionsAuth(rpc, 'cancel', { provider });
        }
        catch (error) {
            setProviderError(provider, messageOf(error));
        }
        await refresh();
    }, [rpc, stopPolling, setProviderError, refresh]);
    const submitManual = useCallback(async (provider) => {
        if (rpc === undefined)
            return;
        const input = manualDrafts[provider].trim();
        if (input === '')
            return;
        setProviderError(provider, undefined);
        try {
            await callSubscriptionsAuth(rpc, 'manual', { provider, input });
            if (mountedRef.current)
                setManualDrafts(prev => ({ ...prev, [provider]: '' }));
        }
        catch (error) {
            setProviderError(provider, messageOf(error));
        }
        await refresh();
    }, [rpc, manualDrafts, setProviderError, refresh]);
    const logout = useCallback(async (provider, name) => {
        if (rpc === undefined)
            return;
        if (!window.confirm(t('logoutConfirm', { provider: name })))
            return;
        setProviderError(provider, undefined);
        setDeviceFlowInfo(prev => {
            const next = { ...prev };
            delete next[provider];
            return next;
        });
        try {
            await callSubscriptionsAuth(rpc, 'logout', { provider });
        }
        catch (error) {
            setProviderError(provider, messageOf(error));
        }
        await refresh();
    }, [rpc, t, setProviderError, refresh]);
    if (rpc === undefined) {
        return _jsx("p", { style: styles.intro, children: t('unavailable') });
    }
    return (_jsxs("div", { style: styles.section, children: [_jsx("p", { style: styles.intro, children: t('intro') }), PROVIDERS.map(({ id, name }) => {
                const status = statuses[id];
                const busy = status?.busy === true;
                const usage = usages[id];
                const usageError = usageErrors[id];
                // Providers without a usage endpoint answer supported:false — no block.
                const showUsage = status?.loggedIn === true && usage?.supported !== false
                    && (usage !== undefined || usageError !== undefined || usageLoading[id] === true);
                return (_jsxs("div", { style: styles.card, children: [_jsxs("div", { style: styles.cardHeader, children: [_jsx("span", { style: { ...styles.dot, background: dotColor(status) } }), _jsx("span", { style: styles.name, children: name })] }), _jsx("p", { style: styles.statusLine, children: statusText(t, status) }), status?.detail !== undefined && status.detail !== '' && (_jsx("p", { style: styles.statusLine, children: status.detail })), errors[id] !== undefined && _jsx("p", { style: styles.errorLine, children: errors[id] }), deviceFlowInfo[id] !== undefined && _jsxs("div", { style: styles.deviceFlowBox, children: [deviceFlowInfo[id].authorizeUrl !== undefined && deviceFlowInfo[id].authorizeUrl !== "" && _jsx("p", { style: styles.deviceFlowUrl, children: _jsxs("span", { children: [t("deviceFlowUrl"), " ", _jsx("a", { href: deviceFlowInfo[id].authorizeUrl, target: "_blank", rel: "noopener", style: { color: "inherit" }, children: deviceFlowInfo[id].authorizeUrl })] }), }), deviceFlowInfo[id].userCode !== undefined && _jsx("p", { style: styles.deviceFlowCode, children: t("deviceFlowCode", { code: deviceFlowInfo[id].userCode }) }), deviceFlowInfo[id].expiresAt !== undefined && _jsx("p", { style: styles.deviceFlowExpires, children: (() => { const remaining = Math.max(0, Math.ceil((deviceFlowInfo[id].expiresAt - Date.now()) / 60000)); return t("deviceFlowExpiresIn", { minutes: remaining }); })(), }), _jsx("button", { type: "button", style: styles.copyButton, onClick: () => { navigator.clipboard.writeText(deviceFlowInfo[id].userCode ?? "").then(() => { setDeviceFlowInfo(prev => ({ ...prev, [id]: { ...prev[id], copied: true } })); setTimeout(() => setDeviceFlowInfo(prev => ({ ...prev, [id]: { ...prev[id], copied: undefined } })), 1500); }); }, children: deviceFlowInfo[id].copied === true ? t("deviceFlowCopied") : t("deviceFlowCopyCode") }), ]), _jsxs("div", { style: styles.actions, children: [!busy && status?.loggedIn !== true && (_jsx("button", { type: "button", style: styles.button, onClick: () => { void login(id); }, children: t('login') })), busy && (_jsx("button", { type: "button", style: styles.button, onClick: () => { void cancel(id); }, children: t('cancel') })), status?.loggedIn === true && (_jsx("button", { type: "button", style: styles.button, onClick: () => { void logout(id, name); }, children: t('logout') }))] }), showUsage && (_jsxs("div", { style: styles.usage, children: [_jsxs("div", { style: styles.usageHeader, children: [_jsx("span", { style: styles.usageTitle, children: t('usageTitle') }), usage?.plan !== undefined && (_jsx("span", { style: styles.usagePlan, children: t('usagePlan', { plan: usage.plan }) })), _jsx("button", { type: "button", style: { ...styles.usageRefresh, ...usageLoading[id] === true ? { opacity: 0.5, cursor: 'default' } : {} }, disabled: usageLoading[id] === true, onClick: () => { void loadUsage(id); }, children: t('usageRefresh') })] }), usage === undefined && usageError === undefined && (_jsx("p", { style: styles.statusLine, children: t('usageLoading') })), usageError !== undefined && (_jsx("p", { style: styles.errorLine, children: t('usageError', { message: usageError }) })), usage?.windows !== undefined && usage.windows.length === 0 && (_jsx("p", { style: styles.statusLine, children: t('usageEmpty') })), (usage?.windows ?? []).map((window, index) => {
                                    const percent = Math.min(100, Math.max(0, window.usedPercent));
                                    return (_jsxs("div", { style: styles.usageRow, children: [_jsxs("div", { style: styles.usageMeta, children: [_jsx("span", { children: usageWindowLabel(t, window) }), _jsxs("span", { children: [`${String(Math.round(percent))}%`, window.resetsAt !== undefined
                                                                && ` · ${t('usageResets', { date: new Date(window.resetsAt).toLocaleString() })}`] })] }), _jsx("div", { style: styles.usageTrack, children: _jsx("div", { style: { ...styles.usageFill, width: `${String(percent)}%`, background: usageBarColor(percent) } }) })] }, index));
                                })] })), busy && (_jsxs("details", { style: styles.manual, children: [_jsx("summary", { children: t('manualSummary') }), _jsxs("div", { style: styles.manualRow, children: [_jsx("input", { style: styles.manualInput, value: manualDrafts[id], placeholder: t('manualPlaceholder'), onChange: event => setManualDrafts(prev => ({ ...prev, [id]: event.target.value })) }), _jsx("button", { type: "button", style: styles.button, onClick: () => { void submitManual(id); }, children: t('submit') })] })] }))] }, id));
            })] }));
}
