# DSH Plugin Publisher
# Usage: .\publish.ps1

param(
    [string]$GitHubUser,
    [string]$Version = "1.0.0"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DSH Plugin Publisher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 GitHub CLI
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Host "✗ 请安装 GitHub CLI: choco install gh" -ForegroundColor Red
    exit 1
}

# 检查登录
$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ 请先登录 GitHub: gh auth login" -ForegroundColor Red
    exit 1
}

Write-Host "✓ GitHub CLI 已配置" -ForegroundColor Green

# 创建仓库
$repoName = "dsh-plugin-subscriptions"
Write-Host ""
Write-Host "创建 GitHub 仓库: $repoName ..." -ForegroundColor Yellow

gh repo create $repoName --public --description "DSH plugin with 18 OAuth AI providers" --source=. --push 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ 仓库创建成功!" -ForegroundColor Green
    Write-Host "🔗 https://github.com/$GitHubUser/$repoName" -ForegroundColor Cyan
} else {
    Write-Host "✗ 仓库创建失败，可能已存在" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  下一步：发布到 DSH Market" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 访问 https://market.deepseek-harness.ai" -ForegroundColor White
Write-Host "2. 登录你的账户" -ForegroundColor White
Write-Host "3. 点击 'Publish Plugin'" -ForegroundColor White
Write-Host "4. 输入 GitHub 仓库地址" -ForegroundColor White
Write-Host "5. 填写插件信息并提交" -ForegroundColor White
