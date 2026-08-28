/**
 * OpenRouter provider: OAuth authentication for aggregated AI models.
 * 
 * Free tier: Yes (free models available)
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const OPENROUTER_CLIENT_ID = 'dsh-plugin-subscriptions';
export const OPENROUTER_AUTHORIZE_URL = 'https://openrouter.ai/oauth/authorize';
export const OPENROUTER_TOKEN_URL = 'https://openrouter.ai/oauth/token';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_SCOPE = 'read write';
const OPENROUTER_CALLBACK_PATH = '/callback';
const OPENROUTER_CONTEXT_WINDOW = 128_000;
const OPENROUTER_DEFAULT_MAX_TOKENS = 4096;
export const OPENROUTER_PREEMPT_MS = 5 * 60_000;
export const OPENROUTER_MODALITIES = ['text'];

export const openrouterFlow = {
    callbackPath: OPENROUTER_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: OPENROUTER_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: OPENROUTER_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${OPENROUTER_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export async function fetchOpenRouterModels(session, fetchFn = fetch) {
    const response = await fetchFn(OPENROUTER_MODELS_URL, {
        headers: { authorization: `Bearer ${await session()}` },
    });
    if (!response.ok) throw await httpLlmError(response, 'openrouter models API');
    const payload = await response.json();
    return (payload.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextWindow: m.context_length || OPENROUTER_CONTEXT_WINDOW,
        maxTokens: m.max_tokens || OPENROUTER_DEFAULT_MAX_TOKENS,
        inputModalities: m.pricing?.prompt === "0" ? ['text'] : ['text'],
        free: m.pricing?.prompt === "0",
    }));
}

export class OpenRouterAdapter extends LlmAdapter {
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
        const models = await this.#catalog.resolve(() => fetchOpenRouterModels(this.#tokens.session, this.#fetchFn));
        return models?.find(entry => entry.id === model);
    }

    staticModels() {
        return [
            { id: 'free/phi-3-mini', name: 'Phi-3 Mini (Free)', contextWindow: 4096, maxTokens: 4096, inputModalities: ['text'] },
            { id: 'free/gemma-3-4b', name: 'Gemma 3 4B (Free)', contextWindow: 8192, maxTokens: 4096, inputModalities: ['text'] },
            { id: 'free/qwen-2.5-7b', name: 'Qwen 2.5 7B (Free)', contextWindow: 32768, maxTokens: 4096, inputModalities: ['text'] },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(OPENROUTER_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'openrouter');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const OPENROUTER_ADAPTER_ID = 'openrouter';
