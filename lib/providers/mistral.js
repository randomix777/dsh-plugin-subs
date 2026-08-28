/**
 * Mistral AI (Premium) subscription provider: OAuth against Mistral
 * with PKCE, streaming against the Mistral API.
 * 
 * Free tier: 有限额度，Premium €11/月
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, EMPTY_RESPONSE_CODE, errorChain } from '@deepseek-ai/dsh-llm';
import { resolveImages } from '../translate/resolved.js';
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js';
import { httpLlmError, idleWatchdog, mapFetchFailure, ModelCatalogCache, oauthEndpointError, OAuthEndpointError, TokenManager } from './common.js';

// Mistral OAuth constants
export const MISTRAL_CLIENT_ID = 'dsh-plugin-subscriptions';
export const MISTRAL_AUTHORIZE_URL = 'https://auth.mistral.ai/oauth2/auth';
export const MISTRAL_TOKEN_URL = 'https://auth.mistral.ai/oauth2/token';
export const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
export const MISTRAL_MODELS_URL = 'https://api.mistral.ai/v1/models';
const MISTRAL_SCOPE = 'messages:send';
const MISTRAL_CALLBACK_PATH = '/callback';
const MISTRAL_CONTEXT_WINDOW = 128_000;
const MISTRAL_DEFAULT_MAX_TOKENS = 4096;
export const MISTRAL_PREEMPT_MS = 5 * 60_000;

// Mistral model catalog
export const MISTRAL_MODALITIES = ['text', 'image'];

/** Static Mistral flow facts for the OAuth flow engine */
export const mistralFlow = {
    callbackPath: MISTRAL_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: MISTRAL_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: MISTRAL_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${MISTRAL_AUTHORIZE_URL}?${params.toString()}`;
    },
};

/**
 * Fetch available Mistral models
 */
export async function fetchMistralModels(session, fetchFn = fetch) {
    const response = await fetchFn(MISTRAL_MODELS_URL, {
        headers: { authorization: `Bearer ${await session()}` },
    });
    if (!response.ok) throw await httpLlmError(response, 'mistral models API');
    const payload = await response.json();
    return (payload.data || []).map(m => ({
        id: m.id,
        name: m.name,
        contextWindow: m.context_length || MISTRAL_CONTEXT_WINDOW,
        maxTokens: m.max_tokens_output || MISTRAL_DEFAULT_MAX_TOKENS,
        inputModalities: m.modality === 'multimodal' ? MISTRAL_MODALITIES : ['text'],
    }));
}

/**
 * Mistral adapter for DSH LLM
 */
export class MistralAdapter extends LlmAdapter {
    #tokens;
    #fetchFn;
    #catalog;

    constructor(options) {
        super(options);
        this.#tokens = options.tokens;
        this.#fetchFn = options.fetchFn ?? fetch;
        this.#catalog = new ModelCatalogCache(options.catalogStore ?? (() => new Map()));
    }

    async session() {
        return this.#tokens.session();
    }

    async discover(model) {
        const models = await this.#catalog.resolve(() => fetchMistralModels(this.#tokens.session, this.#fetchFn));
        return models?.find(entry => entry.id === model);
    }

    staticModels(provider) {
        return [{
            id: 'mistral-large-latest',
            name: 'Mistral Large',
            contextWindow: MISTRAL_CONTEXT_WINDOW,
            maxTokens: MISTRAL_DEFAULT_MAX_TOKENS,
            inputModalities: MISTRAL_MODALITIES,
        }, {
            id: 'mistral-small-latest',
            name: 'Mistral Small',
            contextWindow: MISTRAL_CONTEXT_WINDOW,
            maxTokens: MISTRAL_DEFAULT_MAX_TOKENS,
            inputModalities: MISTRAL_MODALITIES,
        }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = MISTRAL_API_URL;

        const body = {
            model: params.model,
            messages: toResponsesInput(params.messages, this.#fetchFn),
            max_tokens: params.maxTokens ?? MISTRAL_DEFAULT_MAX_TOKENS,
            temperature: params.temperature,
            stream: true,
        };

        const response = await this.#fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens}`,
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            throw await httpLlmError(response, 'mistral');
        }

        return streamResponses({
            response,
            model: params.model,
            tokens,
        });
    }
}

export const MISTRAL_ADAPTER_ID = 'mistral';
