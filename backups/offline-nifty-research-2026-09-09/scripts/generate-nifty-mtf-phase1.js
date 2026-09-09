#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const DAILY_CSV = path.resolve(ROOT, argValue(
  '--daily-csv',
  'data/india-input/nifty50-nse-daily-normalized.csv'
));
const DAILY_SNAPSHOTS = path.resolve(ROOT, argValue(
  '--daily-snapshots',
  'data/india-analysis/nifty-daily-reference-snapshots.json'
));
const DAILY_REGRESSION = path.resolve(ROOT, argValue(
  '--daily-regression',
  'data/india-analysis/nifty-daily-reference-regression-audit.json'
));
const ADMISSION = path.resolve(ROOT, argValue(
  '--admission',
  'data/india-analysis/nifty-minute-source-admission.json'
));
const OUTPUT_DIR = path.resolve(ROOT, argValue(
  '--output-dir',
  'data/india-analysis/mtf'
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);

  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert(value && typeof value === 'object' && !Array.isArray(value), `${label} JSON root must be an object.`);
    return value;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function findHeader(headers, acceptedNames, label) {
  const map = new Map(headers.map((header) => [header.trim().toLowerCase(), header]));

  for (const name of acceptedNames) {
    const found = map.get(name.toLowerCase());
    if (found) return found;
  }

  throw new Error(`${label} missing. Accepted names: ${acceptedNames.join(', ')}`);
}

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const prefix = value.trim().slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
}

