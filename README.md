# DSH Plugin Subscriptions

AI LLM Plugin for DeepSeek Harness with 18 OAuth providers.

## Features

- OAuth authentication for all providers
- No API keys required
- Streaming support
- Multi-modal support

## Providers (18)

### Free Tier
1. **Gemini** (Google) - 60 requests/min
2. **OpenRouter** - Free models available
3. **Mistral AI** - Limited free tier

### Paid Subscriptions
4. **Claude** (Anthropic) - /month
5. **Codex** (OpenAI) - /month
6. **Grok** (xAI) - /month
7. **GitHub Copilot** - /month
8. **Perplexity AI** - /month
9. **Cursor** - /month
10. **Hugging Face** - /month

### Image Generation
11. **Agnes AI** - Artistic images
12. **fal.ai** - Fast generation
13. **Replicate** - Open source models
14. **OctoAI** - Multi-modal

### Other
15. **Cohere** - Enterprise NLP
16. **Lepton AI** - Model hosting
17. **Voyage AI** - Embeddings
18. **Windsurf** (Codeium) - AI coding

## Installation

`ash
# In DSH settings
Plugins > Install from GitHub
# Enter: https://github.com/USER/dsh-plugin-subscriptions
`

## Configuration

All providers use OAuth. No API keys needed.

1. Go to DSH Settings > Plugins > LLM Subscriptions
2. Select your providers
3. Click "Sign in with Google/GitHub/etc."
4. Complete OAuth flow

## License

MIT
