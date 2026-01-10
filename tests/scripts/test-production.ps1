# Production Deployment Test Script
# Tests ZkVanguard deployment on Vercel

Write-Host "`n=== ZkVanguard Production Test ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "https://zkvanguard.vercel.app"
$allPassed = $true

# Test 1: Health Check
Write-Host "Test 1: API Health Check..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat/health" -UseBasicParsing
    $health = $response.Content | ConvertFrom-Json
    
    if ($health.status -eq "operational" -and $health.llmAvailable -eq $true) {
        Write-Host "  ✅ PASSED - API is operational" -ForegroundColor Green
        Write-Host "     Provider: $($health.provider)" -ForegroundColor Gray
        Write-Host "     Features: streaming=$($health.features.streaming), multiAgent=$($health.features.multiAgent)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ FAILED - API not operational" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    $allPassed = $false
}

# Test 2: Agents Status
Write-Host "`nTest 2: Agents System Status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/agents/status" -UseBasicParsing
    $status = $response.Content | ConvertFrom-Json
    
    $aiEnabled = $status.integrations.cryptocomAI.enabled
    $fallbackMode = $status.integrations.cryptocomAI.fallbackMode
    
    if ($aiEnabled -and -not $fallbackMode) {
        Write-Host "  ✅ PASSED - Crypto.com AI SDK enabled (NOT in fallback mode)" -ForegroundColor Green
        Write-Host "     No more 'fallback LLM' warnings!" -ForegroundColor Gray
    } elseif ($aiEnabled -and $fallbackMode) {
        Write-Host "  ⚠️  WARNING - AI enabled but in fallback mode" -ForegroundColor Yellow
        Write-Host "     API key might be invalid or SDK not available" -ForegroundColor Gray
        $allPassed = $false
    } else {
        Write-Host "  ❌ FAILED - AI SDK not enabled" -ForegroundColor Red
        $allPassed = $false
    }
    
    Write-Host "     Other integrations:" -ForegroundColor Gray
    Write-Host "       x402: $($status.integrations.x402.enabled)" -ForegroundColor Gray
    Write-Host "       Moonlander: $($status.integrations.moonlander.enabled)" -ForegroundColor Gray
    
} catch {
    Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    $allPassed = $false
}

# Test 3: Chat API
Write-Host "`nTest 3: Chat API Request..." -ForegroundColor Yellow
try {
    $body = @{ 
        message = "What is the current portfolio status?"
        conversationId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')" 
    } | ConvertTo-Json
    
    $headers = @{ "Content-Type" = "application/json" }
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -Headers $headers -UseBasicParsing -TimeoutSec 30
    
    if ($response.StatusCode -eq 200) {
        $chatResponse = $response.Content | ConvertFrom-Json
        Write-Host "  ✅ PASSED - Chat API responding" -ForegroundColor Green
        Write-Host "     Success: $($chatResponse.success)" -ForegroundColor Gray
        Write-Host "     Using Real AI: $($chatResponse.metadata.isRealAI)" -ForegroundColor Gray
        Write-Host "     Model: $($chatResponse.metadata.model)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ FAILED - Unexpected status code: $($response.StatusCode)" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    $allPassed = $false
}

# Test 4: Environment Variables
Write-Host "`nTest 4: Vercel Environment Variables..." -ForegroundColor Yellow
try {
    $envList = npx vercel env ls 2>&1
    if ($envList -match "CRYPTOCOM_DEVELOPER_API_KEY") {
        Write-Host "  ✅ PASSED - CRYPTOCOM_DEVELOPER_API_KEY is set in Vercel" -ForegroundColor Green
        
        # Count environments
        $prodCount = ($envList | Select-String "CRYPTOCOM_DEVELOPER_API_KEY.*Production").Count
        $previewCount = ($envList | Select-String "CRYPTOCOM_DEVELOPER_API_KEY.*Preview").Count
        $devCount = ($envList | Select-String "CRYPTOCOM_DEVELOPER_API_KEY.*Development").Count
        
        Write-Host "     Production: $(if($prodCount -gt 0){'✓'}else{'✗'})" -ForegroundColor Gray
        Write-Host "     Preview: $(if($previewCount -gt 0){'✓'}else{'✗'})" -ForegroundColor Gray
        Write-Host "     Development: $(if($devCount -gt 0){'✓'}else{'✗'})" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ FAILED - CRYPTOCOM_DEVELOPER_API_KEY not found" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    $allPassed = $false
}

# Test 5: Homepage Load
Write-Host "`nTest 5: Homepage Load..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ PASSED - Homepage loads successfully" -ForegroundColor Green
        Write-Host "     Status: $($response.StatusCode)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️  WARNING - Unexpected status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    $allPassed = $false
}

# Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "✅ ALL TESTS PASSED!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your deployment is fully operational:" -ForegroundColor White
    Write-Host "  • API health check: OK" -ForegroundColor White
    Write-Host "  • Crypto.com AI SDK: Active (no fallback mode)" -ForegroundColor White
    Write-Host "  • Chat API: Working" -ForegroundColor White
    Write-Host "  • Environment variables: Configured" -ForegroundColor White
    Write-Host "  • Homepage: Loading" -ForegroundColor White
    Write-Host ""
    Write-Host "🎉 No more 'fallback LLM' warnings!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Visit: $baseUrl" -ForegroundColor Cyan
} else {
    Write-Host "⚠️  SOME TESTS FAILED" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Review the failures above and:" -ForegroundColor White
    Write-Host "  1. Check Vercel deployment logs: npx vercel logs" -ForegroundColor White
    Write-Host "  2. Verify API key is valid at crypto.com/developers" -ForegroundColor White
    Write-Host "  3. Redeploy if needed: npx vercel --prod" -ForegroundColor White
}

Write-Host ""
