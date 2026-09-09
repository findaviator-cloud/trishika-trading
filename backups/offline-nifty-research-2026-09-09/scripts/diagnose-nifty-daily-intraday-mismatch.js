#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  INTRADAY_POLICY,
  inspectMinuteCandles,
  loadRawMinuteCandles,
  sessionMinuteIndex,
  writeJson
} from '../src/india/nifty_intraday_core.js';

const DAILY_FILE = path.resolve('data/india-input/nifty50-nse-daily-normalized.csv');
const MINUTE_FILE = path.resolve('data/india-input/NIFTY 50_minute_data.csv');
const OUTPUT_DIR = path.resolve('data/india-analysis');
const BASE_NAME = 'nifty50-largest-mismatch-diagnostic';
const TOLERANCE_POINTS = 0.05;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseSimpleCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  assert(lines.length >= 2, 'Daily normalized CSV needs a header plus rows.');

  const header = lines[0].replace(/^\uFEFF/, '').split(',').map((value) => value.trim().toLowerCase());
  const required = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];

  for (const field of required) {
    assert(header.includes(field), `Daily normalized CSV missing "${field}".`);
  }

  const index = Object.fromEntries(header.map((name, position) => [name, position]));

  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(',');

    assert(cells.length === header.length, `Daily row ${rowIndex + 2}: malformed CSV row.`);

    const timestamp = cells[index.timestamp].trim();
    const match = /^(\d{4}-\d{2}-\d{2})T15:30:00\+05:30$/.exec(timestamp);

    assert(
      match,
      `Daily row ${rowIndex + 2}: expected timestamp YYYY-MM-DDT15:30:00+05:30, got "${timestamp}".`
    );

    const result = {
      date: match[1],
      timestamp,
      sourceRow: rowIndex + 2
    };

    for (const field of ['open', 'high', 'low', 'close', 'volume']) {
      const value = Number(cells[index[field]]);
      assert(Number.isFinite(value), `Daily row ${rowIndex + 2}: invalid ${field}.`);
      result[field] = value;
    }

    return result;
  });
}

