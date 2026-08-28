/**
 * Cohere provider: OAuth authentication for enterprise NLP.
 * 
 * Free tier: Yes, Pro available
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const COHERE_CLIENT_ID = 'cohere';
export const COHERE_AUTHORIZE_URL = 'https://dashboard.cohere.com/oauth/authorize';
export const COHERE_TOKEN_URL = 'https://dashboard.cohere.com/oauth/token';
export const COHERE_API_URL = 'https://api.cohere.com/v1/chat';
const COHERE_SCOPE = 'read write';
const COHERE_CALLBACK_PATH = '/callback';
const COHERE_CONTEXT_WINDOW = 128_000;
const COHERE_DEFAULT_MAX_TOKENS = 4096;
export const COHERE_PREEMPT_MS = 5 * 60_000;
export const COHERE_MODALITIES = ['text'];

export const cohereFlow = {
    callbackPath: COHERE_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: COHERE_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: COHERE_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${COHERE_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class CohereAdapter extends LlmAdapter {
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
            { id: 'command-r-plus', name: 'Command R+', contextWindow: COHERE_CONTEXT_WINDOW, maxTokens: COHERE_DEFAULT_MAX_TOKENS, inputModalities: COHERE_MODALITIES },
            { id: 'command-r', name: 'Command R', contextWindow: COHERE_CONTEXT_WINDOW, maxTokens: COHERE_DEFAULT_MAX_TOKENS, inputModalities: COHERE_MODALITIES },
            { id: 'command', name: 'Command', contextWindow: COHERE_CONTEXT_WINDOW, maxTokens: COHERE_DEFAULT_MAX_TOKENS, inputModalities: COHERE_MODALITIES },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(COHERE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'cohere');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const COHERE_ADAPTER_ID = 'cohere';
