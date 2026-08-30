# DSH Plugin Subscriptions

AI LLM plugin for DeepSeek Harness that signs in to consumer AI subscriptions with OAuth and exposes them as LLM providers.

## Providers

### Live

| Provider | Subscription | Notes |
|----------|-------------|-------|
| **Claude** | Anthropic Pro/Max | Imports credentials from Claude Code automatically; run `claude` first |
| **Codex** | ChatGPT Plus/Pro | Real-time model discovery from `chatgpt.com/backend-api/codex/models` |
| **Grok** | X Premium/Premium+ | Real-time model discovery; includes `x_search`, `image_generate`, `video_generate` tools |
| **Google Antigravity** | Google One AI Premium | 静态目录（Gemini 3 Pro / 3.1 Pro / 3 Flash, Claude 4.6 Sonnet / Opus）；直接 OAuth，无需环境变量 |
| **OpenRouter** | OpenRouter account | OAuth PKCE → permanent API key; static catalog (GPT-4o, Claude Sonnet/Haiku 4.5, Gemini 2.5 Flash) |
| **Agnes AI** | AgnesCode account | OAuth PKCE → access token (reverse-engineered); static catalog (Agnes 2.5/2.0 Flash, GPT-4o, Claude Sonnet 4.5 via AgnesCode) |
| **Qwen Code** | Qwen Coding Plan | Device-flow OAuth via `chat.qwen.ai`；无需 API Key |
| **iFlytek Spark** | Spark API subscription | OAuth PKCE via `spark-api.xf-yun.com`; env vars: `SPARK_CLIENT_ID`, `SPARK_CLIENT_SECRET` |
| **Baidu ERNIE** | ERNIE Bot subscription | OAuth PKCE via `openapi.baidu.com`; env vars: `ERNIE_CLIENT_ID`, `ERNIE_CLIENT_SECRET` |

### Coming soon

Gemini, Perplexity AI, GitHub Copilot, Mistral AI, Cursor, Hugging Face, Windsurf, Replicate, fal.ai, Cohere, Voyage AI, Lepton AI, OctoAI.

## Features

- OAuth sign-in for subscription providers — no API keys required
- Composer model resolution straight from your subscription
- Streaming, tool calling, and image input where the provider supports them
- Usage status shown in the Subscriptions settings section
- Built-in model catalogs per provider, overridable in config

## Installation

```bash
# From npm (pre-built, no build step)
dsh plugin --profile web add dsh-plugin-subscriptions

# Or from GitHub source
dsh plugin --profile web add github:randomix777/dsh-plugin-subscriptions
```

## Usage

1. Launch DSH (`dsh web`) and open the printed URL.
2. Go to **Settings → Subscriptions** and press **Connect** next to a provider.
3. Complete the OAuth flow in the browser tab that opens. On headless setups, paste the callback URL or authorization code manually.
   - **Claude**: imports from existing Claude Code credentials (run `claude` once if not logged in).
    - **Antigravity**: no env vars needed, complete OAuth in browser directly; optionally override with `ANTIGRAVITY_CLIENT_ID` / `ANTIGRAVITY_CLIENT_SECRET`.
    - **Qwen Code**: device-flow OAuth via `chat.qwen.ai`; no API key or env vars required, click Connect to authenticate.
    - **Agnes AI**: after browser authorization, paste the full callback URL (or just the auth code) into the DSH UI — the `agnes://` deep link cannot be auto-captured by DSH.
4. In any chat, open the model selector (`/model`) and pick a model under the desired provider.

Untreated providers show no card in the model picker until signed in.

## Environment Variables

Antigravity and Qwen use embedded public client credentials — no setup required. Only Spark and ERNIE need env vars:

```bash
# Optional: override the built-in Antigravity OAuth client credentials
export ANTIGRAVITY_CLIENT_ID="your-custom-oauth-client-id"
export ANTIGRAVITY_CLIENT_SECRET="your-custom-oauth-client-secret"

# iFlytek Spark (register at https://console.xfyun.cn)
export SPARK_CLIENT_ID="your-spark-client-id"
export SPARK_CLIENT_SECRET="your-spark-client-secret"

# Baidu ERNIE (register at https://console.bce.baidu.com/ai/)
export ERNIE_CLIENT_ID="your-ernie-client-id"
export ERNIE_CLIENT_SECRET="your-ernie-client-secret"
```

Spark and ERNIE require you to register an OAuth app on the respective platform and set the env vars above.

## Configuration

```yaml
providers:
  - id: llm-subscriptions
    name: dsh-plugin-subscriptions
    config:
      providers: [codex, claude, grok, antigravity, openrouter, agnes, qwen, spark, ernie]  # subset allowed; all nine enabled by default
      streamIdleTimeoutMs: 300000
      models:  # override built-in catalogs
        codex:
          - { id: gpt-5.6-sol, name: GPT-5.6 Sol, contextWindow: 272000, inputModalities: [text, image] }
```

## Tools

Auto-registered when the corresponding provider is active:

- **`x_search`** (Grok) — xAI-hosted X search, returns `{ answer, citations }`
- **`image_generate`** (Codex or Grok) — calls `gpt-image-2` via Codex backend or `grok-imagine-image-2.0` via Grok; saves to `~/.dsh/plugins/subscriptions/images/`
- **`video_generate`** (Grok) — calls `grok-imagine-video-1.5` via `api.x.ai/v1/videos`; async poll, saves MP4 to `~/.dsh/plugins/subscriptions/videos/`

## Limitations

- Provider availability depends on your subscription status; unsigned-in providers are hidden
- Image generation requires an active Codex or Grok session
- `x_search` requires Grok login and an API-capable subscription tier
- OpenRouter API key is permanent (no refresh); log out and re-login to replace
- Agnes AI requires manual callback URL/code paste (no `agnes://` protocol handler in DSH)
- Chinese providers (Spark, ERNIE) require a registered OAuth app on the respective platform and env var credentials
- Qwen Code uses device-flow OAuth: enter the user code at the verification URL in any browser; the flow is cancellable and expires after `expires_in` seconds

## Project Structure

- `lib/index.js` — Main bundle (compiled output), all backend logic
- `lib/client.js` — Browser bundle, UI components
- `lib/client/*.js` — Split client source files (locales, UI components)

## License

MIT
