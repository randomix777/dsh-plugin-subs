/**
 * fal.ai provider: OAuth authentication for image/video generation.
 * 
 * Free tier: Limited credits
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const FAL_CLIENT_ID = 'fal';
export const FAL_AUTHORIZE_URL = 'https://fal.ai/oauth/authorize';
export const FAL_TOKEN_URL = 'https://fal.ai/oauth/token';
export const FAL_API_URL = 'https://fal.run/fal-ai/{model}';
const FAL_SCOPE = 'run:read run:write';
const FAL_CALLBACK_PATH = '/callback';
const FAL_CONTEXT_WINDOW = 4096;
const FAL_DEFAULT_MAX_TOKENS = 2048;
export const FAL_PREEMPT_MS = 5 * 60_000;
export const FAL_MODALITIES = ['text', 'image'];

export const falFlow = {
    callbackPath: FAL_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: FAL_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: FAL_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${FAL_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class FalAdapter extends LlmAdapter {
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
            { id: 'fal-ai/flux', name: 'FLUX', contextWindow: FAL_CONTEXT_WINDOW, maxTokens: FAL_DEFAULT_MAX_TOKENS, inputModalities: FAL_MODALITIES },
            { id: 'fal-ai/stable-diffusion-v3', name: 'Stable Diffusion 3', contextWindow: FAL_CONTEXT_WINDOW, maxTokens: FAL_DEFAULT_MAX_TOKENS, inputModalities: FAL_MODALITIES },
            { id: 'fal-ai/flux-pro', name: 'FLUX Pro', contextWindow: FAL_CONTEXT_WINDOW, maxTokens: FAL_DEFAULT_MAX_TOKENS, inputModalities: FAL_MODALITIES },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = FAL_API_URL.replace('{model}', params.model);
        const response = await this.#fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ prompt: params.messages?.[params.messages.length - 1]?.content }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'fal');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const FAL_ADAPTER_ID = 'fal';
