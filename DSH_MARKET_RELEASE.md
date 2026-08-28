# DSH Market 发布清单

## 基本信息

| 字段 | 值 |
|------|-----|
| 插件名称 | dsh-plugin-subscriptions |
| 版本 | 1.1.2 |
| 仓库地址 | https://github.com/randomix777/dsh-plugin-subscriptions |
| 描述 | DSH plugin with OAuth AI providers (Claude, Codex, Grok, Antigravity, OpenRouter, Agnes AI) |

## 提供商列表

### 已上线 (live)

- **claude** - Anthropic (Claude Code 凭据导入)
- **codex** - OpenAI (ChatGPT Plus/Pro)
- **grok** - xAI (X Premium)
- **antigravity** - Google (One AI Premium / Antigravity, 需环境变量)
- **openrouter** - OpenRouter (OAuth PKCE → API key)
- **agnes** - Agnes AI (OAuth PKCE → access token)

### 即将推出 (coming soon)

- gemini, perplexity, github-copilot, mistral, cursor, huggingface, windsurf, replicate, fal, cohere, voyage, lepton, octoai

## 安装方式

```
DSH Settings > Plugins > Install from GitHub
输入: https://github.com/randomix777/dsh-plugin-subscriptions
```

## 认证方式

- Claude: 从已有的 Claude Code 会话导入凭据(Keychain 或 `~/.claude/.credentials.json`)
- Codex / Grok / Antigravity: OAuth 登录(设置 → 订阅),无需 API Key
- OpenRouter: OAuth PKCE 登录(设置 → 订阅),交换为 API key
- Agnes AI: OAuth 登录(设置 → 订阅),浏览器授权后手动粘贴回调 URL

## 环境变量 (Antigravity)

启动 DSH 前需设置:
```bash
export ANTIGRAVITY_CLIENT_ID="your-google-oauth-client-id"
export ANTIGRAVITY_CLIENT_SECRET="your-google-oauth-client-secret"
```
