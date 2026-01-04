# Vercel Environment Variables Setup Script
# This script helps you add environment variables to Vercel

Write-Host "=== Vercel Environment Variables Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if logged in
$whoami = npx vercel whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not logged in to Vercel. Run: npx vercel login" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Logged in as: $whoami" -ForegroundColor Green
Write-Host ""

# Add CRYPTOCOM_DEVELOPER_API_KEY
Write-Host "Adding CRYPTOCOM_DEVELOPER_API_KEY..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Please paste your Crypto.com Developer API key when prompted" -ForegroundColor Cyan
Write-Host "(Get it from: https://crypto.com/developers)" -ForegroundColor Gray
Write-Host ""

# Add to all environments
npx vercel env add CRYPTOCOM_DEVELOPER_API_KEY production preview development

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Verify: npx vercel env ls" -ForegroundColor White
Write-Host "2. Deploy: npx vercel --prod" -ForegroundColor White
Write-Host ""
