/**
 * The `/subscriptions-auth` host RPC channel the web Settings page drives. The
 * channel is registered only when a host `connection` service exists (the web
 * profile); headless compositions load the plugin without it. All business
 * outcomes are returned as RpcResult values; handlers never throw.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { type ProviderId } from './store.js';
import type { ProviderUsage } from '../providers/common.js';
/** The RPC channel this plugin registers on the host connection. */
export declare const SUBSCRIPTIONS_AUTH_CHANNEL = "/subscriptions-auth";
/** Decoded image bytes returned by the `image` endpoint. */
export interface ImageBytesResult {
    mediaType: string;
    dataBase64: string;
}
/** Decoded video bytes returned by the `video` endpoint. */
export interface VideoBytesResult {
    mediaType: string;
    dataBase64: string;
}
/** One session's speed choice: standard routing or the fast (priority) tier. */
export type SpeedTier = 'standard' | 'fast';
/** `speed` endpoint value: the session's choice plus the visibility list. */
export interface SpeedState {
    /** The session's current speed tier (default `standard`). */
    tier: SpeedTier;
    /** Codex model ids whose catalog advertises a fast tier. */
    fastModels: string[];
}
/** Speed state the RPC handler delegates to (in-memory, per session). */
export interface SpeedController {
    /** Current speed state: the session's tier and the fast-capable codex models. */
    speed(sessionId: string): Promise<SpeedState>;
    /** Set one session's speed tier. */
    setSpeed(sessionId: string, tier: SpeedTier): Promise<void>;
}
/** Login state of one provider, as rendered by the Settings page. */
export interface ProviderStatus {
    /** Whether a session exists in the store. */
    loggedIn: boolean;
    /** Whether a login attempt is currently waiting for its code. */
    busy: boolean;
    /** Epoch milliseconds at which the stored access token expires. */
    expiresAt?: number;
    /** Account email or account id, when known. */
    account?: string;
    /** Subscription detail (plan) or the last login error. */
    detail?: string;
}
/** Provider-agnostic auth operations the RPC handler delegates to. */
export interface AuthController {
    /** Current status of one provider. */
    status(provider: ProviderId): Promise<ProviderStatus>;
    /**
     * Start a background login attempt.
     * @returns the authorize URL for the user's browser.
     * @throws when an attempt is already running for this provider.
     */
    login(provider: ProviderId): Promise<{
        authorizeUrl: string;
    }>;
    /**
     * Feed a pasted callback URL or bare code into the pending attempt.
     * @throws when no attempt is pending or the input is unusable.
     */
    manual(provider: ProviderId, input: string): Promise<void>;
    /** Abort the pending attempt; a no-op when none is pending. */
    cancel(provider: ProviderId): Promise<void>;
    /** Delete the stored session. */
    logout(provider: ProviderId): Promise<void>;
    /**
     * Current subscription usage of one provider.
     * @param signal - caller cancellation from the RPC transport.
     * @returns `{ supported: false }` when the provider has no usage endpoint.
     * @throws when logged out or the usage lookup fails.
     */
    usage(provider: ProviderId, signal: AbortSignal): Promise<ProviderUsage>;
    /**
     * Read one image attachment's bytes for inline display.
     * @param ref - the full durable reference (`readImage` verifies against it).
     * @param signal - caller cancellation from the RPC transport.
     * @returns the media type and base64-encoded bytes.
     * @throws when no attachment service is mounted or the read fails.
     */
    readImage(ref: ImageAttachmentRef, signal: AbortSignal): Promise<ImageBytesResult>;
    /**
     * Read one generated video's bytes for inline playback.
     * @param name - bare MP4 file name inside the plugin's videos directory
     *   (validated against {@link VIDEO_NAME_PATTERN}; never a path).
     * @param signal - caller cancellation from the RPC transport.
     * @returns the media type and base64-encoded bytes.
     * @throws when the file does not exist or cannot be read.
     */
    readVideo(name: string, signal: AbortSignal): Promise<VideoBytesResult>;
}
/**
 * Register the `/subscriptions-auth` RPC channel when a host connection exists.
 * @param ctx - the plugin context (headless profiles have no `connection`).
 * @param controller - the auth operations backing the endpoints.
 * @param speed - the per-session speed-tier state backing the Speed toggle.
 */
export declare function registerAuthRpc(ctx: Context, controller: AuthController, speed: SpeedController): void;
