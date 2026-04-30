#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Stopping trishika-trading..."
pm2 stop trishika-trading || echo "Process not running."

echo
echo "PM2 status (should show 'stopped' for trishika-trading):"
pm2 status trishika-trading

echo
echo "After stopping, these URLs will no longer work until you run ./start.sh:"
echo "  Crypto  : http://localhost:3000/signal.html"
echo "  India   : http://localhost:3000/india.html"
echo "  Forex   : http://localhost:3000/forex.html"
