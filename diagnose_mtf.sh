#!/usr/bin/env bash
# ============================================================
# MTF Scheduler Diagnostic - runs everything in one go,
# saves all output to a log file so nothing is lost even if
# the terminal closes.
# ============================================================

LOG=~/mtf_diagnose_log.txt

{
  echo "========================================"
  echo "1) DNS fix (in case network is broken)"
  echo "========================================"
  sudo bash -c 'echo "nameserver 8.8.8.8" > /etc/resolv.conf' 2>&1
  cat /etc/resolv.conf

  echo ""
  echo "========================================"
  echo "2) Confirm which repo folder + latest commit"
  echo "========================================"
  pwd
  git log --oneline -5

  echo ""
  echo "========================================"
  echo "3) Confirm scheduler.js on disk has the AUTO_REFRESH lines"
  echo "========================================"
  grep -n "AUTO_REFRESH_ENABLED" src/strategy/mtf/scheduler.js

  echo ""
  echo "========================================"
  echo "4) Hit the LIVE Render URL and show full MTF status JSON"
  echo "========================================"
  curl -s https://trishika-trading.onrender.com/api/mtf/status
  echo ""

  echo ""
  echo "========================================"
  echo "5) Also show just the scheduler part (pretty, if python available)"
  echo "========================================"
  curl -s https://trishika-trading.onrender.com/api/mtf/status | python3 -m json.tool 2>/dev/null || echo "(python3 not available for pretty-print, see raw JSON in step 4)"

  echo ""
  echo "DONE."
} > "$LOG" 2>&1

echo "Diagnostic complete. Log saved to: $LOG"
echo "Copying to Desktop for easy access..."
cp "$LOG" "/mnt/c/Users/Himanshu/Desktop/mtf_diagnose_log.txt" 2>&1
echo "Copied. Check Desktop for mtf_diagnose_log.txt and upload it in chat."
