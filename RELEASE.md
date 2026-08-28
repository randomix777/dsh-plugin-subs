# DSH Plugin Subscriptions - 发布指南

## 插件信息

| 属性 | 值 |
|------|-----|
| 名称 | dsh-plugin-subscriptions |
| 版本 | 1.0.0 |
| 描述 | DSH plugin with 18 OAuth AI providers |
| 许可证 | MIT |

## 提供商列表 (18 个)

### 免费推荐
1. gemini - Google AI Studio (60 请求/分钟)
2. openrouter - 聚合平台 (有免费模型)
3. mistral - Mistral AI (有限免费)

### 编程助手
4. claude - Anthropic (/月)
5. codex - OpenAI (/月)
6. cursor - Cursor (/月)
7. github-copilot - GitHub (/月)
8. windsurf - Codeium (Free/Pro)
9. cohere - Cohere (Free tier)

### 图像生成
10. agnes - Agnes AI (订阅制)
11. fal - fal.ai (按量计费)
12. replicate - Replicate (按量计费)
13. octoai - OctoAI (多模态)

### 搜索/推理
14. perplexity - Perplexity AI (/月)
15. grok - xAI (/月)
16. huggingface - Hugging Face (/月)
17. lepton - Lepton AI (有限免费)
18. voyage - Voyage AI (Embedding)

## 发布步骤

### 1. 推送到 GitHub

`ash
# 方法 1: GitHub CLI (推荐)
gh auth login
cd D:\Projects\plugins\dsh-plugin-subscriptions
gh repo create dsh-plugin-subscriptions --public --push

# 方法 2: 手动
git remote add origin https://github.com/YOUR_USERNAME/dsh-plugin-subscriptions.git
git branch -M main
git push -u origin main
`

### 2. 发布到 DSH Market

1. 访问 https://market.deepseek-harness.ai
2. 登录你的账户
3. 点击 "Publish Plugin"
4. 输入 GitHub 仓库地址: https://github.com/YOUR_USERNAME/dsh-plugin-subscriptions
5. 填写插件信息:
   - Name: dsh-plugin-subscriptions
   - Version: 1.0.0
   - Description: DSH plugin with 18 OAuth AI providers
6. 提交审核

### 3. 用户安装

`
DSH Settings > Plugins > Install from GitHub
输入: https://github.com/YOUR_USERNAME/dsh-plugin-subscriptions
`

## 文件结构

\\\
dsh-plugin-subscriptions/
├── lib/
│   ├── index.js          # 主入口
│   ├── client.js         # 客户端 UI
│   ├── providers/        # 18 个提供商适配器
│   │   ├── agnes.js
│   │   ├── claude.js
│   │   ├── codex.js
│   │   ├── cohere.js
│   │   ├── cursor.js
│   │   ├── fal.js
│   │   ├── gemini.js
│   │   ├── github-copilot.js
│   │   ├── grok.js
│   │   ├── huggingface.js
│   │   ├── lepton.js
│   │   ├── mistral.js
│   │   ├── octoai.js
│   │   ├── openrouter.js
│   │   ├── perplexity.js
│   │   ├── replicate.js
│   │   ├── voyage.js
│   │   └── windsurf.js
│   └── ...
├── package.json
├── README.md
└── SORTED_PROVIDERS.md
\\\

## License

MIT
