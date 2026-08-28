/**
 * Perplexity AI (Pro/Team) subscription provider: OAuth against Perplexity
 * with PKCE, streaming against the Perplexity API.
 * 
 * Free tier: Limited requests, Pro $20/month
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, EMPTY_RESPONSE_CODE, errorChain } from '@deepseek-ai/dsh-llm';
import { resolveImages } from '../translate/resolved.js';
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js';
import { httpLlmError, idleWatchdog, mapFetchFailure, ModelCatalogCache, oauthEndpointError, OAuthEndpointError, TokenManager } from './common.js';

// Perplexity OAuth constants
export const PERPLEXITY_CLIENT_ID = 'perplexity-app';
export const PERPLEXITY_AUTHORIZE_URL = 'https://auth.perplexity.com/oauth/authorize';
export const PERPLEXITY_TOKEN_URL = 'https://auth.perplexity.com/oauth/token';
export const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_SCOPE = 'read write';
const PERPLEXITY_CALLBACK_PATH = '/callback';
const PERPLEXITY_CONTEXT_WINDOW = 200_000;
const PERPLEXITY_DEFAULT_MAX_TOKENS = 8192;
export const PERPLEXITY_PREEMPT_MS = 5 * 60_000;

// Perplexity model catalog
export const PERPLEXITY_MODALITIES = ['text'];

/** Static Perplexity flow facts for the OAuth flow engine */
export const perplexityFlow = {
    callbackPath: PERPLEXITY_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: PERPLEXITY_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: PERPLEXITY_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
        });
        return `${PERPLEXITY_AUTHORIZE_URL}?${params.toString()}`;
    },
};

/**
 * Perplexity adapter for DSH LLM
 */
export class PerplexityAdapter extends LlmAdapter {
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
        const models = await this.#catalog.resolve(() => this.fetchCatalog());
        return models?.find(entry => entry.id === model);
    }

    async fetchCatalog() {
        const tokens = await this.session();
        const response = await this.#fetchFn('https://api.perplexity.ai/chat/models', {
            headers: { authorization: `Bearer ${tokens}` },
        });
        if (!response.ok) throw await httpLlmError(response, 'perplexity models API');
        const payload = await response.json();
        return (payload.data || []).map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: PERPLEXITY_CONTEXT_WINDOW,
            maxTokens: PERPLEXITY_DEFAULT_MAX_TOKENS,
            inputModalities: PERPLEXITY_MODALITIES,
        }));
    }

    staticModels(provider) {
        return [{
            id: 'sonar',
            name: 'Perplexity Sonar',
            contextWindow: PERPLEXITY_CONTEXT_WINDOW,
            maxTokens: PERPLEXITY_DEFAULT_MAX_TOKENS,
            inputModalities: PERPLEXITY_MODALITIES,
        }, {
            id: 'sonar-pro',
            name: 'Perplexity Sonar Pro',
            contextWindow: PERPLEXITY_CONTEXT_WINDOW,
            maxTokens: PERPLEXITY_DEFAULT_MAX_TOKENS,
            inputModalities: PERPLEXITY_MODALITIES,
        }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = PERPLEXITY_API_URL;

        const body = {
            model: params.model,
            messages: toResponsesInput(params.messages, this.#fetchFn),
            max_tokens: params.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
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
            throw await httpLlmError(response, 'perplexity');
        }

        return streamResponses({
            response,
            model: params.model,
            tokens,
            onChunk: (chunk) => {
                // Handle Perplexity streaming response
            },
        });
    }
}

export const PERPLEXITY_ADAPTER_ID = 'perplexity';
