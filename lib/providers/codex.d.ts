/**
 * ChatGPT/Codex subscription provider: OAuth against auth.openai.com with the
 * Codex CLI client id, and streaming against the ChatGPT backend Responses
 * endpoint.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { FlowSpec } from '../auth/oauth-flow.js';
import type { CodexSession } from '../auth/store.js';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { ResponsesRequestInput } from '../translate/responses.js';
import { TokenManager } from './common.js';
import type { CatalogPersistence, DiscoveredModel, FetchFn, ModelEntry, ProviderUsage } from './common.js';
export declare const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export declare const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export declare const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export declare const CODEX_API_URL = "https://chatgpt.com/backend-api/codex/responses";
/** Refresh when the access token has less than this much life left. */
export declare const CODEX_PREEMPT_MS: number;
/**
 * Fast tier (the codex CLI's "fast mode"): the Responses `service_tier` wire
 * value for priority processing, mirroring codex-rs
 * `ServiceTier::Fast.request_value()`. The legacy catalog spelling is the
 * `additional_speed_tiers` entry "fast".
 */
export declare const CODEX_FAST_SERVICE_TIER = "priority";
/** One session's speed choice: standard routing or the fast (priority) tier. */
export type CodexSpeedTier = 'standard' | 'fast';
/** Static codex flow facts for the OAuth flow engine. */
export declare const codexFlow: FlowSpec;
/** User identity claims decoded from a codex id token. */
export interface CodexProfileClaims {
    emailAddress?: string;
    planType?: string;
}
/**
 * Decode the user-identity claims of a codex id token (pure, cheap — no
 * verification, same trust posture as {@link accountIdOf}). Claim paths
 * mirror codex-rs `login/src/token_data.rs`: the email is the top-level
 * `email` claim, falling back to `https://api.openai.com/profile`.email; the
 * plan is `https://api.openai.com/auth`.chatgpt_plan_type.
 * @param idToken - a stored or freshly issued id token, when present.
 * @returns whichever claims the token carried; empty when undecodable.
 */
export declare function codexProfileClaims(idToken: string | undefined): CodexProfileClaims;
/**
 * Exchange an authorization code for a codex session (form-encoded grant).
 * @param code - the authorization code from the callback.
 * @param verifier - the PKCE verifier minted for the attempt.
 * @param redirectUri - the attempt's redirect URI.
 * @returns the session to store.
 */
export declare function exchangeCodexCode(code: string, verifier: string, redirectUri: string): Promise<CodexSession>;
/**
 * Refresh a codex session (JSON grant — unlike the code exchange).
 * @param session - the stored session.
 * @returns the fresh session to store.
 */
export declare function refreshCodex(session: CodexSession): Promise<CodexSession>;
/**
 * Whether a codex refresh failure means the login is permanently gone.
 * @param error - the thrown refresh error.
 * @returns true when re-login is the only fix.
 */
export declare function isCodexPermanentRefreshError(error: unknown): boolean;
export declare const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
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
export declare function fetchCodexUsage(session: CodexSession, fetchFn?: FetchFn, signal?: AbortSignal): Promise<ProviderUsage>;
export declare const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
/**
 * Client version sent on the /models catalog request. The backend gates the
 * visible model list by client version: versions below ~0.101 get an empty
 * list, while current codex CLI releases get the full catalog — keep this in
 * the range of current codex CLI releases.
 */
export declare const CODEX_CLIENT_VERSION = "0.147.0";
/**
 * Fetch the live codex model catalog with the session's auth headers.
 * @param session - the stored session (used as-is; never refreshed here).
 * @param fetchFn - fetch implementation (injectable for tests).
 * @returns discovered models: hidden entries dropped, sorted by priority.
 */
export declare function fetchCodexModels(session: CodexSession, fetchFn?: FetchFn): Promise<DiscoveredModel[]>;
/** Constructor dependencies for {@link CodexAdapter}. */
export interface CodexAdapterOptions {
    models: readonly ModelEntry[];
    streamIdleTimeoutMs: number;
    tokens: TokenManager<CodexSession>;
    /** Whether to fetch the live catalog when logged in (false when config `models` overrides). */
    discovery: boolean;
    /** Warning sink for discovery failures that fall back to the static catalog. */
    onWarn?: (message: string) => void;
    /** Fetch implementation for discovery (defaults to global fetch). */
    fetchFn?: FetchFn;
    /** Resolve the attachment service per request; absent means image requests fail loudly. */
    resolveAttachments?: () => AttachmentStore | undefined;
    /** Durable catalog store seeding capability metadata across restarts. */
    catalogStore?: CatalogPersistence;
    /**
     * Per-request speed lookup (the composer Speed toggle's host half). Returns
     * whether this session's current choice sends the model on the fast tier;
     * absent means every request stays on standard routing.
     */
    speedFor?: (sessionId: string | undefined, model: string) => Promise<boolean> | boolean;
}
/**
 * The Responses request body for one generation. A fast-tier request (the
 * composer Speed toggle, the codex CLI's fast mode) carries
 * `service_tier: priority`; the tier field is omitted entirely otherwise,
 * matching the CLI (it never sends an explicit standard tier).
 */
export declare function codexRequestBody(options: GenerateOptions, resolved: ResponsesRequestInput, fast: boolean): Record<string, unknown>;
/** Codex wire adapter: one instance serves the `codex` provider route. */
export declare class CodexAdapter extends LlmAdapter {
    private readonly options;
    private readonly catalog;
    constructor(options: CodexAdapterOptions);
    /** Discovery fetcher: resolves the session through the refresh-aware path. */
    private fetchCatalog;
    providerInfo(provider: string): LlmProviderInfo;
    private staticModels;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    /**
     * The discovered entry for one model. Resolved through the cache's
     * stale-while-revalidate path so capability metadata stays stable across a
     * long conversation: a discovered-only effort (one missing from the static
     * CODEX_EFFORTS list) selected by the user must not vanish — and fail the
     * call — just because the TTL lapsed mid-turn.
     */
    private discovered;
    /** Whether the discovered catalog advertises a fast tier for this model. */
    supportsFastTier(model: string): Promise<boolean>;
    /** Ids of every discovered model with a fast tier (the Speed toggle's visibility list). */
    fastCapableModels(): Promise<string[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private request;
}
