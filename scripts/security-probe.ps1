$base = "https://www.zkvanguard.xyz"
$results = @()

function ProbeJSON([string]$label, [string]$method, [string]$path, [string]$body, [hashtable]$headers) {
  $url = "$base$path"
  $h = @{}
  if ($headers) { $headers.GetEnumerator() | ForEach-Object { $h[$_.Key] = $_.Value } }
  try {
    if ($body) {
      $r = Invoke-WebRequest -Uri $url -Method $method -Body $body -ContentType "application/json" -Headers $h -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
    } else {
      $r = Invoke-WebRequest -Uri $url -Method $method -Headers $h -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
    }
    $body200 = if ($r.Content.Length -gt 180) { $r.Content.Substring(0,180) } else { $r.Content }
    return "[$label] $method $path -> $($r.StatusCode)  $body200"
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $msg = $_.ErrorDetails.Message
    if ($msg -and $msg.Length -gt 120) { $msg = $msg.Substring(0,120) }
    return "[$label] $method $path -> $code  $msg"
  }
}

$results += ProbeJSON "admin-bluefin-deposit"   "POST" "/api/admin/bluefin-deposit"   '{}' $null
$results += ProbeJSON "admin-bluefin-preflight" "POST" "/api/admin/bluefin-preflight" '{}' $null
$results += ProbeJSON "admin-reconcile-hedges"  "POST" "/api/admin/reconcile-sui-hedges" '{}' $null
$results += ProbeJSON "admin-strategy-pnl"      "GET"  "/api/admin/strategy-pnl"       $null $null
$results += ProbeJSON "admin-sui-reset-hedges"  "POST" "/api/admin/sui-reset-hedges"   '{}' $null

$wrong = @{ "Authorization" = "Bearer wrong-secret-12345" }
$results += ProbeJSON "admin-pnl-wrong"   "GET"  "/api/admin/strategy-pnl"      $null $wrong
$results += ProbeJSON "admin-reset-wrong" "POST" "/api/admin/sui-reset-hedges"  '{}'  $wrong

$results += ProbeJSON "auto-hedge-mutate" "POST" "/api/community-pool/auto-hedge" '{"enabled":true,"riskThreshold":99,"maxLeverage":99}' $null

$results += ProbeJSON "record-deposit-fake" "POST" "/api/sui/community-pool?action=record-deposit" '{"address":"0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93","amount":"99999","txDigest":"FAKE_DIGEST_THAT_DOES_NOT_EXIST_12345"}' $null

$results += ProbeJSON "deposit-MAX"  "POST" "/api/sui/community-pool?action=deposit" '{"amount":"99999999999999999999"}' $null
$results += ProbeJSON "withdraw-neg"  "POST" "/api/sui/community-pool?action=withdraw" '{"shares":-1}' $null
$results += ProbeJSON "withdraw-zero" "POST" "/api/sui/community-pool?action=withdraw" '{"shares":0}' $null

$results += ProbeJSON "user-pos-xss"  "GET"  "/api/sui/community-pool?action=user-position&wallet=<script>alert(1)</script>" $null $null
$results += ProbeJSON "user-pos-sqli" "GET"  "/api/sui/community-pool?action=user-position&wallet=' OR 1=1--" $null $null

$results | ForEach-Object { Write-Host $_ }
