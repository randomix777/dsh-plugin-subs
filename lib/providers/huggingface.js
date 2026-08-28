/**
 * Hugging Face provider: OAuth authentication for open-source models.
 * 
 * Free tier: Limited, Pro $9/月
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const HF_CLIENT_ID = 'dsh-plugin-subscriptions';
export const HF_AUTHORIZE_URL = 'https://huggingface.co/oauth/authorize';
export const HF_TOKEN_URL = 'https://huggingface.co/oauth/token';
export const HF_API_URL = 'https://api-inference.huggingface.co/models/{model}/v1/chat/completions';
const HF_SCOPE = 'read write';
const HF_CALLBACK_PATH = '/callback';
const HF_CONTEXT_WINDOW = 128_000;
const HF_DEFAULT_MAX_TOKENS = 4096;
export const HF_PREEMPT_MS = 5 * 60_000;
export const HF_MODALITIES = ['text'];

export const hfFlow = {
    callbackPath: HF_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: HF_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: HF_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${HF_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class HuggingFaceAdapter extends LlmAdapter {
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
        return [
            { id: 'mistralai/Mistral-7B-Instruct', name: 'Mistral 7B', contextWindow: HF_CONTEXT_WINDOW, maxTokens: HF_DEFAULT_MAX_TOKENS, inputModalities: HF_MODALITIES },
            { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextWindow: HF_CONTEXT_WINDOW, maxTokens: HF_DEFAULT_MAX_TOKENS, inputModalities: HF_MODALITIES },
            { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextWindow: HF_CONTEXT_WINDOW, maxTokens: HF_DEFAULT_MAX_TOKENS, inputModalities: HF_MODALITIES },
        ];
    }

    staticModels() {
        return this.fetchCatalog();
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = HF_API_URL.replace('{model}', params.model);
        const response = await this.#fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'huggingface');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const HF_ADAPTER_ID = 'huggingface';
