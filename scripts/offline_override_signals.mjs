import fs from 'fs';
import path from 'path';

const SIGNALS_DIR = './signals_offline';

function applyDecisionEngine(file) {
  const full = path.join(SIGNALS_DIR, file);
  const raw = fs.readFileSync(full, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  const indicators = data.indicators || {};
  const { rsi, trendScore } = indicators;

  if (rsi == null || trendScore == null) return;

  // Trend-following logic: go with the move
  const RSI_BULL_THRESHOLD = 55;
  const RSI_BEAR_THRESHOLD = 45;
  const TREND_STRENGTH = 0.5;

  let signal = 'NEUTRAL';
  let confidence = 50;

  // LONG if showing upward strength
  if (rsi > RSI_BULL_THRESHOLD && trendScore > TREND_STRENGTH) {
    signal = 'LONG';
    confidence = 85;
  }
  // SHORT if showing downward strength
  else if (rsi < RSI_BEAR_THRESHOLD && trendScore < -TREND_STRENGTH) {
    signal = 'SHORT';
    confidence = 85;
  }

  data.signal = signal;
  data.confidence = confidence;

  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8');
}

function main() {
  if (!fs.existsSync(SIGNALS_DIR)) return;
  const files = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
  files.forEach(applyDecisionEngine);
}

main();
