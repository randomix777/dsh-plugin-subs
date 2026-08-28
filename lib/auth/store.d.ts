/**
 * On-disk OAuth session store at `~/.dsh/plugins/subscriptions/auth.json`.
 *
 * The file is a JSON object keyed by provider id. Writes are atomic
 * (tmp file + rename) with mode 0600 because they carry bearer tokens.
 * Session shapes live here (not in the provider modules) because this file
 * owns the durable format.
 */
/** Provider routes this plugin can serve. */
export type ProviderId = 'codex' | 'claude' | 'grok';
/** Every provider route, in display order. */
export declare const PROVIDER_IDS: readonly ProviderId[];
/** Stored ChatGPT/Codex subscription session. */
export interface CodexSession {
    accessToken: string;
    refreshToken: string;
    /** Epoch milliseconds at which the access token expires. */
    expiresAt: number;
    /** `chatgpt_account_id` claim from the id token; sent as the `chatgpt-account-id` header. */
    accountId: string;
    idToken?: string;
    /** User email from the id token, when the token carried it. */
    emailAddress?: string;
    /** `chatgpt_plan_type` claim from the id token (e.g. `plus`, `pro`), when present. */
    planType?: string;
}
/** Stored Claude Pro/Max subscription session. */
export interface ClaudeSession {
    accessToken: string;
    refreshToken: string;
    /** Epoch milliseconds at which the access token expires. */
    expiresAt: number;
    /** Scope string the tokens were issued with; echoed on refresh. */
    scopes: string;
    emailAddress?: string;
    subscriptionType?: string;
}
/** Stored Grok (X Premium / xAI) subscription session. */
export interface GrokSession {
    accessToken: string;
    refreshToken: string;
    /** Epoch milliseconds at which the access token expires. */
    expiresAt: number;
    /** Token endpoint from OIDC discovery; retained for refreshes. */
    tokenEndpoint: string;
    scopes?: string;
    /** Display account: email, username, or subject claim from the id token. */
    account?: string;
}
/** The durable store shape: one optional session per provider. */
export interface SessionMap {
    codex?: CodexSession;
    claude?: ClaudeSession;
    grok?: GrokSession;
}
/** Any stored session, for provider-agnostic plumbing. */
export type StoredSession = CodexSession | ClaudeSession | GrokSession;
/**
 * Absolute path of the auth store file.
 * @returns `dshHomePath('plugins', 'subscriptions', 'auth.json')`.
 */
export declare function authFilePath(): string;
/**
 * Read the whole store. A missing file is an empty store; malformed JSON or a
 * malformed entry throws, because silently discarding tokens would strand the
 * user without a diagnosis.
 * @param path - store file path; defaults to {@link authFilePath}.
 * @returns the parsed session map.
 */
export declare function loadStore(path?: string): Promise<SessionMap>;
/**
 * Read one provider's session.
 * @param provider - the provider route.
 * @param path - store file path; defaults to {@link authFilePath}.
 * @returns the stored session, or `undefined` when logged out.
 */
export declare function getSession<K extends ProviderId>(provider: K, path?: string): Promise<SessionMap[K] | undefined>;
/**
 * Write one provider's session, preserving the others.
 * @param provider - the provider route.
 * @param session - the fresh session from a login or refresh.
 * @param path - store file path; defaults to {@link authFilePath}.
 */
export declare function saveSession<K extends ProviderId>(provider: K, session: NonNullable<SessionMap[K]>, path?: string): Promise<void>;
/**
 * Delete one provider's session (logout).
 * @param provider - the provider route.
 * @param path - store file path; defaults to {@link authFilePath}.
 */
export declare function deleteSession(provider: ProviderId, path?: string): Promise<void>;
