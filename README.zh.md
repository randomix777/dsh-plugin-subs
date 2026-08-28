# DSH 插件订阅

DeepSeek Harness 的 AI LLM 插件，通过 OAuth 登录消费级 AI 订阅并将其作为 LLM 提供商暴露。

## 功能

- 所有提供商的 OAuth 认证 — 无需 API key
- 直接从订阅解析 Composer 模型
- 支持流式、工具调用和图片输入（取决于提供商）
- 订阅用量状态显示在订阅设置中
- 每个提供商内置模型目录，可在配置中覆盖

## 提供商一览

| 路由     | 订阅             | 模型 |
|----------|------------------|------|
| `codex`  | ChatGPT Plus/Pro | 从 `chatgpt.com/backend-api/codex/models` 实时获取 |
| `claude` | Claude Pro/Max   | 订阅内所有可用模型(Opus、Sonnet、Haiku、Fable —— 静态目录,随插件更新) |
| `grok`   | X Premium (xAI)  | 从 `api.x.ai/v1/models` 实时获取(仅对话模型);推理等级来自 Grok CLI 目录(`cli-chat-proxy.grok.com/v1/models`) |
| `antigravity` | Google One AI Premium / Antigravity | 静态目录:Gemini 3 Pro / 3.1 Pro / 3 Flash,以及 Claude 4.6 Sonnet / 4.6 Opus(经 Antigravity 后端);需设置 `ANTIGRAVITY_CLIENT_ID` 和 `ANTIGRAVITY_CLIENT_SECRET` 环境变量 |
| `openrouter` | OpenRouter (OAuth PKCE) | 静态目录:GPT-4o / GPT-4o Mini / Claude Sonnet 4.5 / Claude Haiku 4.5 / Gemini 2.5 Flash;通过 OpenRouter 的 OAuth PKCE 登录交换为用户控制的 API key |
| `agnes` | Agnes AI (OAuth) | 静态目录:Agnes 2.5 Flash / 2.0 Flash,以及 GPT-4o / Claude Sonnet 4.5(经 AgnesCode OAuth);浏览器授权后手动粘贴回调 URL |

只有已登录的 provider 才会出现在会话模型选择器里;登录/退出后列表自动刷新。支持视觉的模型会声明 `['text', 'image']` 输入模态,图片内容会被翻译成各 provider 的 wire 格式。

已登录的卡片还会显示**订阅用量**——按限额窗口(5 小时会话窗、每周窗,以及计划包含的按模型每周窗)展示已用百分比、进度条和重置时间,并带刷新按钮。Codex 用量来自 `chatgpt.com/backend-api/wham/usage`(同时报告计划类型),Claude 用量来自 `api.anthropic.com/api/oauth/usage`,Grok 用量来自 Grok Build CLI 代理的 `cli-chat-proxy.grok.com/v1/billing`(即 CLI `/usage` 面板的数据源,报告共享每周额度和订阅档位)。

随 provider 启用自动注册的工具:

- **`x_search`**(Grok)—— xAI 托管的 X 搜索,返回 `{ answer, citations }`。
- **`image_generate`**(ChatGPT 或 Grok)—— 经 Codex 后端调用 `gpt-image-2`,或经 `api.x.ai/v1/images/generations` 调用 `grok-imagine-image-2.0`。`provider` 参数指定首选提供方(`gpt` 为默认值,可选 `grok`);首选方未登录时自动回退到另一方。图片保存到 `~/.dsh/plugins/subscriptions/images/` 并返回路径。Grok 路径上 `size`/`quality` 参数会映射为 Grok 的 `aspect_ratio`/`quality`。
- **`video_generate`**(Grok)—— 经 `api.x.ai/v1/videos` 调用 `grok-imagine-video-1.5`(异步提交 + 轮询);MP4 保存到 `~/.dsh/plugins/subscriptions/videos/` 并返回路径,视频直接在对话里内联播放。支持时长(1–15 秒)、宽高比、分辨率,以及通过 `image_url` 做图生视频。

## 安装

本机已有 `dsh` CLI 时,从 npm 安装(预构建产物,无需构建授权):

```sh
dsh plugin --profile web add dsh-plugin-subscriptions
```

也可以从 GitHub 安装源码:

```sh
dsh plugin --profile web add github:randomix777/dsh-plugin-subscriptions
```

## 使用步骤

1. `dsh web`,打开打印的 URL。
2. **设置 → 订阅**:点对应 provider 的「连接」。Claude 会即时从 Claude Code 导入凭据(需先运行过 `claude` 并登录)。Codex、Grok 在打开的标签页里授权;Antigravity 需先设置 `ANTIGRAVITY_CLIENT_ID` 和 `ANTIGRAVITY_CLIENT_SECRET` 环境变量后在标签页中授权;OpenRouter 和 Agnes AI 同样在标签页中授权;无浏览器环境下可展开手动兜底,粘贴回调 URL 或授权码。
3. 在任意会话里打开模型选择器(`/model`),选择 **ChatGPT (Codex)** / **Claude (Subscription)** / **Grok (Subscription)** / **Google Antigravity** / **OpenRouter (Subscription)** / **Agnes AI (Subscription)** 下的模型。

未登录时:该 provider 不出现在选择器里;直接请求会报 `MISSING_CREDENTIAL` 并提示去设置页登录,不影响其他功能。

## 配置

```yaml
providers:
  - id: llm-subscriptions
    name: dsh-plugin-subscriptions
    config:
      providers: [codex, claude, grok, antigravity, openrouter, agnes]   # 子集;默认六个全启用
      streamIdleTimeoutMs: 300000
      models:                            # 覆盖实时发现/内置目录
        codex:
          - { id: gpt-5.6-sol, name: GPT-5.6 Sol, contextWindow: 272000, inputModalities: [text, image] }
```

### Antigravity 环境变量

启动 DSH 前需设置:
```bash
export ANTIGRAVITY_CLIENT_ID="your-google-oauth-client-id"
export ANTIGRAVITY_CLIENT_SECRET="your-google-oauth-client-secret"
```

## 限制与已知问题

- 各 provider 的可用性取决于你的订阅状态;未登录时该 provider 不可用
- 图片生成依赖 `image_generate` 工具,需要 Codex 或 Grok 已登录
- X 搜索依赖 `x_search` 工具,需要 Grok 已登录且订阅包含 API 访问权限
- Antigravity 的 Google OAuth 凭据需要通过环境变量提供(出于安全考虑未硬编码)
- OpenRouter 登录后获得永久 API key,无需刷新
- Agnes AI 的回调协议 `agnes://` 无法被 DSH 自动捕获,需手动粘贴回调 URL 或授权码

## 项目结构

- `lib/index.js` — 主 bundle(编译产物),所有后端逻辑
- `lib/client.js` — 浏览器 bundle,UI 组件
- `lib/providers/` — 各 provider 的子模块(仅供参考,实际代码在 bundle 中)
- `src/providers/` -- 各 provider 的 OAuth 流程/交换/适配器 + `LlmAdapter` 实现

## License

MIT
