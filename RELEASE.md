# DSH Plugin Subscriptions - 发布指南

## 插件信息

| 属性 | 值 |
|------|-----|
| 名称 | dsh-plugin-subscriptions |
| 版本 | 1.1.2 |
| 描述 | DSH plugin with OAuth AI providers (Claude, Codex, Grok, Antigravity, OpenRouter, Agnes AI) |
| 许可证 | MIT |

## 提供商列表

### 已上线 (live)

1. **claude** - Anthropic (Claude Code 凭据导入)
2. **codex** - OpenAI (ChatGPT Plus/Pro)
3. **grok** - xAI (X Premium)
4. **antigravity** - Google (One AI Premium / Antigravity, 内嵌凭据直接 OAuth)
5. **openrouter** - OpenRouter (OAuth PKCE → API key)
6. **agnes** - Agnes AI (OAuth PKCE → access token)

### 即将推出 (coming soon)

gemini, perplexity, github-copilot, mistral, cursor, huggingface, windsurf, replicate, fal, cohere, voyage, lepton, octoai

## 发布步骤

### 1. 推送到 GitHub

```bash
cd D:\Projects\plugins\dsh-plugin-subscriptions
git push origin main
```

### 2. 创建 GitHub Release

```bash
gh release create v1.1.2 --title "v1.1.2 - Add OpenRouter & Agnes AI" --notes "See RELEASE.md for details"
```

### 3. 提交到 DSH Market

在 [DSH Market](https://dsh.ai) 提交插件:
- 仓库地址: `https://github.com/randomix777/dsh-plugin-subscriptions`
- 版本: 1.1.2
- 参考 `DSH_MARKET_RELEASE.md`

## 认证方式

- Claude: 从已有的 Claude Code 会话导入凭据(Keychain 或 `~/.claude/.credentials.json`)
- Codex / Grok: OAuth 登录(设置 → 订阅),无需 API Key
- Antigravity: OAuth 登录（内嵌公开凭据，无需配置；可选通过 `ANTIGRAVITY_CLIENT_ID` / `ANTIGRAVITY_CLIENT_SECRET` 环境变量覆盖）
- OpenRouter: OAuth PKCE 登录(设置 → 订阅),交换为 API key
- Agnes AI: OAuth 登录(设置 → 订阅),浏览器授权后手动粘贴回调 URL
