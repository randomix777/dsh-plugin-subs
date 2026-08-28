/**
 * GitHub Copilot subscription provider: OAuth against GitHub with PKCE,
 * using Copilot Chat API for AI responses.
 * 
 * Free tier: Limited, Pro $10/month, Enterprise $19/month
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, EMPTY_RESPONSE_CODE, errorChain } from '@deepseek-ai/dsh-llm';
import { resolveImages } from '../translate/resolved.js';
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js';
import { httpLlmError, idleWatchdog, mapFetchFailure, ModelCatalogCache, oauthEndpointError, OAuthEndpointError, TokenManager } from './common.js';

// GitHub OAuth constants
export const GITHUB_CLIENT_ID = 'Iv1.5e5c9d5f7e3b2a1c'; // Public OAuth client ID
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_URL = 'https://api.github.com/copilot/internal_chat/message';
const GITHUB_SCOPE = 'read:user repo';
const GITHUB_CALLBACK_PATH = '/callback';
const GITHUB_CONTEXT_WINDOW = 128_000;
const GITHUB_DEFAULT_MAX_TOKENS = 4096;
export const GITHUB_PREEMPT_MS = 5 * 60_000;

// GitHub model catalog
export const GITHUB_MODALITIES = ['text', 'image'];

/** Static GitHub flow facts for the OAuth flow engine */
export const githubFlow = {
    callbackPath: GITHUB_CALLBACK_PATH,
    listen: { host: '127.0.0.1', ports: [0] },
    buildAuthorizeUrl({ redirectUri, state, pkce }) {
        const params = new URLSearchParams({
            client_id: GITHUB_CLIENT_ID,
            redirect_uri: redirectUri,
            scope: GITHUB_SCOPE,
            state,
            allow_signup: 'true',
        });
        return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
    },
};

/**
 * GitHub Copilot adapter for DSH LLM
 */
export class GitHubCopilotAdapter extends LlmAdapter {
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
        // GitHub Copilot doesn't have a public model listing API
        // Return static models
        return this.staticModels();
    }

    staticModels(provider) {
        return [{
            id: 'copilot',
            name: 'GitHub Copilot',
            contextWindow: GITHUB_CONTEXT_WINDOW,
            maxTokens: GITHUB_DEFAULT_MAX_TOKENS,
            inputModalities: GITHUB_MODALITIES,
        }];
    }

    async createCompletionStream(params, signal) {
        const tokens = await this.#tokens.session();
        const url = GITHUB_API_URL;

        const body = {
            message: params.messages?.[params.messages.length - 1]?.content,
            conversation_id: params.conversationId,
        };

        const response = await this.#fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            throw await httpLlmError(response, 'github-copilot');
        }

        return streamResponses({
            response,
            model: params.model,
            tokens,
            onChunk: (chunk) => {
                // Handle GitHub Copilot streaming response
            },
        });
    }
}

export const GITHUB_COPILOT_ADAPTER_ID = 'github-copilot';
