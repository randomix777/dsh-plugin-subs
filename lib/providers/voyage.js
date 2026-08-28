/**
 * Voyage AI provider: OAuth authentication for embedding models.
 * 
 * Free tier: Yes
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const VOYAGE_CLIENT_ID = 'voyage';
export const VOYAGE_AUTHORIZE_URL = 'https://api.voyageai.com/oauth/authorize';
export const VOYAGE_TOKEN_URL = 'https://api.voyageai.com/oauth/token';
export const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_SCOPE = 'read write';
const VOYAGE_CALLBACK_PATH = '/callback';
const VOYAGE_CONTEXT_WINDOW = 8192;
const VOYAGE_DEFAULT_MAX_TOKENS = 2048;
export const VOYAGE_PREEMPT_MS = 5 * 60_000;
export const VOYAGE_MODALITIES = ['text'];

export const voyageFlow = {
    callbackPath: VOYAGE_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: VOYAGE_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: VOYAGE_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${VOYAGE_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class VoyageAdapter extends LlmAdapter {
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
        return this.staticModels()?.find(entry => entry.id === model);
    }

    staticModels() {
        return [
            { id: 'voyage-3', name: 'Voyage 3', contextWindow: VOYAGE_CONTEXT_WINDOW, maxTokens: VOYAGE_DEFAULT_MAX_TOKENS, inputModalities: VOYAGE_MODALITIES },
            { id: 'voyage-code-3', name: 'Voyage Code 3', contextWindow: VOYAGE_CONTEXT_WINDOW, maxTokens: VOYAGE_DEFAULT_MAX_TOKENS, inputModalities: VOYAGE_MODALITIES },
            { id: 'voyage-multimodal-3', name: 'Voyage Multimodal 3', contextWindow: VOYAGE_CONTEXT_WINDOW, maxTokens: VOYAGE_DEFAULT_MAX_TOKENS, inputModalities: VOYAGE_MODALITIES },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(VOYAGE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, input: params.messages?.map(m => m.content).join('\n') }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'voyage');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const VOYAGE_ADAPTER_ID = 'voyage';
