#!/usr/bin/env bash
# =============================================================================
# generate-systemd-timers.sh
# Generates systemd timer + service pairs for all AutoScale-IA cron endpoints.
# Derived from vercel.json schedules. Each timer calls the local Next.js app
# with CRON_SECRET bearer auth.
#
# Usage:
#   chmod +x scripts/generate-systemd-timers.sh
#   ./scripts/generate-systemd-timers.sh [output-dir]
#
# Default output dir: ./systemd/ (relative to project root)
# After generation, copy files to /etc/systemd/system/ and enable timers.
# =============================================================================
set -euo pipefail

OUTPUT_DIR="${1:-./systemd}"
mkdir -p "$OUTPUT_DIR"

# Base URL for cron calls (localhost inside the VPS)
BASE_URL="http://127.0.0.1:3000"

# Cron manifest: name | endpoint | OnCalendar | TimeoutSec
# Offsets are staggered to prevent thundering herd on the same second.
CRONS=(
  "publish-scheduled|/api/cron/publish-scheduled|*-*-* *:01:00|55"
  "publish-pending|/api/cron/publish-pending|*-*-* *:00/2:00|110"
  "finalize-inspiration-scrapes|/api/cron/finalize-inspiration-scrapes|*-*-* *:00/2:30|110"
  "prefetch-clone-urls|/api/cron/prefetch-clone-urls|*-*-* *:00/5:00|290"
  "process-videos|/api/cron/process-videos|*-*-* *:00/5:10|290"
  "process-loops|/api/cron/process-loops|*-*-* *:00/5:20|290"
  "process-scrape-jobs|/api/cron/process-scrape-jobs|*-*-* *:00/5:30|290"
  "sync-post-insights|/api/cron/sync-post-insights|*-*-* *:00/5:40|290"
  "sync-distribute-accounts|/api/cron/sync-distribute-accounts|*-*-* *:00/10:00|590"
    "check-health-alerts|/api/cron/check-health-alerts|*-*-* *:00/10:40|590"
  "sync-account-views|/api/cron/sync-account-views|*-*-* *:00/15:00|890"
  "daily-profit-notification|/api/cron/daily-profit-notification|*-*-* *:00/15:30|890"
  "story-templates|/api/cron/story-templates|*-*-* *:00/30:00|1790"
  "refresh-tokens|/api/cron/refresh-tokens|*-*-* 00/12:00:00|3590"
  "analytics-sync|/api/analytics/sync|*-*-* 02:00:00|3590"
)

echo "# Generating systemd units in: $OUTPUT_DIR"
echo "# Total crons: ${#CRONS[@]}"
echo ""

for entry in "${CRONS[@]}"; do
  IFS='|' read -r NAME ENDPOINT ON_CALENDAR TIMEOUT <<< "$entry"

  SERVICE_FILE="$OUTPUT_DIR/autoscale-${NAME}.service"
  TIMER_FILE="$OUTPUT_DIR/autoscale-${NAME}.timer"

  # --- Service file ---
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=AutoScale: ${NAME} cron
After=network-online.target
Requires=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/opt/autoscale/.env.cron
ExecStart=/usr/bin/curl -sf -H "Authorization: Bearer \${CRON_SECRET}" ${BASE_URL}${ENDPOINT}
TimeoutStartSec=${TIMEOUT}
StandardOutput=journal
StandardError=journal
EOF

  # --- Timer file ---
  cat > "$TIMER_FILE" <<EOF
[Unit]
Description=AutoScale: ${NAME} (${ON_CALENDAR})

[Timer]
OnCalendar=${ON_CALENDAR}
AccuracySec=5s
RandomizedDelaySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF

  echo "  ✓ autoscale-${NAME}.{service,timer}"
done

echo ""
echo "# Done. To install:"
echo "#   sudo cp ${OUTPUT_DIR}/autoscale-*.service ${OUTPUT_DIR}/autoscale-*.timer /etc/systemd/system/"
echo "#   sudo systemctl daemon-reload"
echo "#   sudo systemctl enable --now autoscale-*.timer"
echo ""
echo "# Verify:"
echo "#   systemctl list-timers --all | grep autoscale"
echo "#   journalctl -u autoscale-publish-scheduled.service --no-pager -n 20"