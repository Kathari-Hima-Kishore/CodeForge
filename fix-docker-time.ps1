# =============================================================================
# fix-docker-time.ps1
# Permanently fixes Docker/WSL2 time desynchronization on Windows
#
# Run once as Administrator:
#   Right-click PowerShell → "Run as Administrator"
#   cd d:\Temporary\IDE
#   .\fix-docker-time.ps1
# =============================================================================

param(
    [switch]$SkipScheduledTask,
    [switch]$SkipDockerRestart
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n[>] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red }

# ── Check admin ──────────────────────────────────────────────────────────────
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Fail "Script must be run as Administrator."
    Write-Host "    Re-run: Start-Process PowerShell -Verb RunAs" -ForegroundColor Yellow
    exit 1
}

# ── Step 1: Sync Windows clock ────────────────────────────────────────────────
Write-Step "Syncing Windows system clock..."
try {
    Start-Service W32Time -ErrorAction SilentlyContinue
    w32tm /resync /force | Out-Null
    Write-Ok "Windows clock synced: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
} catch {
    Write-Warn "w32tm resync failed (may need internet). Continuing..."
}

# ── Step 2: Install WSL boot-time clock sync ──────────────────────────────────
Write-Step "Installing permanent WSL2 clock sync via wsl.conf..."

$wslConfScript = @'
#!/bin/bash
# Detect distro name for logging
DISTRO=$(cat /etc/os-release | grep ^NAME | cut -d= -f2 | tr -d '"')

# Sync hardware clock to system clock
hwclock --hctosys 2>/dev/null

# Also try ntpdate if available (more accurate)
if command -v ntpdate &>/dev/null; then
    ntpdate -u time.windows.com &>/dev/null
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] WSL2 clock synced on boot ($DISTRO)" >> /var/log/wsl-clock.log 2>/dev/null || true
'@

# Write the boot script into WSL
$wslConfScript | wsl --exec bash -c "
    # Write clock sync script
    cat > /usr/local/bin/wsl-clock-sync << 'SCRIPT'
$($wslConfScript)
SCRIPT
    chmod +x /usr/local/bin/wsl-clock-sync

    # Update /etc/wsl.conf
    if grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null; then
        # [boot] section exists — check for command line
        if grep -q '^command' /etc/wsl.conf 2>/dev/null; then
            sed -i 's|^command.*|command = /usr/local/bin/wsl-clock-sync|' /etc/wsl.conf
        else
            sed -i '/^\[boot\]/a command = /usr/local/bin/wsl-clock-sync' /etc/wsl.conf
        fi
    else
        # No [boot] section — append it
        printf '\n[boot]\ncommand = /usr/local/bin/wsl-clock-sync\n' >> /etc/wsl.conf
    fi

    echo 'wsl.conf updated'
    cat /etc/wsl.conf
"

Write-Ok "WSL2 boot command installed (/usr/local/bin/wsl-clock-sync)"
Write-Ok "/etc/wsl.conf updated with [boot] command"

# ── Step 3: Scheduled Task (covers sleep/wake drift) ─────────────────────────
if (-not $SkipScheduledTask) {
    Write-Step "Registering Windows Task Scheduler task (fires on login + startup)..."
    try {
        $action   = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "--exec sudo /usr/local/bin/wsl-clock-sync"
        $triggers = @(
            (New-ScheduledTaskTrigger -AtLogOn),
            (New-ScheduledTaskTrigger -AtStartup)
        )
        $settings = New-ScheduledTaskSettingsSet `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
            -MultipleInstances IgnoreNew `
            -StartWhenAvailable

        Register-ScheduledTask `
            -TaskName  "WSL2-ClockSync" `
            -TaskPath  "\Docker\" `
            -Action    $action `
            -Trigger   $triggers `
            -Settings  $settings `
            -RunLevel  Highest `
            -Force | Out-Null

        Write-Ok "Task registered: \Docker\WSL2-ClockSync"
    } catch {
        Write-Warn "Task Scheduler registration failed: $($_.Exception.Message)"
        Write-Warn "Clock will still sync on WSL restart via wsl.conf"
    }
}

# ── Step 4: Shutdown WSL + restart Docker Desktop ────────────────────────────
if (-not $SkipDockerRestart) {
    Write-Step "Restarting WSL2 and Docker Desktop..."

    Write-Host "    Shutting down all WSL instances..." -ForegroundColor Gray
    wsl --shutdown
    Start-Sleep -Seconds 3

    # Kill Docker Desktop if running
    $dockerProcs = @("Docker Desktop", "com.docker.backend", "dockerd")
    foreach ($proc in $dockerProcs) {
        Stop-Process -Name $proc -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2

    # Start Docker Desktop
    $dockerExe = "$env:PROGRAMFILES\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
        Write-Ok "Docker Desktop starting... (wait ~15s for whale icon to stabilize)"
    } else {
        Write-Warn "Docker Desktop not found at $dockerExe — start it manually"
    }
}

# ── Step 5: Verify ────────────────────────────────────────────────────────────
Write-Step "Verification (run after Docker fully starts)..."

$winTime = Get-Date -Format "HH:mm:ss"
Write-Host "`n    Windows : $winTime" -ForegroundColor White

try {
    $wslTime    = wsl --exec bash -c "date +'%H:%M:%S'" 2>$null
    $dockerTime = wsl --exec bash -c "docker run --rm --pull never alpine date +'%H:%M:%S' 2>/dev/null || echo 'Docker not ready yet'" 2>$null

    Write-Host "    WSL2    : $($wslTime.Trim())" -ForegroundColor White
    Write-Host "    Docker  : $($dockerTime.Trim())" -ForegroundColor White

    $wslHour    = [int]($wslTime.Trim().Split(":")[0])
    $winHour    = [int]($winTime.Split(":")[0])
    $drift      = [Math]::Abs($wslHour - $winHour)

    if ($drift -le 1) {
        Write-Host "`n    [✓] CLOCKS ARE IN SYNC" -ForegroundColor Green
    } else {
        Write-Host "`n    [!] Still drifted by ~$drift hour(s). Wait for Docker to start and re-run:" -ForegroundColor Yellow
        Write-Host "        wsl --exec sudo hwclock --hctosys" -ForegroundColor Gray
    }
} catch {
    Write-Warn "Could not verify Docker time — Docker may still be starting."
    Write-Host "    Run manually after Docker starts:" -ForegroundColor Gray
    Write-Host '    wsl --exec bash -c "date && docker run --rm alpine date"' -ForegroundColor Gray
}

Write-Host "`n[✓] Setup complete. Permanent fix installed." -ForegroundColor Green
Write-Host "    Future WSL starts will auto-sync the clock via /etc/wsl.conf`n" -ForegroundColor Gray
