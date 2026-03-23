$ErrorActionPreference = 'Continue'
Set-Location "c:\Users\mrare\OneDrive\Documents\Chronos-Vanguard"

$out = @()
$out += "=== Step 1: Remove old DATABASE_URL ==="
$result = cmd /c "npx vercel env rm DATABASE_URL production --yes 2>&1"
$out += $result
$out += ""

$out += "=== Step 2: Add new DATABASE_URL ==="
$newUrl = "postgresql://neondb_owner:npg_1mRrCDxHT3lU@ep-frosty-heart-amx8tu79-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require"
$result2 = $newUrl | cmd /c "npx vercel env add DATABASE_URL production 2>&1"
$out += $result2
$out += ""

$out += "=== Step 3: Deploy to Vercel production ==="
$result3 = cmd /c "npx vercel --prod --yes 2>&1"
$out += $result3
$out += ""
$out += "=== DONE ==="

$out | Set-Content "c:\Users\mrare\OneDrive\Documents\Chronos-Vanguard\vercel-deploy-result.txt"
