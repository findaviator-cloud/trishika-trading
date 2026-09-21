#!/usr/bin/env bash
# ============================================================
# Trishika Trading - Cleanup Script
# Removes dead/backup/duplicate/empty files identified in code review.
# SAFE: creates a git safety-tag before deleting anything.
# ============================================================
set -e

echo "=== Trishika Cleanup Script ==="

# --- Safety check: must be run from inside the repo root ---
if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
  echo "ERROR: Run this script from inside the trishika-trading folder (where server.js lives)."
  exit 1
fi

# --- Safety net: tag current state in git before touching anything ---
if [ -d ".git" ]; then
  TAG="pre-cleanup-$(date +%Y%m%d-%H%M%S)"
  git add -A
  git commit -m "Snapshot before automated cleanup" --allow-empty -q
  git tag "$TAG"
  echo "✔ Safety checkpoint created: git tag '$TAG'"
  echo "  (Agar kuch galat ho jaye to: git reset --hard $TAG)"
else
  echo "⚠ Warning: .git folder nahi mila, git safety-tag skip kar raha hoon."
fi

echo ""
echo "--- Deleting backup/version-suffix files (.bak, .new, .v1-before-*, etc) ---"
FILES_TO_DELETE=(
  "server.js.new"
  "src/ai/index.js.bak"
  "src/offlineAnalyze.mjs.bak"
  "test_next_bar_strategy.py.bak"
  "backtest_btcusdt_1h_baseline.py.bak"
  "healthcheck.sh.bak"
  ".gitignore.v1-before-research-artifact-rules"
  "src/strategy/live_signal_writer.v1-before-handover-comment-fix.js"
  "src/services/ai_helpers.js.bak2"
  "('\n')"
)

for f in "${FILES_TO_DELETE[@]}"; do
  if [ -e "$f" ]; then
    rm -f "$f"
    echo "  deleted: $f"
  else
    echo "  (skip, not found): $f"
  fi
done

echo ""
echo "--- Deleting empty/dead (0-byte, unused) files ---"
EMPTY_DEAD_FILES=(
  "src/services/badfile.js"
  "src/services/prompt.js"
  "src/services/ai.js"
  "crypto.html"
  "forex.html"
  "india.html"
  "emaSlow"
  "ollama"
)

for f in "${EMPTY_DEAD_FILES[@]}"; do
  if [ -e "$f" ]; then
    rm -f "$f"
    echo "  deleted: $f"
  else
    echo "  (skip, not found): $f"
  fi
done

echo ""
echo "--- Removing orphan/duplicate ai_helpers files (keeping src/services/ai_helpers.js) ---"
ORPHAN_DUPES=(
  "src/ai/ai_helpers.js"
  "src/services/aihelpers.js"
)
for f in "${ORPHAN_DUPES[@]}"; do
  if [ -e "$f" ]; then
    rm -f "$f"
    echo "  deleted: $f"
  else
    echo "  (skip, not found): $f"
  fi
done

echo ""
echo "--- Moving stray manifest/tree/debug .txt files into docs/_notes/ (not deleting, just tidying) ---"
mkdir -p docs/_notes
NOTE_FILES=(
  "tree-core.txt"
  "tree-root.txt"
  "tree-src.txt"
  "tree-support.txt"
  "root-files.txt"
  "src-files.txt"
  "js-files.txt"
  "out_btc.txt"
  "params.txt"
)
for f in "${NOTE_FILES[@]}"; do
  if [ -e "$f" ]; then
    git mv "$f" "docs/_notes/$f" 2>/dev/null || mv "$f" "docs/_notes/$f"
    echo "  moved: $f -> docs/_notes/$f"
  else
    echo "  (skip, not found): $f"
  fi
done

echo ""
echo "=== ⚠ MANUAL REVIEW NEEDED (not auto-deleted) ==="
echo "1) Root-level backtest_btcusdt_1h_baseline.py is just a stub:"
echo "     '# full script here ...'"
echo "   Real code exists in scripts/backtest_btcusdt_1h_baseline.py"
echo "   -> Decide: delete the root stub, or restore real content into it."
echo ""
echo "2) Root index.html (22KB) vs public/index.html (35KB) — only public/ is served by Express."
echo "   Root index.html looks like an old/unused copy. Review before deleting:"
echo "     rm index.html"
echo ""

echo "--- Done. Review 'git status' and 'git diff --stat' before committing. ---"
git status
