# Chronos-Vanguard — Start ZKP Server + Cloudflare Tunnel
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "`n  Starting Chronos-Vanguard services...`n" -ForegroundColor Cyan

# --- 1. ZKP API Server (background job) ---
$serverJob = Start-Job -Name "ZKP-Server" -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:PYTHONIOENCODING = "utf-8"
    python zkp\api\server.py 2>&1
} -ArgumentList $Root

Write-Host "  [1/2] ZKP API server started  (Job: $($serverJob.Id))" -ForegroundColor Green

# --- 2. Cloudflare Tunnel (background job) ---
$tunnelJob = Start-Job -Name "CF-Tunnel" -ScriptBlock {
    & "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run enhanced-p521-zk 2>&1
} 

Write-Host "  [2/2] Cloudflare tunnel started (Job: $($tunnelJob.Id))" -ForegroundColor Green
Write-Host "`n  Both services running. Press Ctrl+C to stop.`n" -ForegroundColor Yellow

# --- Stream combined output until user hits Ctrl+C ---
try {
    while ($true) {
        # Pull any new output from both jobs
        Receive-Job -Job $serverJob -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  [ZKP]    $_" -ForegroundColor White
        }
        Receive-Job -Job $tunnelJob -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  [TUNNEL] $_" -ForegroundColor DarkCyan
        }

        # If either job failed/stopped, report it
        if ($serverJob.State -eq "Failed") {
            Write-Host "`n  ZKP server exited unexpectedly." -ForegroundColor Red
            Receive-Job -Job $serverJob -ErrorAction SilentlyContinue
            break
        }
        if ($tunnelJob.State -eq "Failed") {
            Write-Host "`n  Cloudflare tunnel exited unexpectedly." -ForegroundColor Red
            Receive-Job -Job $tunnelJob -ErrorAction SilentlyContinue
            break
        }

        Start-Sleep -Milliseconds 500
    }
}
finally {
    # Cleanup on exit
    Write-Host "`n  Shutting down..." -ForegroundColor Yellow
    Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
    Stop-Job -Job $tunnelJob -ErrorAction SilentlyContinue
    Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
    Remove-Job -Job $tunnelJob -Force -ErrorAction SilentlyContinue
    Write-Host "  All services stopped.`n" -ForegroundColor Green
}
