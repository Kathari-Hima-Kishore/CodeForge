#!/bin/bash
# =============================================================================
# fix-docker-time.sh
# Run INSIDE WSL when Docker timestamps look wrong after sleep/hibernate
#
# Usage:
#   bash fix-docker-time.sh
# =============================================================================

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}[>] $1${NC}"; }
ok()    { echo -e "    ${GREEN}[OK] $1${NC}"; }
warn()  { echo -e "    ${YELLOW}[!!] $1${NC}"; }
fail()  { echo -e "    ${RED}[FAIL] $1${NC}"; }

# ── Step 1: Immediate clock sync ──────────────────────────────────────────────
step "Syncing WSL2 clock from hardware clock..."
if sudo hwclock --hctosys 2>/dev/null; then
    ok "hwclock synced"
else
    warn "hwclock failed — trying ntpdate..."
    if command -v ntpdate &>/dev/null; then
        sudo ntpdate -u time.windows.com && ok "ntpdate synced" || warn "ntpdate also failed"
    else
        warn "ntpdate not installed. Try: sudo apt-get install -y ntpdate"
    fi
fi

# ── Step 2: Show current time ─────────────────────────────────────────────────
step "Current time check..."
WSL_TIME=$(date '+%Y-%m-%d %H:%M:%S')
WIN_TIME=$(powershell.exe -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'" 2>/dev/null | tr -d '\r')
echo "    WSL2    : $WSL_TIME"
echo "    Windows : $WIN_TIME"

# ── Step 3: Ensure wsl.conf boot command is installed ────────────────────────
step "Verifying permanent fix in /etc/wsl.conf..."
if grep -q 'wsl-clock-sync\|hwclock' /etc/wsl.conf 2>/dev/null; then
    ok "/etc/wsl.conf already has boot command"
else
    warn "/etc/wsl.conf is missing the boot command — installing now..."

    # Write the sync script
    sudo tee /usr/local/bin/wsl-clock-sync > /dev/null << 'SYNCSCRIPT'
#!/bin/bash
hwclock --hctosys 2>/dev/null
echo "[$(date '+%Y-%m-%d %H:%M:%S')] clock synced" >> /var/log/wsl-clock.log 2>/dev/null || true
SYNCSCRIPT
    sudo chmod +x /usr/local/bin/wsl-clock-sync

    # Update wsl.conf
    if grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null; then
        sudo sed -i '/^\[boot\]/a command = /usr/local/bin/wsl-clock-sync' /etc/wsl.conf
    else
        printf '\n[boot]\ncommand = /usr/local/bin/wsl-clock-sync\n' | sudo tee -a /etc/wsl.conf > /dev/null
    fi

    ok "Permanent fix installed"
fi

# ── Step 4: Check systemd-timesyncd if available ──────────────────────────────
step "Checking systemd-timesyncd..."
if systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
    ok "systemd-timesyncd is running (continuous NTP sync active)"
elif command -v systemctl &>/dev/null; then
    warn "systemd-timesyncd is not running — enabling..."
    sudo systemctl enable --now systemd-timesyncd 2>/dev/null && ok "systemd-timesyncd enabled" || warn "Could not enable (may not be available)"
else
    warn "systemd not available in this WSL instance (normal for older distros)"
    ok "wsl.conf boot command covers restart-based sync"
fi

# ── Step 5: Verify Docker time ────────────────────────────────────────────────
step "Verifying Docker container time..."
if docker info &>/dev/null 2>&1; then
    DOCKER_TIME=$(docker run --rm --pull never alpine date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "image not available locally")
    echo "    Docker : $DOCKER_TIME"
    echo "    WSL2   : $(date '+%Y-%m-%d %H:%M:%S')"

    WSL_H=$(date +%H)
    DOCKER_H=$(echo "$DOCKER_TIME" | grep -oP '\d{2}(?=:\d{2}:\d{2})' | head -1)
    DRIFT=$((WSL_H - DOCKER_H))
    ABS_DRIFT=${DRIFT#-}

    if [ "$ABS_DRIFT" -le 1 ]; then
        echo -e "\n    ${GREEN}[✓] Docker and WSL2 are in sync${NC}"
    else
        warn "Docker still shows ~${ABS_DRIFT}h drift. Restart Docker Desktop and re-run this script."
        echo ""
        echo "    Quick restart from WSL:"
        echo '    powershell.exe -Command "wsl --shutdown; Start-Sleep 3; Start-Process \"$env:PROGRAMFILES\Docker\Docker\Docker Desktop.exe\""'
    fi
else
    warn "Docker is not running — start Docker Desktop and verify manually:"
    echo '    docker run --rm alpine date'
fi

echo -e "\n${GREEN}[✓] Done.${NC}"
echo -e "    To fix permanently on Windows side (scheduled task), run as Admin:"
echo -e "    ${CYAN}powershell.exe -ExecutionPolicy Bypass -File fix-docker-time.ps1${NC}\n"
