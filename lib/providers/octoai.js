/**
 * OctoAI provider: OAuth authentication for open-source model inference.
 * 
 * Free tier: Yes, pay-as-you-go
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const OCTOAI_CLIENT_ID = 'octoai';
export const OCTOAI_AUTHORIZE_URL = 'https://cloud.octo.ai/oauth/authorize';
export const OCTOAI_TOKEN_URL = 'https://cloud.octo.ai/oauth/token';
export const OCTOAI_API_URL = 'https://octoai.cloud/v1/chat/completions';
const OCTOAI_SCOPE = 'read write';
const OCTOAI_CALLBACK_PATH = '/callback';
const OCTOAI_CONTEXT_WINDOW = 128_000;
const OCTOAI_DEFAULT_MAX_TOKENS = 4096;
export const OCTOAI_PREEMPT_MS = 5 * 60_000;
export const OCTOAI_MODALITIES = ['text'];

export const octoaiFlow = {
    callbackPath: OCTOAI_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: OCTOAI_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: OCTOAI_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${OCTOAI_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class OctoAIAdapter extends LlmAdapter {
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
            { id: 'llama-3.1-70b', name: 'Llama 3.1 70B', contextWindow: OCTOAI_CONTEXT_WINDOW, maxTokens: OCTOAI_DEFAULT_MAX_TOKENS, inputModalities: OCTOAI_MODALITIES },
            { id: 'llava-1.5', name: 'LLaVA 1.5', contextWindow: OCTOAI_CONTEXT_WINDOW, maxTokens: OCTOAI_DEFAULT_MAX_TOKENS, inputModalities: ['text', 'image'] },
            { id: 'stable-diffusion-xl', name: 'Stable Diffusion XL', contextWindow: OCTOAI_CONTEXT_WINDOW, maxTokens: OCTOAI_DEFAULT_MAX_TOKENS, inputModalities: ['text', 'image'] },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const response = await this.#fetchFn(OCTOAI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'octoai');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const OCTOAI_ADAPTER_ID = 'octoai';
