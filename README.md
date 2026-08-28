# DSH Plugin Subscriptions

AI LLM plugin for DeepSeek Harness that signs in to consumer AI subscriptions with OAuth and exposes them as LLM providers.

## Features

- OAuth sign-in for subscription providers — no API keys
- Composer model resolution straight from your subscription
- Streaming, tool calling, and image input where the provider supports them
- Usage status shown in the Subscriptions settings section
- Built-in model catalogs per provider, overridable in config

## Providers

### Live

| Provider | Notes |
|----------|-------|
| **Claude** | Anthropic Pro/Max subscription (Claude Code credentials) |
| **Codex** | ChatGPT Plus/Pro (Codex) subscription |
| **Grok** | X Premium/Premium+ subscription |
| **Google Antigravity** | Google One AI Premium / Antigravity subscription (set `ANTIGRAVITY_CLIENT_ID` and `ANTIGRAVITY_CLIENT_SECRET` env vars) |
| **OpenRouter** | OpenRouter OAuth PKCE → API key (any provider model) |
| **Agnes AI** | AgnesCode OAuth → access token (OpenAI-compatible API) |

### Coming soon

Gemini, Perplexity AI, GitHub Copilot, Mistral AI, Cursor, Hugging Face, Windsurf, Replicate, fal.ai, Cohere, Voyage AI, Lepton AI, OctoAI.

## Installation

```bash
# In DSH settings
Plugins > Install from GitHub
# Enter the plugin repository URL
```

## Configuration

1. Open DSH Settings > Plugins > Subscriptions.
2. Press **Sign in** next to a live provider; its authorization page opens in a new tab.
3. Complete the OAuth flow (no browser? paste the callback URL or auth code).
4. Back in the composer, select the subscription model from the provider.

On headless setups the loopback callback is handled automatically; you can also paste the callback URL/authorization code directly.

For Antigravity, set these environment variables before launching DSH:
- `ANTIGRAVITY_CLIENT_ID` — your Google OAuth client ID
- `ANTIGRAVITY_CLIENT_SECRET` — your Google OAuth client secret

## License

MIT
