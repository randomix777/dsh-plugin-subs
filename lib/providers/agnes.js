/**
 * Agnes AI provider: OAuth authentication for high-quality artistic image generation.
 * 
 * Free tier: Limited, Subscription required
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, EMPTY_RESPONSE_CODE, errorChain } from '@deepseek-ai/dsh-llm';
import { resolveImages } from '../translate/resolved.js';
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js';
import { httpLlmError, idleWatchdog, mapFetchFailure, ModelCatalogCache, oauthEndpointError, OAuthEndpointError, TokenManager } from './common.js';

// Agnes AI OAuth constants
export const AGNES_CLIENT_ID = 'dsh-plugin-subscriptions';
export const AGNES_AUTHORIZE_URL = 'https://apihub.agnes-ai.com/oauth/authorize';
export const AGNES_TOKEN_URL = 'https://apihub.agnes-ai.com/oauth/token';
export const AGNES_API_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
export const AGNES_MODELS_URL = 'https://apihub.agnes-ai.com/v1/models';
const AGNES_SCOPE = 'read write';
const AGNES_CALLBACK_PATH = '/callback';
const AGNES_CONTEXT_WINDOW = 128_000;
const AGNES_DEFAULT_MAX_TOKENS = 4096;
export const AGNES_PREEMPT_MS = 5 * 60_000;

// Agnes model catalog
export const AGNES_MODALITIES = ['text', 'image'];

/** Static Agnes flow facts for the OAuth flow engine */
export const agnesFlow = {
    callbackPath: AGNES_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: AGNES_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: AGNES_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${AGNES_AUTHORIZE_URL}?${params.toString()}`;
    },
};

/**
 * Fetch available Agnes models
 */
export async function fetchAgnesModels(session, fetchFn = fetch) {
    const response = await fetchFn(AGNES_MODELS_URL, {
        headers: { authorization: `Bearer ${await session()}` },
    });
    if (!response.ok) throw await httpLlmError(response, 'agnes models API');
    const payload = await response.json();
    return (payload.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextWindow: AGNES_CONTEXT_WINDOW,
        maxTokens: AGNES_DEFAULT_MAX_TOKENS,
        inputModalities: AGNES_MODALITIES,
    }));
}

/**
 * Agnes AI adapter for DSH LLM
 */
export class AgnesAdapter extends LlmAdapter {
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
        const models = await this.#catalog.resolve(() => fetchAgnesModels(this.#tokens.session, this.#fetchFn));
        return models?.find(entry => entry.id === model);
    }

    staticModels(provider) {
        return [{
            id: 'agnes-image-2.1-flash',
            name: 'Agnes Image 2.1 Flash',
            contextWindow: AGNES_CONTEXT_WINDOW,
            maxTokens: AGNES_DEFAULT_MAX_TOKENS,
            inputModalities: AGNES_MODALITIES,
        }, {
            id: 'agnes-image-2.0',
            name: 'Agnes Image 2.0',
            contextWindow: AGNES_CONTEXT_WINDOW,
            maxTokens: AGNES_DEFAULT_MAX_TOKENS,
            inputModalities: AGNES_MODALITIES,
        }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = AGNES_API_URL;

        const body = {
            model: params.model,
            messages: toResponsesInput(params.messages, this.#fetchFn),
            max_tokens: params.maxTokens ?? AGNES_DEFAULT_MAX_TOKENS,
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
            throw await httpLlmError(response, 'agnes');
        }

        return streamResponses({
            response,
            model: params.model,
            tokens,
        });
    }
}

export const AGNES_ADAPTER_ID = 'agnes';
