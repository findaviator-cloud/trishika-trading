#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Activate venv
source venv/bin/activate

# Generate PDF
python make_backup_pdf.py

# Resolve Windows Desktop path
WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
DEST="/mnt/c/Users/$WIN_USER/Desktop/trishika_backup_$(date +%Y%m%d).pdf"

echo "Copying to: $DEST"
cp "trishika_backup_$(date +%Y%m%d).pdf" "$DEST"
echo "✓ Copied to Desktop: $DEST"
