/**
 * Replicate provider: OAuth authentication for open-source models.
 * 
 * Free tier: Limited credits, pay-as-you-go
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const REPLICATE_CLIENT_ID = 'replicate';
export const REPLICATE_AUTHORIZE_URL = 'https://replicate.com/oauth/authorize';
export const REPLICATE_TOKEN_URL = 'https://api.replicate.com/v1/auth/token';
export const REPLICATE_API_URL = 'https://api.replicate.com/v1/predictions';
const REPLICATE_SCOPE = 'run:read run:write';
const REPLICATE_CALLBACK_PATH = '/callback';
const REPLICATE_CONTEXT_WINDOW = 4096;
const REPLICATE_DEFAULT_MAX_TOKENS = 2048;
export const REPLICATE_PREEMPT_MS = 5 * 60_000;
export const REPLICATE_MODALITIES = ['text'];

export const replicateFlow = {
    callbackPath: REPLICATE_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: REPLICATE_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: REPLICATE_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${REPLICATE_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class ReplicateAdapter extends LlmAdapter {
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
            { id: 'meta/llama-2-70b-chat', name: 'Llama 2 70B Chat', contextWindow: REPLICATE_CONTEXT_WINDOW, maxTokens: REPLICATE_DEFAULT_MAX_TOKENS, inputModalities: REPLICATE_MODALITIES },
            { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B Instruct', contextWindow: REPLICATE_CONTEXT_WINDOW, maxTokens: REPLICATE_DEFAULT_MAX_TOKENS, inputModalities: REPLICATE_MODALITIES },
            { id: 'bigscience/bloom', name: 'Bloom', contextWindow: REPLICATE_CONTEXT_WINDOW, maxTokens: REPLICATE_DEFAULT_MAX_TOKENS, inputModalities: REPLICATE_MODALITIES },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(REPLICATE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ version: params.model, input: { prompt: params.messages?.[params.messages.length - 1]?.content } }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'replicate');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const REPLICATE_ADAPTER_ID = 'replicate';
