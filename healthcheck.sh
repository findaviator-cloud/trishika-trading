#!/bin/bash
cd ~/projects/trishika-trading

echo "=== PM2 ==="
pm2 resurrect 2>/dev/null || true
sleep 3
pm2 list

echo ""
echo "=== Last 10 monitor events ==="
tail -10 logs/monitor.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        print(f\"{d['ts'][:19]}  {d['level']:<5}  {d['code']:<25}  {d.get('message','')[:60]}\")
    except: pass
"

echo ""
echo "=== Signal file ages ==="
python3 -c "
import os, time
for f in ['signals_live/ETH_USD_1d.json','signals_live/SOL_USD_1d.json']:
    if os.path.exists(f):
        age = (time.time() - os.path.getmtime(f)) / 60
        status = 'OK' if age < 150 else 'STALE'
        print(f'  {f:<35}  age={age:.0f}min  {status}')
    else:
        print(f'  {f:<35}  MISSING')
"

echo ""
echo "=== Alert summary ==="
python3 -c "
import json
from collections import Counter
counts = Counter()
try:
    for line in open('logs/monitor.jsonl'):
        d = json.loads(line.strip())
        counts[d['level']+'/'+d['code']] += 1
except: pass
alerts = {k:v for k,v in counts.items() if k.startswith('ALERT')}
if alerts:
    print('Alerts:')
    for k,v in sorted(alerts.items()): print(f'  {k:<40}  {v}')
else:
    print('No alerts — clean')
print(f'Total MONITOR_CYCLE: {counts.get(\"INFO/MONITOR_CYCLE\",0)}')
print(f'Total SIGNAL_FRESH:  {counts.get(\"INFO/SIGNAL_FRESH\",0)}')
"

echo ""
echo "=== Regression ==="
python test_regression.py
