#!/usr/bin/env bash
# ============================================================
# Shows the EMA(200) confirmation (ALIGNED/CONFLICTING) as a
# visible badge on each symbol card in the dashboard.
#
# Root cause: the dashboard calls /api/candles/:symbol, and that
# route's toAnalysis() function never forwarded the emaConfirmation
# fields (even though the underlying signal file already had them).
#
# SAFE / ADDITIVE:
#  - Only 3 new keys added to the candles.js response
#  - Only a new conditional block added to the dashboard card HTML
#  - Nothing existing removed or changed
#  - Creates a git safety tag before touching anything
#  - Both files syntax-checked (node --check) before you deploy
# ============================================================
set -e

echo "=== Add EMA Confirmation Badge to Dashboard ==="

if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
  echo "ERROR: Run this from inside the trishika-trading folder (where server.js lives)."
  exit 1
fi

if [ -d ".git" ]; then
  TAG="pre-ema-badge-$(date +%Y%m%d-%H%M%S)"
  git add -A
  git commit -m "Snapshot before adding EMA confirmation dashboard badge" --allow-empty -q
  git tag "$TAG"
  echo "✔ Safety checkpoint created: git tag '$TAG'"
  echo "  (Agar kuch galat ho jaye to: git reset --hard $TAG)"
fi

CANDLES_FILE="src/routes/candles.js"
DASHBOARD_FILE="public/index.html"

if [ ! -f "$CANDLES_FILE" ] || [ ! -f "$DASHBOARD_FILE" ]; then
  echo "ERROR: Expected files not found. Are you in the right repo?"
  exit 1
fi

# ------------------------------------------------------------
# 1) Patch src/routes/candles.js — forward the EMA fields
# ------------------------------------------------------------
python3 << 'PYEOF'
path = "src/routes/candles.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

old = """    stopPrice: payload.signal?.stopPrice ?? null,
    direction: payload.signal?.direction ?? 0,
    _source: 'Donchian-ATR',"""

new = """    stopPrice: payload.signal?.stopPrice ?? null,
    direction: payload.signal?.direction ?? 0,
    emaConfirmation: payload.signal?.emaConfirmation ?? 'N/A',
    emaConfirmationNote: payload.signal?.emaConfirmationNote ?? null,
    ema200Daily: payload.signal?.ema200Daily ?? null,
    _source: 'Donchian-ATR',"""

if old not in content:
    print("ERROR: expected block not found in " + path + " — file may have changed since this script was written.")
    raise SystemExit(1)

content = content.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("OK: patched " + path)
PYEOF

# ------------------------------------------------------------
# 2) Patch public/index.html — show the badge on each card
# ------------------------------------------------------------
python3 << 'PYEOF'
path = "public/index.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

old = """      </div>` : ''}

      ${entry && signal !== 'NEUTRAL' ? `"""

new = """      </div>` : ''}

      ${analysis?.emaConfirmation && analysis.emaConfirmation !== 'N/A' ? `
      <div class="ema-confirmation-row" style="margin:8px 0;padding:6px 10px;border-radius:6px;font-size:11px;display:flex;justify-content:space-between;align-items:center;background:${analysis.emaConfirmation === 'ALIGNED' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'};border:1px solid ${analysis.emaConfirmation === 'ALIGNED' ? 'var(--green)' : 'var(--red)'}">
        <span style="color:var(--muted)">EMA(200) Trend</span>
        <span style="font-weight:700;color:${analysis.emaConfirmation === 'ALIGNED' ? 'var(--green)' : 'var(--red)'}">${analysis.emaConfirmation === 'ALIGNED' ? '✅ ALIGNED' : '⚠️ CONFLICTING'}</span>
      </div>` : ''}

      ${entry && signal !== 'NEUTRAL' ? `"""

count = content.count(old)
if count != 1:
    print(f"ERROR: expected exactly 1 match in {path}, found {count} — file may have changed since this script was written.")
    raise SystemExit(1)

content = content.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("OK: patched " + path)
PYEOF

# ------------------------------------------------------------
# 3) Syntax checks
# ------------------------------------------------------------
echo ""
echo "--- Syntax check ---"
node --check "$CANDLES_FILE" && echo "  OK: $CANDLES_FILE"

python3 -c "
import re
content = open('$DASHBOARD_FILE', encoding='utf-8').read()
scripts = re.findall(r'<script>(.*?)</script>', content, re.DOTALL)
with open('/tmp/_dashboard_check.js', 'w', encoding='utf-8') as f:
    for s in scripts:
        f.write(s + chr(10) + chr(10))
"
node --check /tmp/_dashboard_check.js && echo "  OK: $DASHBOARD_FILE (inline JS)"

echo ""
echo "--- git diff summary ---"
git add -A
git status

echo ""
echo "=== NEXT STEPS ==="
echo "1) Commit + push:"
echo "     git commit -m 'feat: show EMA(200) confirmation badge on dashboard cards'"
echo "     git push origin main"
echo ""
echo "2) After Render redeploys, open the dashboard in your browser:"
echo "     https://trishika-trading.onrender.com"
echo "   Hard-refresh (Ctrl+Shift+R) to clear the cached HTML/JS."
echo ""
echo "3) When a symbol shows a LONG/SHORT signal AND its EMA(200) is available,"
echo "   you should now see a green 'EMA(200) Trend: ALIGNED' or red"
echo "   'CONFLICTING' badge on that card, between the RSI/EMA5/BB row and"
echo "   the Entry/SL/TP row. Symbols with NEUTRAL signal or no EMA data yet"
echo "   show no badge (unchanged from before)."
echo ""
echo "NOTE: This only ADDS a display field. No signal logic, no entry/exit"
echo "behavior, and no other dashboard section was changed."
