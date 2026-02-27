#!/usr/bin/env pwsh
# Sync subdirectories to specialized GitHub repos

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

Write-Host "Preparing subdirectory syncs..." -ForegroundColor Yellow
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
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    
    # Copy subdirectories to temp
    foreach ($subdir in $repo.Subdirs) {
        if (Test-Path $subdir) {
            $destBase = Split-Path -Leaf $subdir
            $dest = Join-Path $tempDir $destBase
            Write-Host "      Copying $subdir -> $dest" -ForegroundColor Gray
            Copy-Item -Path $subdir -Destination $dest -Recurse -Force
        }
    }
    
    # Initialize git in temp directory
    Push-Location $tempDir
    
    git init 2>&1 | Out-Null
    git add . 2>&1 | Out-Null
    
    $commitMsg = "sync: Update from main repo - $lastCommit"
    git commit -m $commitMsg 2>&1 | Out-Null
    
    # Add remote and push
    Write-Host "      Pushing to $remoteUrl..." -ForegroundColor Gray
    git remote add origin $remoteUrl 2>&1 | Out-Null
    
    $pushResult = git push origin HEAD:main --force 2>&1
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