function rounded(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function classify(value) {
  return Math.abs(value) <= TOLERANCE_POINTS ? 'PASS' : 'REVIEW';
}

function writeCsv(filePath, rows) {
  const fields = [
    'date',
    'official_open',
    'official_high',
    'official_low',
    'official_close',
    'intraday_open_09_15',
    'intraday_high',
    'intraday_low',
    'intraday_15_28_close',
    'intraday_15_29_close',
    'intraday_last_available_close',
    'intraday_last_available_timestamp',
    'session_derived_close',
    'close_diff_15_29',
    'abs_close_diff_15_29',
    'high_diff',
    'low_diff',
    'result_15_29',
    'result_15_28',
    'result_last_available',
    'result_session_derived',
    'strict_full_session'
  ];

  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const body = [
    fields.join(','),
    ...rows.map((row) => fields.map((field) => escape(row[field])).join(','))
  ].join('\n') + '\n';

  fs.writeFileSync(filePath, body, 'utf8');
}

function summarizeAlternative(rows, field) {
  const comparable = rows.filter((row) => Number.isFinite(row[field]));
  const pass = comparable.filter((row) => Math.abs(row[field] - row.official_close) <= TOLERANCE_POINTS).length;
  const differences = comparable.map((row) => Math.abs(row[field] - row.official_close));

  return {
    compared: comparable.length,
    pass,
    review: comparable.length - pass,
    maxAbsoluteDifference: differences.length ? rounded(Math.max(...differences)) : null,
    meanAbsoluteDifference: differences.length
      ? rounded(differences.reduce((sum, value) => sum + value, 0) / differences.length)
      : null
  };
}

function writeMarkdown(report, outputPath) {
  const lines = [
    '# NIFTY 50 Largest Daily-vs-Intraday Mismatch Diagnostic',
    '',
    `Generated UTC: ${report.generatedAtUtc}`,
    `Purpose: ${report.purpose}`,
    '',
    '## Data Contract',
    '',
    `- Official daily source: ${report.sources.daily.file}`,
    `- Intraday source: ${report.sources.intraday.file}`,
    `- Intraday timestamp convention tested: ${report.sources.intraday.timestampConvention}`,
    `- Intraday timezone: ${report.sources.intraday.timezone}`,
    `- Session policy: ${report.sources.intraday.sessionPolicy}`,
    `- Strict full session: ${INTRADAY_POLICY.expectedMinuteBarsPerRegularSession} unique minute observations from 09:15 through 15:29.`,
    `- Tolerance: ${report.tolerancePoints} NIFTY points.`,
    '',
    '## Alternative Close Tests',
    '',
    '| Alternative | Compared | Pass | Review | Mean absolute difference | Maximum absolute difference |',
    '|---|---:|---:|---:|---:|---:|'
  ];

  for (const [name, summary] of Object.entries(report.alternativeSummaries)) {
    lines.push(
      `| ${name} | ${summary.compared} | ${summary.pass} | ${summary.review} | ` +
      `${summary.meanAbsoluteDifference} | ${summary.maxAbsoluteDifference} |`
    );
  }

  lines.push('');
  lines.push('## Largest 20 Close Mismatches');
  lines.push('');
  lines.push('| Date | Official close | 15:29 close | Close diff | Absolute diff | Official high | Intraday high | High diff | Official low | Intraday low | Low diff |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

  for (const row of report.largestCloseMismatchSamples) {
    lines.push(
      `| ${row.date} | ${row.official_close} | ${row.intraday_15_29_close} | ` +
      `${row.close_diff_15_29} | ${row.abs_close_diff_15_29} | ` +
      `${row.official_high} | ${row.intraday_high} | ${row.high_diff} | ` +
      `${row.official_low} | ${row.intraday_low} | ${row.low_diff} |`
    );
  }

  lines.push('');
  lines.push('## Interpretation Guardrails');
  lines.push('');
  lines.push('- This diagnostic does not change source timestamps, select a new close convention, or modify existing research calculations.');
  lines.push('- A lower mismatch under an alternative is evidence to investigate source documentation; it is not permission to silently alter production logic.');
  lines.push('- If no alternative reconciles consistently, the correct conclusion is UNEXPLAINED_SOURCE_DISCREPANCY.');
  lines.push('- The third-party intraday source remains structurally valid but not reference-reconciled, historical-only, stale in 2026, and prohibited for current intraday context.');
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- Local CSV read-only diagnostic only.');
  lines.push('- No Angel One login, broker API, WebSocket, market request, order, position, portfolio, funds, paper execution, automatic trading, or live-capital function was used.');
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

try {
  assert(fs.existsSync(DAILY_FILE), `Missing daily normalized CSV: ${DAILY_FILE}`);
  assert(fs.existsSync(MINUTE_FILE), `Missing intraday minute CSV: ${MINUTE_FILE}`);

  const dailyRows = parseSimpleCsv(fs.readFileSync(DAILY_FILE, 'utf8'));
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));

  assert(dailyByDate.size === dailyRows.length, 'Daily file has duplicate dates.');

  const minuteCandles = loadRawMinuteCandles(MINUTE_FILE);
  const inspection = inspectMinuteCandles(minuteCandles);

  assert(inspection.duplicates.length === 0, 'Minute file has duplicate timestamps; diagnostic refused.');
  assert(inspection.outOfOrder.length === 0, 'Minute file has out-of-order rows; diagnostic refused.');

  const strictDates = new Set(inspection.fullSessionDates);
  const minuteByDate = new Map();

  for (const candle of minuteCandles) {
    if (!strictDates.has(candle.date)) continue;

    const day = minuteByDate.get(candle.date) || [];
    day.push(candle);
    minuteByDate.set(candle.date, day);
  }

  const rows = [];

  for (const [date, dayCandles] of minuteByDate) {
    const official = dailyByDate.get(date);
    if (!official) continue;

    const byIndex = new Map(dayCandles.map((candle) => [sessionMinuteIndex(candle), candle]));
    const open0915 = byIndex.get(0);
    const close1528 = byIndex.get(373);
    const close1529 = byIndex.get(374);
    const last = dayCandles.at(-1);

    assert(open0915 && close1529, `Strict session ${date} lacks expected boundary minutes.`);

    const intradayHigh = Math.max(...dayCandles.map((candle) => candle.high));
    const intradayLow = Math.min(...dayCandles.map((candle) => candle.low));
    const sessionDerivedClose = close1529.close;

    const closeDiff = close1529.close - official.close;
    const highDiff = intradayHigh - official.high;
    const lowDiff = intradayLow - official.low;

    rows.push({
      date,
      official_open: official.open,
      official_high: official.high,
      official_low: official.low,
      official_close: official.close,
      intraday_open_09_15: open0915.open,
      intraday_high: rounded(intradayHigh),
      intraday_low: rounded(intradayLow),
      intraday_15_28_close: close1528 ? close1528.close : null,
      intraday_15_29_close: close1529.close,
      intraday_last_available_close: last.close,
      intraday_last_available_timestamp: last.raw,
      session_derived_close: sessionDerivedClose,
      close_diff_15_29: rounded(closeDiff),
      abs_close_diff_15_29: rounded(Math.abs(closeDiff)),
      high_diff: rounded(highDiff),
      low_diff: rounded(lowDiff),
      result_15_29: classify(close1529.close - official.close),
      result_15_28: close1528 ? classify(close1528.close - official.close) : 'NO_DATA',
      result_last_available: classify(last.close - official.close),
      result_session_derived: classify(sessionDerivedClose - official.close),
      strict_full_session: true
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  const alternatives = {
    '15:29 close': summarizeAlternative(rows, 'intraday_15_29_close'),
    '15:28 close': summarizeAlternative(rows, 'intraday_15_28_close'),
    'Last available close': summarizeAlternative(rows, 'intraday_last_available_close'),
    'Session-derived close': summarizeAlternative(rows, 'session_derived_close')
  };

  const ranked = [...rows]
    .sort((a, b) => b.abs_close_diff_15_29 - a.abs_close_diff_15_29)
    .slice(0, 20);

  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    purpose: 'Read-only diagnostic of daily-vs-intraday source mismatch. Not market analysis, investment advice, or a trade signal.',
    tolerancePoints: TOLERANCE_POINTS,
    sources: {
      daily: {
        type: 'LOCAL_NORMALIZED_OFFICIAL_NSE_DAILY_CSV',
        file: path.basename(DAILY_FILE),
        timestampConvention: 'NSE daily close at 15:30:00+05:30'
      },
      intraday: {
        type: INTRADAY_POLICY.sourceTier,
        file: path.basename(MINUTE_FILE),
        timezone: INTRADAY_POLICY.timezone,
        timezoneEvidence: INTRADAY_POLICY.timezoneEvidence,
        timestampConvention: INTRADAY_POLICY.timestampConvention,
        sessionPolicy: 'STRICT_FULL_SESSION_ONLY',
        strictSessionMinuteRange: '09:15 through 15:29'
      }
    },
    alternativeSummaries: alternatives,
    largestCloseMismatchSamples: ranked,
    classification: (
      alternatives['15:29 close'].pass === rows.length
        ? 'REFERENCE_RECONCILED'
        : 'UNEXPLAINED_SOURCE_DISCREPANCY_PENDING_REVIEW'
    ),
    comparisons: rows
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(path.join(OUTPUT_DIR, `${BASE_NAME}.json`), report);
  writeCsv(path.join(OUTPUT_DIR, `${BASE_NAME}.csv`), rows);
  writeMarkdown(report, path.join(OUTPUT_DIR, `${BASE_NAME}.md`));

  const baseline = alternatives['15:29 close'];

  console.log('PASS: NIFTY largest-mismatch read-only diagnostic completed.');
  console.log(`Overlap strict-session dates compared: ${baseline.compared}`);
  console.log(`15:29 PASS within ${TOLERANCE_POINTS}: ${baseline.pass}`);
  console.log(`15:29 REVIEW: ${baseline.review}`);
  console.log(`15:29 mean absolute difference: ${baseline.meanAbsoluteDifference}`);
  console.log(`15:29 maximum absolute difference: ${baseline.maxAbsoluteDifference}`);

  for (const [label, result] of Object.entries(alternatives)) {
    console.log(
      `Alternative "${label}": pass=${result.pass}/${result.compared}, ` +
      `meanAbsDiff=${result.meanAbsoluteDifference}, maxAbsDiff=${result.maxAbsoluteDifference}`
    );
  }

  console.log(`Classification: ${report.classification}`);
  console.log(`JSON: ${path.join(OUTPUT_DIR, `${BASE_NAME}.json`)}`);
  console.log(`CSV: ${path.join(OUTPUT_DIR, `${BASE_NAME}.csv`)}`);
  console.log(`Markdown: ${path.join(OUTPUT_DIR, `${BASE_NAME}.md`)}`);
  console.log('Safety: local CSV read-only diagnostic only; no broker, WebSocket, order, or execution function was called.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
