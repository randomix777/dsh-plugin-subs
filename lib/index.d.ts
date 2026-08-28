/**
 * dsh-plugin-subscriptions: register OAuth-subscription LLM providers
 * (ChatGPT/Codex, Claude, Grok) on `ctx.llm`, and expose the `/subscriptions-auth`
 * RPC channel the web Settings page uses to run the logins. The token store
 * lives at `~/.dsh/plugins/subscriptions/auth.json`; the channel registers only when
 * a host `connection` service exists, so headless compositions load fine.
 * @module dsh-plugin-subscriptions
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ProviderId } from './auth/store.js';
import type { ModelEntry } from './providers/common.js';
export type { ModelEntry, ProviderUsage, UsageWindow } from './providers/common.js';
export type { ProviderStatus } from './auth/rpc.js';
export type { ClaudeSession, CodexSession, GrokSession, ProviderId } from './auth/store.js';
export declare const name = "dsh-plugin-subscriptions";
export declare const inject: string[];
/** Default maximum provider idle time while one stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /** Provider routes to register; defaults to all three. */
    providers?: ProviderId[];
    /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /** Advisory model catalogs overriding the built-in defaults, per provider. */
    models?: {
        codex?: ModelEntry[];
        claude?: ModelEntry[];
        grok?: ModelEntry[];
    };
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
