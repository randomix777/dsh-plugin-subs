/**
 * Windsurf (Codeium) provider: OAuth authentication for AI coding assistant.
 * 
 * Free tier: Yes, Pro available
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const WINDSURF_CLIENT_ID = 'windsurf';
export const WINDSURF_AUTHORIZE_URL = 'https://codeium.com/oauth/authorize';
export const WINDSURF_TOKEN_URL = 'https://codeium.com/oauth/token';
export const WINDSURF_API_URL = 'https://api.codeium.com/chat/completions';
const WINDSURF_SCOPE = 'read write';
const WINDSURF_CALLBACK_PATH = '/callback';
const WINDSURF_CONTEXT_WINDOW = 128_000;
const WINDSURF_DEFAULT_MAX_TOKENS = 4096;
export const WINDSURF_PREEMPT_MS = 5 * 60_000;
export const WINDSURF_MODALITIES = ['text'];

export const windsurfFlow = {
    callbackPath: WINDSURF_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: WINDSURF_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: WINDSURF_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${WINDSURF_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class WindsurfAdapter extends LlmAdapter {
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
        return [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: WINDSURF_CONTEXT_WINDOW, maxTokens: WINDSURF_DEFAULT_MAX_TOKENS, inputModalities: WINDSURF_MODALITIES }];
    }

    staticModels() {
        return this.fetchCatalog();
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(WINDSURF_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'windsurf');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const WINDSURF_ADAPTER_ID = 'windsurf';
