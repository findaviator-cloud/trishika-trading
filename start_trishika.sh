#!/bin/bash
# start_trishika.sh
# Called by Windows Task Scheduler on login/boot
# Starts PM2 and resurrects the trishika process

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd ~/projects/trishika-trading

# Resurrect saved PM2 process list
pm2 resurrect 2>/dev/null || pm2 start ecosystem.config.cjs

# Save process list so next resurrect works
pm2 save

echo "[$(date)] trishika started" >> ~/projects/trishika-trading/logs/startup.log
