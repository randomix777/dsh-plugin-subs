/**
 * Cursor AI provider: OAuth authentication for AI code editor.
 * 
 * Free tier: Limited, Pro $20/月
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const CURSOR_CLIENT_ID = 'cursor';
export const CURSOR_AUTHORIZE_URL = 'https://auth.cursor.sh/oauth/authorize';
export const CURSOR_TOKEN_URL = 'https://auth.cursor.sh/oauth/token';
export const CURSOR_API_URL = 'https://api.cursor.sh/v1/chat/completions';
const CURSOR_SCOPE = 'read write';
const CURSOR_CALLBACK_PATH = '/callback';
const CURSOR_CONTEXT_WINDOW = 128_000;
const CURSOR_DEFAULT_MAX_TOKENS = 4096;
export const CURSOR_PREEMPT_MS = 5 * 60_000;
export const CURSOR_MODALITIES = ['text'];

export const cursorFlow = {
    callbackPath: CURSOR_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: CURSOR_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: CURSOR_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${CURSOR_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class CursorAdapter extends LlmAdapter {
    #tokens;
    #fetchFn;
    #catalog;

    constructor(options) {
        super(options);
        this.#tokens = options.tokens;
        this.#fetchFn = options.fetchFn ?? fetch;
        this.#catalog = new ModelCatalogCache(options.catalogStore ?? (() => new Map()));
    }

    async session() { return this.#tokens.session(); }

    async discover(model) {
        const models = await this.#catalog.resolve(() => this.fetchCatalog());
        return models?.find(entry => entry.id === model);
    }

    async fetchCatalog() {
        return [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: CURSOR_CONTEXT_WINDOW, maxTokens: CURSOR_DEFAULT_MAX_TOKENS, inputModalities: CURSOR_MODALITIES }];
    }

    staticModels() {
        return [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: CURSOR_CONTEXT_WINDOW, maxTokens: CURSOR_DEFAULT_MAX_TOKENS, inputModalities: CURSOR_MODALITIES }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(CURSOR_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'cursor');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const CURSOR_ADAPTER_ID = 'cursor';
