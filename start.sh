#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Starting trishika-trading on PM2..."
pm2 start server.js --name trishika-trading

echo
echo "Current PM2 status:"
pm2 status trishika-trading

echo
echo "When it is online, open these dashboards in your browser:"
echo "  Crypto  : http://localhost:3000/signal.html"
echo "  India   : http://localhost:3000/india.html"
echo "  Forex   : http://localhost:3000/forex.html"
