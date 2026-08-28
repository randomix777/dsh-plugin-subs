import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client';
import type { SubscriptionsKey } from './locales.js';
/** Subscription provider ids, fixed by the node half's OAuth adapters. */
export type SubscriptionProvider = 'codex' | 'claude' | 'grok';
/** One provider's login state as answered by the `status` endpoint. */
export interface ProviderStatus {
    loggedIn: boolean;
    busy: boolean;
    expiresAt?: number;
    account?: string;
    detail?: string;
}
/** One rate-limit window as answered by the `usage` endpoint. */
export interface UsageWindow {
    kind: 'session' | 'weekly' | 'other';
    scope?: string;
    usedPercent: number;
    resetsAt?: number;
}
/** `usage` endpoint value: the node half owns this shape. */
export interface ProviderUsage {
    supported: boolean;
    windows?: UsageWindow[];
    plan?: string;
}
/** Injected dependencies of {@link SubscriptionsSection} (slot `inject`). */
export interface SubscriptionsSectionInjected {
    /** Generic logical-RPC caller over the Connection transport. */
    rpc: ConnectionHandle['rpc'];
    /** Section copy: translate a 'settings.subscriptions' key with `{name}` template params. */
    t: (key: SubscriptionsKey, params?: Record<string, unknown>) => string;
}
/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type SubscriptionsSectionProps = Partial<SubscriptionsSectionInjected>;
/**
 * Call one `/subscriptions-auth` endpoint and unwrap the business result.
 * Shared by the settings section and the composer Speed toggle.
 * @param rpc - Connection RPC caller.
 * @param endpoint - channel-relative endpoint.
 * @param payload - channel-owned request payload.
 * @returns the success value, cast by the caller to the endpoint's shape.
 */
export declare function callSubscriptionsAuth<T>(rpc: ConnectionHandle['rpc'], endpoint: string, payload: unknown): Promise<T>;
/**
 * The Subscriptions settings page component.
 * @param props - the slot inject face ({@link SubscriptionsSectionInjected}).
 * @returns the section body, or a notice while the RPC face is absent.
 */
export declare function SubscriptionsSection(props: SubscriptionsSectionProps): import("react").JSX.Element;
