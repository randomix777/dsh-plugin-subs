/**
 * Claude Pro/Max subscription provider: OAuth against claude.ai /
 * platform.claude.com with the Claude Code client id, and streaming against
 * the Anthropic Messages API with the Claude Code identity headers.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { FlowSpec } from '../auth/oauth-flow.js';
import type { ClaudeSession } from '../auth/store.js';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { TokenManager } from './common.js';
import type { CatalogPersistence, DiscoveredModel, FetchFn, ModelEntry, ProviderUsage } from './common.js';
export declare const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export declare const CLAUDE_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
export declare const CLAUDE_TOKEN_URL = "https://claude.ai/v1/oauth/token";
export declare const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages?beta=true";
export declare const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
export declare const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models?beta=true";
/** Refresh when the access token has less than this much life left. */
export declare const CLAUDE_PREEMPT_MS: number;
/**
 * The subscription endpoint only serves requests presenting as Claude Code,
 * so these headers impersonate the CLI; the harness attribution user-agent
 * cannot be sent here (one user-agent slot, and the CLI's wins).
 */
export declare const CLAUDE_CLI_FALLBACK_VERSION = "2.1.234";
export declare function detectClaudeVersion(): string;
export declare const CLAUDE_BETA_FALLBACK: string;
/** Static claude flow facts for the OAuth flow engine. */
export declare const claudeFlow: FlowSpec;
/**
 * Exchange an authorization code for a claude session (JSON grant).
 * @param code - the authorization code from the callback.
 * @param verifier - the PKCE verifier minted for the attempt.
 * @param redirectUri - the attempt's redirect URI.
 * @param state - the attempt's state (echoed to the token endpoint).
 * @returns the session to store.
 */
export declare function exchangeClaudeCode(code: string, verifier: string, redirectUri: string, state: string): Promise<ClaudeSession>;
/**
 * Refresh a claude session (JSON grant echoing the issued scope).
 * @param session - the stored session.
 * @returns the fresh session to store.
 */
export declare function refreshClaude(session: ClaudeSession): Promise<ClaudeSession>;
/**
 * Whether a claude refresh failure means the login is permanently gone.
 * @param error - the thrown refresh error.
 * @returns true when re-login is the only fix.
 */
export declare function isClaudePermanentRefreshError(error: unknown): boolean;
export declare const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/**
 * Fetch the claude subscription usage from the OAuth usage endpoint (the
 * source of Claude Code's `/usage` screen). Newer responses carry a
 * structured `limits` array; older ones the flat `five_hour`/`seven_day*`
 * buckets — both shapes are read, the array winning when it has entries.
 * @param session - the stored session (used as-is; never refreshed here).
 * @param fetchFn - fetch implementation (injectable for tests).
 * @param signal - caller cancellation from the RPC transport.
 * @returns the mapped usage snapshot.
 */
export declare function fetchClaudeUsage(session: ClaudeSession, fetchFn?: FetchFn, signal?: AbortSignal): Promise<ProviderUsage>;
/** Fetch the live model catalog from the subscription endpoint. */
export declare function fetchClaudeModels(session: ClaudeSession, fetchFn?: FetchFn): Promise<DiscoveredModel[]>;
/** Constructor dependencies for {@link ClaudeAdapter}. */
export interface ClaudeAdapterOptions {
    models: readonly ModelEntry[];
    streamIdleTimeoutMs: number;
    tokens: TokenManager<ClaudeSession>;
    /** Whether to fetch the live catalog when logged in (false when config `models` overrides). */
    discovery: boolean;
    fetchFn?: FetchFn;
    onWarn?: (message: string) => void;
    /** Max retries on a retryable failure before giving up; matches Claude Code's own client-side retry count. Defaults to the dsh-llm default (2) when unset. */
    maxRetries?: number;
    /** Resolve the attachment service per request; absent means image requests fail loudly. */
    resolveAttachments?: () => AttachmentStore | undefined;
    /** Durable catalog store seeding capability metadata across restarts. */
    catalogStore?: CatalogPersistence;
}
/** Claude wire adapter: one instance serves the `claude` provider route. */
export declare class ClaudeAdapter extends LlmAdapter {
    private readonly options;
    private readonly catalog;
    constructor(options: ClaudeAdapterOptions);
    private fetchCatalog;
    private discovered;
    private staticModels;
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(provider: string): import("@deepseek-ai/dsh-llm").ResolvedRetryPolicy | undefined;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /**
     * `display: 'summarized'` is set explicitly on both shapes: `adaptive`-type
     * models default to `display: 'omitted'`, which returns thinking blocks with
     * an empty `thinking` field — without this override the "Think" panel would
     * always render empty even though real reasoning (and billed thinking_tokens)
     * ran.
     */
    private thinkingParam;
    private request;
}
