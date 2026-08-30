# DSH 插件订阅

DeepSeek Harness 的 AI LLM 插件，通过 OAuth 登录订阅制 LLM 提供商并将其作为 LLM 提供商暴露。

## 功能

- 所有提供商的 OAuth 认证 — 无需 API key
- 直接从订阅解析 Composer 模型
- 支持流式、工具调用和图片输入（取决于提供商）
- 订阅用量状态显示在订阅设置中
- 每个提供商内置模型目录，可在配置中覆盖

## 提供商一览

### 已上线

| 路由 | 订阅 | 说明 |
|------|------|------|
| `claude` | Claude Pro/Max | 从 Claude Code 自动导入凭据；先运行 `claude` 登录 |
| `codex` | ChatGPT Plus/Pro | 实时获取模型列表（`chatgpt.com/backend-api/codex/models`） |
| `grok` | X Premium/Premium+ | 实时获取模型列表；含 `x_search`、`image_generate`、`video_generate` 工具 |
| `antigravity` | Google One AI Premium / Antigravity | 静态目录（Gemini 3 Pro / 3.1 Pro / 3 Flash、Claude 4.6 Sonnet / Opus）；直接 OAuth，无需环境变量 |
| `openrouter` | OpenRouter (OAuth PKCE) | 登录换取永久 API key；静态目录（GPT-4o / GPT-4o Mini / Claude Sonnet & Haiku 4.5 / Gemini 2.5 Flash） |
| `agnes` | Agnes AI (OAuth) | OAuth PKCE 换取 access token（逆向自 AgnesCode）；静态目录（Agnes 2.5/2.0 Flash、GPT-4o、Claude Sonnet 4.5 via AgnesCode） |
| `qwen` | 通义千问 Qwen Coding Plan | Device-flow OAuth via `chat.qwen.ai`；无需 API Key，点击连接即完成授权 |
| `spark` | 讯飞星火 | OAuth PKCE via `spark-api.xf-yun.com`；需设置 `SPARK_CLIENT_ID` / `SPARK_CLIENT_SECRET` |
| `ernie` | 百度文心一言 | OAuth PKCE via `openapi.baidu.com`；需设置 `ERNIE_CLIENT_ID` / `ERNIE_CLIENT_SECRET` |

### 即将推出

Gemini、Perplexity AI、GitHub Copilot、Mistral AI、Cursor、Hugging Face、Windsurf、Replicate、fal.ai、Cohere、Voyage AI、Lepton AI、OctoAI。

## 安装

```bash
# 从 npm 安装（预构建，无需编译）
dsh plugin --profile web add dsh-plugin-subscriptions

# 或从 GitHub 源码安装
dsh plugin --profile web add github:randomix777/dsh-plugin-subscriptions
```

## 使用步骤

1. `dsh web`，打开打印的 URL。
2. **设置 → 订阅**：点击对应 provider 的「连接」。
   - **Claude**：自动从 Claude Code 导入凭据（需先运行 `claude` 并登录）。
   - **Codex / Grok / OpenRouter**：在新标签页中完成 OAuth 授权。
    - **Antigravity**：无需环境变量，直接在标签页中完成授权；可选通过 `ANTIGRAVITY_CLIENT_ID` / `ANTIGRAVITY_CLIENT_SECRET` 覆盖凭据。
    - **Qwen Code**：通过 `chat.qwen.ai` Device-flow OAuth 授权；无需 API Key 或环境变量，点击「连接」即完成登录。
    - **Spark / ERNIE**：先设置环境变量，再在标签页中完成授权。
    - **Agnes AI**：浏览器授权后，手动粘贴回调 URL 或授权码（DSH 无法自动捕获 `agnes://` 协议）。
3. 在任意会话中打开模型选择器（`/model`），选择对应 provider 下的模型。

未登录时：该 provider 不出现在选择器里；直接请求会报 `MISSING_CREDENTIAL`，不影响其他功能。

## 环境变量

Antigravity 和 Qwen 使用插件内嵌的公开客户凭据，无需手动配置。仅星火和文心一言需要环境变量：

```bash
# 可选：覆盖内置的 Antigravity OAuth 客户端凭据
export ANTIGRAVITY_CLIENT_ID="your-custom-oauth-client-id"
export ANTIGRAVITY_CLIENT_SECRET="your-custom-oauth-client-secret"

# 讯飞星火（在 https://console.xfyun.cn 注册应用）
export SPARK_CLIENT_ID="your-spark-client-id"
export SPARK_CLIENT_SECRET="your-spark-client-secret"

# 百度文心一言（在 https://console.bce.baidu.com/ai/ 注册应用）
export ERNIE_CLIENT_ID="your-ernie-client-id"
export ERNIE_CLIENT_SECRET="your-ernie-client-secret"
```

星火、ERNIE 需要在对应平台注册 OAuth 应用并设置环境变量。Qwen 和 Antigravity 点击连接即可直接登录。

## 配置

```yaml
providers:
  - id: llm-subscriptions
    name: dsh-plugin-subscriptions
    config:
      providers: [codex, claude, grok, antigravity, openrouter, agnes, qwen, spark, ernie]   # 子集;默认九个全启用
      streamIdleTimeoutMs: 300000
      models:                            # 覆盖实时发现/内置目录
        codex:
          - { id: gpt-5.6-sol, name: GPT-5.6 Sol, contextWindow: 272000, inputModalities: [text, image] }
```

## 工具

随 provider 启用自动注册：

- **`x_search`**（Grok）—— xAI 托管的 X 搜索，返回 `{ answer, citations }`。
- **`image_generate`**（ChatGPT 或 Grok）—— 经 Codex 后端调用 `gpt-image-2`，或经 Grok 调用 `grok-imagine-image-2.0`。`provider` 参数指定首选提供方（默认 `gpt`，可选 `grok`）；首选方未登录时自动回退到另一方。图片保存到 `~/.dsh/plugins/subscriptions/images/`。
- **`video_generate`**（Grok）—— 调用 `grok-imagine-video-1.5`（异步提交 + 轮询）；MP4 保存到 `~/.dsh/plugins/subscriptions/videos/`，视频在对话中内联播放。

## 限制与已知问题

- 各 provider 的可用性取决于你的订阅状态；未登录时该 provider 不可用
- 图片生成依赖 `image_generate` 工具，需要 Codex 或 Grok 已登录
- X 搜索依赖 `x_search` 工具，需要 Grok 已登录且订阅包含 API 访问权限
- Antigravity 的 Google OAuth 凭据通过环境变量提供（安全考虑，未硬编码）
- OpenRouter 登录后获得永久 API key，无需刷新
- Agnes AI 的回调协议 `agnes://` 无法被 DSH 自动捕获，需手动粘贴回调 URL 或授权码
- 国内提供商（Spark / ERNIE）需在各自开放平台注册 OAuth 应用并设置环境变量
- Qwen Code 使用 Device-flow OAuth：在任何浏览器中打开验证 URL 并输入验证码；流程可取消，过期时间为 `expires_in` 秒

## 项目结构

- `lib/index.js` — 主 bundle（编译产物），所有后端逻辑
- `lib/client.js` — 浏览器 bundle，UI 组件
- `lib/client/*.js` — 拆分客户端源码（国际化、UI 组件）

## License

MIT
