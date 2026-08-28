/**
 * Gemini (Google AI Studio) subscription provider: OAuth against Google with
 * PKCE, streaming against the Gemini API.
 * 
 * Free tier: 60 requests/minute, 1500 requests/day
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, EMPTY_RESPONSE_CODE, errorChain } from '@deepseek-ai/dsh-llm';
import { resolveImages } from '../translate/resolved.js';
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js';
import { httpLlmError, idleWatchdog, mapFetchFailure, ModelCatalogCache, oauthEndpointError, OAuthEndpointError, TokenManager } from './common.js';

// Google OAuth constants
export const GEMINI_CLIENT_ID = '689911484337-9bpinl2j2vlq0qm3kqc5f8qr5n7s0i1p.apps.googleusercontent.com';
export const GEMINI_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GEMINI_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
export const GEMINI_STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent';
export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_SCOPE = 'openid profile email https://www.googleapis.com/auth/generative-language.retriever';
const GEMINI_CALLBACK_PATH = '/callback';
const GEMINI_CONTEXT_WINDOW = 1_048_576; // 1M tokens for Gemini 2.0
const GEMINI_DEFAULT_MAX_TOKENS = 8192;
export const GEMINI_PREEMPT_MS = 5 * 60_000;

// Gemini model catalog
export const GEMINI_MODALITIES = ['text', 'image'];

/** Static Gemini flow facts for the OAuth flow engine */
export const geminiFlow = {
    callbackPath: GEMINI_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: GEMINI_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: GEMINI_SCOPE,
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state,
            nonce: Math.random().toString(36).substring(2),
        });
        return `${GEMINI_AUTHORIZE_URL}?${params.toString()}`;
    },
};

/**
 * Fetch available Gemini models from the API
 */
export async function fetchGeminiModels(session, fetchFn = fetch) {
    const response = await fetchFn(GEMINI_MODELS_URL + '?pageSize=50', {
        headers: { authorization: `Bearer ${await session()}` },
    });
    if (!response.ok) throw await httpLlmError(response, 'gemini models API');
    const payload = await response.json();
    if (!Array.isArray(payload.models)) throw new Error('gemini models API returned an invalid catalog');
    return payload.models.filter(m => m.name?.startsWith('models/')).map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name,
        contextWindow: parseInt(m.inputTokenLimit) || GEMINI_CONTEXT_WINDOW,
        maxTokens: parseInt(m.outputTokenLimit) || GEMINI_DEFAULT_MAX_TOKENS,
        inputModalities: m.supportedGenerationMethods?.includes('content.create') ? GEMINI_MODALITIES : ['text'],
    }));
}

/**
 * Gemini adapter for DSH LLM
 */
export class GeminiAdapter extends LlmAdapter {
    #tokens;
    #fetchFn;
    #catalog;
    #catalogStore;
    #onWarn;

    constructor(options) {
        super(options);
        this.#tokens = options.tokens;
        this.#fetchFn = options.fetchFn ?? fetch;
        this.#catalog = new ModelCatalogCache(options.catalogStore ?? (() => new Map()));
        this.#onWarn = options.onWarn;
    }

    async session() {
        return this.#tokens.session();
    }

    async discover(model) {
        const models = await this.#catalog.resolve(() => fetchGeminiModels(this.#tokens.session, this.#fetchFn));
        return models?.find(entry => entry.id === model);
    }

    staticModels(provider) {
        return [{
            id: 'gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            contextWindow: 1_048_576,
            maxTokens: 8192,
            inputModalities: GEMINI_MODALITIES,
        }, {
            id: 'gemini-2.0-flash-lite',
            name: 'Gemini 2.0 Flash-Lite',
            contextWindow: 1_048_576,
            maxTokens: 8192,
            inputModalities: GEMINI_MODALITIES,
        }, {
            id: 'gemini-2.0-pro-exp',
            name: 'Gemini 2.0 Pro Experimental',
            contextWindow: 1_048_576,
            maxTokens: 8192,
            inputModalities: GEMINI_MODALITIES,
        }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const model = params.model;
        const url = GEMINI_STREAM_URL.replace('{model}', model);

        const body = {
            contents: toResponsesInput(params.messages, this.#fetchFn),
            generationConfig: {
                maxOutputTokens: params.maxTokens ?? GEMINI_DEFAULT_MAX_TOKENS,
                temperature: params.temperature,
                topP: params.topP,
            },
        };

        if (params.tools?.length > 0) {
            body.tools = toResponsesTools(params.tools);
        }

        const response = await this.#fetchFn(url + '?key=' + (process.env.GEMINI_API_KEY || ''), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': tokens,
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            throw await httpLlmError(response, 'gemini');
        }

        return streamResponses({
            response,
            model,
            tokens,
            onChunk: (chunk) => {
                // Handle Gemini streaming response
            },
        });
    }
}

export const GEMINI_ADAPTER_ID = 'gemini';
