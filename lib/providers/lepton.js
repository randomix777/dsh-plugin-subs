/**
 * Lepton AI provider: OAuth authentication for open-source model hosting.
 * 
 * Free tier: Yes
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { streamResponses, toResponsesInput } from '../translate/responses.js';
import { httpLlmError, ModelCatalogCache } from './common.js';

export const LEPTON_CLIENT_ID = 'lepton';
export const LEPTON_AUTHORIZE_URL = 'https://www.lepton.ai/oauth/authorize';
export const LEPTON_TOKEN_URL = 'https://www.lepton.ai/oauth/token';
export const LEPTON_API_URL = 'https://{{{model}}}.lepton.run/api/v1/chat/completions';
const LEPTON_SCOPE = 'read write';
const LEPTON_CALLBACK_PATH = '/callback';
const LEPTON_CONTEXT_WINDOW = 128_000;
const LEPTON_DEFAULT_MAX_TOKENS = 4096;
export const LEPTON_PREEMPT_MS = 5 * 60_000;
export const LEPTON_MODALITIES = ['text'];

export const leptonFlow = {
    callbackPath: LEPTON_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: LEPTON_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: LEPTON_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${LEPTON_AUTHORIZE_URL}?${params.toString()}`;
    },
};

export class LeptonAdapter extends LlmAdapter {
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
            { id: 'llama-3.1-70b', name: 'Llama 3.1 70B', contextWindow: LEPTON_CONTEXT_WINDOW, maxTokens: LEPTON_DEFAULT_MAX_TOKENS, inputModalities: LEPTON_MODALITIES },
            { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', contextWindow: LEPTON_CONTEXT_WINDOW, maxTokens: LEPTON_DEFAULT_MAX_TOKENS, inputModalities: LEPTON_MODALITIES },
            { id: 'mixtral-8x7b', name: 'Mixtral 8x7B', contextWindow: LEPTON_CONTEXT_WINDOW, maxTokens: LEPTON_DEFAULT_MAX_TOKENS, inputModalities: LEPTON_MODALITIES },
        ];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = LEPTON_API_URL.replace('{{{model}}}', params.model);
        const response = await this.#fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens}` },
            body: JSON.stringify({ model: params.model, messages: toResponsesInput(params.messages, this.#fetchFn), stream: true }),
            signal,
        });
        if (!response.ok) throw await httpLlmError(response, 'lepton');
        return streamResponses({ response, model: params.model, tokens });
    }
}

export const LEPTON_ADAPTER_ID = 'lepton';
