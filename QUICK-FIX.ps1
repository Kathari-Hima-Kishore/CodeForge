# Quick Docker Time Fix - Run as Administrator
# Right-click PowerShell → "Run as Administrator" → paste this script path

Write-Host "`n=== Docker Time Sync Fix ===" -ForegroundColor Cyan
Write-Host "Shutting down all WSL instances..." -ForegroundColor Yellow

wsl --shutdown
Start-Sleep -Seconds 3

Write-Host "Syncing Windows time service..." -ForegroundColor Yellow
w32tm /resync /force | Out-Null

Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"

Write-Host "`nWaiting for Docker to initialize (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

Write-Host "`n=== Verifying time sync ===" -ForegroundColor Cyan
$winTime = Get-Date -Format "HH:mm:ss"
$dockerTime = wsl --exec docker run --rm alpine date '+%H:%M:%S' 2>$null

Write-Host "Windows: $winTime" -ForegroundColor Green
Write-Host "Docker:  $dockerTime" -ForegroundColor Green

if ($dockerTime -match $winTime.Substring(0,4)) {
    Write-Host "`n✅ SUCCESS - Docker time is now synced!`n" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Time still mismatched. Try running this script again.`n" -ForegroundColor Yellow
}