function parseDailyCsv(filePath) {
  assert(fs.existsSync(filePath), `Missing official daily CSV: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  assert(raw.length > 0, 'Official daily CSV is empty.');

  const lines = raw.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 2, 'Official daily CSV requires header and at least one row.');

  const headers = lines.shift().split(',').map((item) => item.trim());
  const dateHeader = findHeader(headers, ['date', 'timestamp', 'datetime'], 'Official daily date column');
  const openHeader = findHeader(headers, ['open'], 'Official daily open column');
  const highHeader = findHeader(headers, ['high'], 'Official daily high column');
  const lowHeader = findHeader(headers, ['low'], 'Official daily low column');
  const closeHeader = findHeader(headers, ['close', 'closing price', 'closingprice'], 'Official daily close column');

  const rows = lines.map((line, index) => {
    const values = line.split(',').map((item) => item.trim());
    assert(values.length === headers.length, `Official daily row ${index + 2} column count mismatch.`);
    const rawRow = Object.fromEntries(headers.map((header, position) => [header, values[position]]));
    const date = parseDate(rawRow[dateHeader]);
    const open = Number(rawRow[openHeader]);
    const high = Number(rawRow[highHeader]);
    const low = Number(rawRow[lowHeader]);
    const close = Number(rawRow[closeHeader]);

    assert(date, `Official daily row ${index + 2} has invalid date.`);
    assert([open, high, low, close].every(Number.isFinite), `Official daily row ${index + 2} has invalid OHLC.`);
    assert(high >= Math.max(open, close) && low <= Math.min(open, close), `Official daily row ${index + 2} has invalid OHLC range.`);

    return { date, open, high, low, close };
  });

  for (let index = 1; index < rows.length; index += 1) {
    assert(rows[index].date > rows[index - 1].date, 'Official daily CSV must be strictly chronological with no duplicate dates.');
  }

  return rows;
}

function sma(values, length) {
  if (values.length < length) return null;
  const subset = values.slice(-length);
  return subset.reduce((sum, value) => sum + value, 0) / length;
}

function atr(rows, length = 14) {
  if (rows.length < length + 1) return null;
  const ranges = [];

  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  return sma(ranges, length);
}

function donchian(rows, length = 20) {
  if (rows.length < length + 1) return null;
  const lookback = rows.slice(-(length + 1), -1);

  return {
    high: Math.max(...lookback.map((row) => row.high)),
    low: Math.min(...lookback.map((row) => row.low))
  };
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

try {
  const dailySnapshots = readJson(DAILY_SNAPSHOTS, 'daily reference snapshots');
  const dailyRegression = readJson(DAILY_REGRESSION, 'daily reference regression');
  const admission = readJson(ADMISSION, 'NIFTY source-admission artifact');
  const rows = parseDailyCsv(DAILY_CSV);

  assert(dailyRegression.summary?.result === 'PASS', 'Official daily regression must be PASS.');
  assert(admission.decision === 'BLOCKED', 'Phase 1 requires canonical frozen NIFTY admission decision BLOCKED.');
  assert(admission.decisionPrecedence?.terminalReason === 'SESSION_BLOCKED', 'Phase 1 requires canonical terminal reason SESSION_BLOCKED.');
  assert(admission.approvedForResearchSource === false, 'Phase 1 requires current intraday research admission false.');
  assert(admission.approvedForTrading === false, 'Trading approval must remain false.');
  assert(admission.executionBoundary?.researchOnly === true, 'Research-only boundary must remain true.');
  assert(admission.executionBoundary?.brokerConnectivityAllowed === false, 'Broker connectivity must remain disabled.');
  assert(admission.executionBoundary?.websocketAllowed === false, 'WebSocket must remain disabled.');
  assert(admission.executionBoundary?.ordersAllowed === false, 'Orders must remain disabled.');
  assert(admission.executionBoundary?.executionAllowed === false, 'Execution must remain disabled.');

  const last = rows.at(-1);
  const closes = rows.map((row) => row.close);
  const channel = donchian(rows, 20);
  const sma200 = sma(closes, 200);
  const atr14 = atr(rows, 14);

  let bias = 'INSUFFICIENT_DATA';
  let reason = 'Insufficient daily reference history for configured indicators.';

  if (channel && sma200 !== null && atr14 !== null) {
    bias = last.close > channel.high
      ? 'LONG_BIAS'
      : last.close < channel.low
        ? 'SHORT_BIAS'
        : 'NEUTRAL';

    reason = bias === 'LONG_BIAS'
      ? 'Official daily close is above prior Donchian(20) high.'
      : bias === 'SHORT_BIAS'
        ? 'Official daily close is below prior Donchian(20) low.'
        : 'Official daily close is inside prior Donchian(20) range.';
  }

  const generatedAtUtc = new Date().toISOString();
  const dailyPath = path.join(OUTPUT_DIR, 'NIFTY_1d.json');
  const summaryPath = path.join(OUTPUT_DIR, 'NIFTY_summary.json');
  const manifestPath = path.join(OUTPUT_DIR, '_manifest.json');

  const dailySnapshot = {
    schemaVersion: 1,
    generatedAtUtc,
    market: 'INDIA',
    symbol: 'NIFTY 50',
    key: 'NIFTY',
    timeframe: '1d',
    status: 'AVAILABLE_OFFICIAL_DAILY_REFERENCE',
    source: {
      classification: 'OFFICIAL_DAILY_REFERENCE',
      csvPath: path.relative(ROOT, DAILY_CSV),
      sha256: sha256(DAILY_CSV),
      coverageStart: rows[0].date,
      coverageEnd: last.date,
      rows: rows.length
    },
    researchOnly: true,
    approvedForTrading: false,
    executionAllowed: false,
    price: round(last.close),
    signal: {
      bias,
      reason,
      confidence: bias === 'NEUTRAL' ? 40 : bias === 'INSUFFICIENT_DATA' ? 0 : 60
    },
    indicators: {
      sma200: round(sma200),
      atr14: round(atr14),
      donchian20High: round(channel?.high),
      donchian20Low: round(channel?.low)
    },
    evidence: {
      dailyRegression: {
        result: dailyRegression.summary?.result,
        scenariosPassed: dailyRegression.summary?.scenariosPassed ?? null,
        scenariosTotal: dailyRegression.summary?.scenariosTotal ?? null,
        differences: dailyRegression.summary?.differences ?? null
      },
      dailySnapshotArtifactSha256: sha256(DAILY_SNAPSHOTS)
    }
  };

  const blockedTimeframe = (timeframe) => ({
    timeframe,
    status: 'BLOCKED',
    currentSnapshotGenerated: false,
    reason: 'Current NIFTY intraday research-source admission is not approved. No current intraday MTF snapshot was generated.',
    admissionDecision: admission.decision,
    terminalReason: admission.decisionPrecedence.terminalReason,
    approvedForResearchSource: admission.approvedForResearchSource,
    approvedForTrading: admission.approvedForTrading
  });

  const summary = {
    schemaVersion: 1,
    generatedAtUtc,
    market: 'INDIA',
    symbol: 'NIFTY 50',
    key: 'NIFTY',
    status: 'PARTIAL_OFFLINE_DAILY_REFERENCE_ONLY',
    researchOnly: true,
    approvedForTrading: false,
    executionAllowed: false,
    overall: {
      status: 'PARTIAL',
      reason: 'Official daily reference is available. Current intraday 1H and 4H snapshots are blocked by the canonical source-admission artifact.'
    },
    timeframes: {
      '1h': blockedTimeframe('1h'),
      '4h': blockedTimeframe('4h'),
      '1d': {
        timeframe: '1d',
        status: dailySnapshot.status,
        currentSnapshotGenerated: true,
        source: dailySnapshot.source.classification,
        bias: dailySnapshot.signal.bias,
        reason: dailySnapshot.signal.reason,
        price: dailySnapshot.price,
        coverageStart: dailySnapshot.source.coverageStart,
        coverageEnd: dailySnapshot.source.coverageEnd,
        rows: dailySnapshot.source.rows
      }
    },
    admission: {
      artifactPath: path.relative(ROOT, ADMISSION),
      artifactSha256: sha256(ADMISSION),
      decision: admission.decision,
      terminalReason: admission.decisionPrecedence.terminalReason,
      approvedForResearchSource: admission.approvedForResearchSource,
      approvedForTrading: admission.approvedForTrading,
      executionBoundary: admission.executionBoundary
    }
  };

  const manifest = {
    schemaVersion: 1,
    generatedAtUtc,
    status: 'PARTIAL_OFFLINE_DAILY_REFERENCE_ONLY',
    mode: 'OFFLINE_NIFTY_MTF_PHASE_1',
    files: {
      NIFTY_1d: {
        path: 'NIFTY_1d.json',
        sha256: null,
        status: dailySnapshot.status
      },
      NIFTY_1h: {
        path: 'NIFTY_1h.json',
        exists: false,
        status: 'BLOCKED',
        reason: summary.timeframes['1h'].reason
      },
      NIFTY_4h: {
        path: 'NIFTY_4h.json',
        exists: false,
        status: 'BLOCKED',
        reason: summary.timeframes['4h'].reason
      },
      summary: {
        path: 'NIFTY_summary.json',
        sha256: null
      }
    },
    admissionDependency: summary.admission,
    safety: {
      researchOnly: true,
      approvedForTrading: false,
      brokerConnectivityAllowed: false,
      websocketAllowed: false,
      ordersAllowed: false,
      executionAllowed: false,
      marketRequestsUsed: false
    }
  };

  atomicWriteJson(dailyPath, dailySnapshot);
  atomicWriteJson(summaryPath, summary);

  manifest.files.NIFTY_1d.sha256 = sha256(dailyPath);
  manifest.files.summary.sha256 = sha256(summaryPath);

  atomicWriteJson(manifestPath, manifest);

  console.log('PASS: NIFTY MTF PHASE 1 GENERATED');
  console.log(`Official daily 1D: ${dailySnapshot.signal.bias}; rows=${rows.length}; coverage=${rows[0].date} to ${last.date}`);
  console.log(`Current 1H: BLOCKED; admission=${admission.decision}; terminalReason=${admission.decisionPrecedence.terminalReason}`);
  console.log(`Current 4H: BLOCKED; admission=${admission.decision}; terminalReason=${admission.decisionPrecedence.terminalReason}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('Safety: offline local artifact generation only; no market API, broker, WebSocket, authentication, order, portfolio, execution, or automatic action was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
