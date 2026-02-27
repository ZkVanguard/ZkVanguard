#!/usr/bin/env pwsh
# Sync subdirectories to specialized GitHub repos (preserves existing files)

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Continue"

Write-Host "=== ZkVanguard Multi-Repo Sync Tool ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$org = "ZkVanguard"
$repos = @(
    @{
        Name = "contracts-evm"
        Subdirs = @("contracts/core", "contracts/mocks", "contracts/abi")
        Description = "Solidity contracts for Cronos zkEVM"
    },
    @{
        Name = "contracts-sui"
        Subdirs = @("contracts/sui")
        Description = "Move contracts for SUI Network"
    },
    @{
        Name = "ai-agents"
        Subdirs = @("agents")
        Description = "Multi-agent AI swarm"
    },
    @{
        Name = "zkp-engine"
        Subdirs = @("zkp", "zk")
        Description = "Post-quantum ZK-STARK engine"
    }
)

# Check if we're in the right directory
if (-not (Test-Path ".git")) {
    Write-Host "ERROR: Must run from ZkVanguard root directory" -ForegroundColor Red
    exit 1
}

Write-Host "Preparing subdirectory syncs (preserving existing files)..." -ForegroundColor Yellow
Write-Host ""

# Show what will be synced
foreach ($repo in $repos) {
    Write-Host "   Repository: $($repo.Name)" -ForegroundColor Cyan
    Write-Host "   Description: $($repo.Description)" -ForegroundColor Gray
    Write-Host "   Source directories:" -ForegroundColor Gray
    
    foreach ($subdir in $repo.Subdirs) {
        if (Test-Path $subdir) {
            $files = (Get-ChildItem -Path $subdir -Recurse -File).Count
            Write-Host "      - $subdir ($files files)" -ForegroundColor Green
        } else {
            Write-Host "      - $subdir (NOT FOUND)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
}

if ($DryRun) {
    Write-Host "=== DRY RUN MODE ===" -ForegroundColor Yellow
    Write-Host "Run without -DryRun to execute actual sync" -ForegroundColor Yellow
    exit 0
}

Write-Host "Syncing subdirectories to specialized repos..." -ForegroundColor Yellow
Write-Host ""

# Get current commit for reference
$lastCommit = git log -1 --pretty=format:"%s"

# Sync each repo
foreach ($repo in $repos) {
    $repoName = $repo.Name
    $remoteUrl = "https://github.com/$org/$repoName.git"
    Write-Host "   Syncing: $repoName" -ForegroundColor Cyan
    
    # Create a temporary directory for this repo
    $tempDir = ".sync-temp-$repoName"
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    
    # Clone the existing repo to preserve README, LICENSE, etc.
    Write-Host "      Cloning existing repo..." -ForegroundColor Gray
    $cloneResult = git clone $remoteUrl $tempDir 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      Failed to clone: $cloneResult" -ForegroundColor Red
        Write-Host ""
        continue
    }
    
    # Remove old code directories (but keep root files like README, LICENSE)
    Push-Location $tempDir
    foreach ($subdir in $repo.Subdirs) {
        $destBase = Split-Path -Leaf $subdir
        if (Test-Path $destBase) {
            Remove-Item -Path $destBase -Recurse -Force
            Write-Host "      Removed old: $destBase" -ForegroundColor Gray
        }
    }
    Pop-Location
    
    # Copy fresh code from main repo
    foreach ($subdir in $repo.Subdirs) {
        if (Test-Path $subdir) {
            $destBase = Split-Path -Leaf $subdir
            $dest = Join-Path $tempDir $destBase
            Write-Host "      Copying $subdir -> $dest" -ForegroundColor Gray
            Copy-Item -Path $subdir -Destination $dest -Recurse -Force
        }
    }
    
    # Commit and push changes
    Push-Location $tempDir
    
    git add -A 2>&1 | Out-Null
    
    # Check if there are changes
    $status = git status --porcelain
    if (-not $status) {
        Write-Host "      No changes to sync" -ForegroundColor Yellow
        Pop-Location
        Remove-Item -Path $tempDir -Recurse -Force
        Write-Host ""
        continue
    }
    
    $commitMsg = "sync: Update from main repo - $lastCommit"
    git commit -m $commitMsg 2>&1 | Out-Null
    
    Write-Host "      Pushing changes..." -ForegroundColor Gray
    $pushResult = git push origin main 2>&1
    $exitCode = $LASTEXITCODE
    
    Pop-Location
    
    # Cleanup temp directory
    Remove-Item -Path $tempDir -Recurse -Force
    
    if ($exitCode -eq 0) {
        Write-Host "      Done!" -ForegroundColor Green
    } else {
        Write-Host "      Failed: $pushResult" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "=== Sync Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Repositories:" -ForegroundColor Cyan
foreach ($repo in $repos) {
    Write-Host "  https://github.com/$org/$($repo.Name)" -ForegroundColor Gray
}
