# Advanced Chat API Test - Stress Testing the AI
# Tests complex scenarios to verify AI quality

Write-Host "`n=== Advanced Chat API Stress Test ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "https://zkvanguard.vercel.app"
$conversationId = "stress-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$testsPassed = 0
$totalTests = 0

function Test-ChatAPI {
    param(
        [string]$TestName,
        [string]$Message,
        [string[]]$ExpectedKeywords,
        [string]$Description
    )
    
    $script:totalTests++
    Write-Host "`nTest ${totalTests}: $TestName" -ForegroundColor Yellow
    Write-Host "  Query: '$Message'" -ForegroundColor Gray
    
    try {
        $body = @{ 
            message = $Message
            conversationId = $script:conversationId
        } | ConvertTo-Json
        
        $headers = @{ "Content-Type" = "application/json" }
        $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -Headers $headers -UseBasicParsing -TimeoutSec 30
        
        if ($response.StatusCode -eq 200) {
            $chatResponse = $response.Content | ConvertFrom-Json
            
            # Display response details
            Write-Host "  Response received:" -ForegroundColor Cyan
            Write-Host "    Success: $($chatResponse.success)" -ForegroundColor Gray
            Write-Host "    Model: $($chatResponse.metadata.model)" -ForegroundColor Gray
            Write-Host "    Real AI: $($chatResponse.metadata.isRealAI)" -ForegroundColor Gray
            Write-Host "    Confidence: $($chatResponse.metadata.confidence)" -ForegroundColor Gray
            Write-Host "    Action Executed: $($chatResponse.metadata.actionExecuted)" -ForegroundColor Gray
            
            # Clean the response text
            $responseText = $chatResponse.response -replace '[^\x20-\x7E\n]', ''
            Write-Host "`n  AI Response:" -ForegroundColor White
            Write-Host "  $($responseText)" -ForegroundColor White
            Write-Host ""
            
            # Check for expected keywords
            $foundKeywords = @()
            $missingKeywords = @()
            foreach ($keyword in $ExpectedKeywords) {
                if ($responseText -match $keyword) {
                    $foundKeywords += $keyword
                } else {
                    $missingKeywords += $keyword
                }
            }
            
            # Analyze response quality
            $responseLength = $responseText.Length
            $isGeneric = $responseText -match "I can help|I'm here|Let me|Please provide|Could you"
            $hasActionFailed = $responseText -match "Action Failed|failed to"
            $isError = $responseText -match "error|Error|ERROR"
            
            Write-Host "  Analysis:" -ForegroundColor Cyan
            Write-Host "    Response length: $responseLength chars" -ForegroundColor Gray
            Write-Host "    Generic response: $isGeneric" -ForegroundColor Gray
            Write-Host "    Action failed: $hasActionFailed" -ForegroundColor Gray
            Write-Host "    Contains error: $isError" -ForegroundColor Gray
            
            if ($foundKeywords.Count -gt 0) {
                Write-Host "    Found keywords: $($foundKeywords -join ', ')" -ForegroundColor Green
            }
            if ($missingKeywords.Count -gt 0) {
                Write-Host "    Missing keywords: $($missingKeywords -join ', ')" -ForegroundColor Yellow
            }
            
            # Score the response
            $score = 0
            if ($chatResponse.success) { $score += 20 }
            if ($chatResponse.metadata.isRealAI) { $score += 20 }
            if ($responseLength -gt 50) { $score += 20 }
            if (-not $isGeneric) { $score += 10 }
            if (-not $hasActionFailed) { $score += 10 }
            if (-not $isError) { $score += 10 }
            if ($foundKeywords.Count -eq $ExpectedKeywords.Count) { $score += 10 }
            
            Write-Host "`n  Quality Score: $score/100" -ForegroundColor $(if($score -ge 70){"Green"}elseif($score -ge 50){"Yellow"}else{"Red"})
            
            if ($score -ge 60) {
                Write-Host "  ✅ PASSED" -ForegroundColor Green
                $script:testsPassed++
            } else {
                Write-Host "  ⚠️  MARGINAL - Low quality response" -ForegroundColor Yellow
            }
            
            return $chatResponse
            
        } else {
            Write-Host "  ❌ FAILED - Status: $($response.StatusCode)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ FAILED - $_" -ForegroundColor Red
    }
}

# Test 1: Complex Portfolio Analysis
Test-ChatAPI `
    -TestName "Complex Portfolio Analysis" `
    -Message "I have a $100,000 portfolio with 40% BTC, 30% ETH, 20% CRO, and 10% stablecoins. Analyze the risk and suggest optimal rebalancing for current market conditions." `
    -ExpectedKeywords @("risk", "portfolio", "rebalance") `
    -Description "Tests AI's ability to handle multi-asset portfolio analysis"

Start-Sleep -Seconds 2

# Test 2: Hedge Strategy Request
Test-ChatAPI `
    -TestName "Sophisticated Hedge Strategy" `
    -Message "My portfolio is exposed to 50% volatility risk in crypto markets. Generate a hedging strategy using options and derivatives to reduce risk by 30%." `
    -ExpectedKeywords @("hedge", "strategy", "risk") `
    -Description "Tests AI's hedge generation capabilities"

Start-Sleep -Seconds 2

# Test 3: Market Sentiment Analysis
Test-ChatAPI `
    -TestName "Market Sentiment Query" `
    -Message "What are the current market conditions for Cronos ecosystem tokens? Should I increase or decrease my CRO exposure?" `
    -ExpectedKeywords @("market", "CRO", "Cronos") `
    -Description "Tests market analysis capabilities"

Start-Sleep -Seconds 2

# Test 4: Risk Calculation Request
Test-ChatAPI `
    -TestName "VaR Calculation" `
    -Message "Calculate the Value at Risk (VaR) at 95% confidence level for a portfolio with $50k in BTC and $30k in altcoins with 60% correlation." `
    -ExpectedKeywords @("VaR", "risk", "portfolio") `
    -Description "Tests quantitative risk analysis"

Start-Sleep -Seconds 2

# Test 5: Action Command
Test-ChatAPI `
    -TestName "Portfolio Action Command" `
    -Message "Buy 1000 CRO at market price and rebalance portfolio to maintain 30% allocation" `
    -ExpectedKeywords @("buy", "CRO", "rebalance") `
    -Description "Tests action execution capabilities"

Start-Sleep -Seconds 2

# Test 6: ZK Proof Question
Test-ChatAPI `
    -TestName "ZK-STARK Explanation" `
    -Message "Explain how ZK-STARK proofs protect my portfolio privacy while still allowing verification" `
    -ExpectedKeywords @("ZK", "proof", "privacy") `
    -Description "Tests technical knowledge"

Start-Sleep -Seconds 2

# Test 7: Multi-step Planning
Test-ChatAPI `
    -TestName "Complex Strategy Planning" `
    -Message "Create a 3-month portfolio strategy: 1) hedge current positions, 2) gradually increase exposure to high-yield RWAs, 3) maintain 20% cash for opportunities" `
    -ExpectedKeywords @("strategy", "hedge", "RWA") `
    -Description "Tests multi-step planning capabilities"

Start-Sleep -Seconds 2

# Test 8: Error Recovery
Test-ChatAPI `
    -TestName "Invalid Query Handling" `
    -Message "asdfghjkl random nonsense query 12345 !@#$%" `
    -ExpectedKeywords @("help", "understand", "clarify") `
    -Description "Tests error handling and graceful degradation"

# Final Summary
Write-Host "`n=== Stress Test Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tests Passed: $testsPassed / $totalTests" -ForegroundColor $(if($testsPassed -eq $totalTests){"Green"}elseif($testsPassed -ge ($totalTests*0.7)){"Yellow"}else{"Red"})
Write-Host "Success Rate: $([math]::Round(($testsPassed/$totalTests)*100, 2))%" -ForegroundColor White
Write-Host ""

if ($testsPassed -eq $totalTests) {
    Write-Host "🎉 EXCELLENT - AI is performing at high quality!" -ForegroundColor Green
} elseif ($testsPassed -ge ($totalTests * 0.7)) {
    Write-Host "⚠️  GOOD - AI is functional but some responses need improvement" -ForegroundColor Yellow
} else {
    Write-Host "❌ POOR - AI responses are not meeting quality standards" -ForegroundColor Red
}

Write-Host ""
Write-Host "Key Observations:" -ForegroundColor Cyan
Write-Host "  • All tests used Real AI: Check 'Real AI: True' in responses" -ForegroundColor White
Write-Host "  • Response quality varies - some may be generic" -ForegroundColor White
Write-Host "  • Action execution depends on backend availability" -ForegroundColor White
Write-Host "  • Complex queries may require more context" -ForegroundColor White
Write-Host ""
