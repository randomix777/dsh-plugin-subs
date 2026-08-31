# dsh-plugin-subs 优化指南

## 当前状态

- **版本**: 1.1.2
- **功能**: 将 ChatGPT/Claude/Grok/Google Antigravity/OpenRouter/Agnes AI 订阅转换为 DSH LLM 提供商
- **代码量**: ~5000+ 行

## 支持的提供商

| 提供商 | 订阅类型 | 功能 |
|--------|----------|------|
| Claude Code | Claude Pro/Max | 文本生成、代码补全 |
| Codex | ChatGPT Plus/Pro | 文本、图像生成 |
| Grok | X Premium/Premium+ | 文本、图像生成、搜索 |
| Antigravity | Google One AI Premium | 文本、图像生成 (需环境变量) |
| OpenRouter | OAuth PKCE → API key | 文本生成(多模型路由) |
| Agnes AI | OAuth PKCE → access token | 文本、图像生成(多模型路由) |

## 潜在优化方向

### 1. 功能增强
- [ ] 添加更多 AI 服务订阅（如 Perplexity、Cursor 等）
- [ ] 支持自定义 API 端点
- [ ] 添加代理/VPN 支持
- [ ] 多账户管理

### 2. 性能优化
- [ ] Token 缓存优化
- [ ] 批量请求处理
- [ ] 连接池管理
- [ ] 错误重试策略改进

### 3. 用户体验
- [ ] 改进错误提示
- [ ] 添加使用教程
- [ ] 多语言支持

## 快速开始

1. 安装依赖: `pnpm install`
2. 配置: 插件的 `config`(`providers` 子集、`models` 覆盖、`streamIdleTimeoutMs`)
3. 测试: `pnpm test`
4. 打包: `pnpm build`
5. 部署: `dsh plugin --profile web add dsh-plugin-subs`

## 修改建议

请告诉我您想优化哪个方面：
1. 添加新的 AI 服务支持
2. 改进 UI/UX
3. 优化性能
4. 增强稳定性
5. 其他自定义需求
