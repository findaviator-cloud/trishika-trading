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
const OUTPUT_BASE = path.resolve('data/india-analysis/nifty50-daily-intraday-reconciliation');
const TOLERANCE_POINTS = 0.05;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  assert(lines.length >= 2, 'Daily normalized CSV requires header plus rows.');

  const header = lines[0].replace(/^\uFEFF/, '').split(',').map((value) => value.trim().toLowerCase());
  const needed = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];

  for (const key of needed) {
    assert(header.includes(key), `Daily normalized CSV missing "${key}".`);
  }

  const index = Object.fromEntries(header.map((key, position) => [key, position]));

  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(',');
    assert(cells.length === header.length, `Daily row ${rowIndex + 2}: malformed column count.`);

    const timestamp = cells[index.timestamp].trim();
    const match = /^(\d{4}-\d{2}-\d{2})T15:30:00\+05:30$/.exec(timestamp);

    assert(
      match,
      `Daily row ${rowIndex + 2}: expected normalized NSE close timestamp, got "${timestamp}".`
    );

    const close = Number(cells[index.close]);

    assert(Number.isFinite(close), `Daily row ${rowIndex + 2}: invalid close.`);

    return {
      date: match[1],
      close,
      timestamp,
      sourceRow: rowIndex + 2
    };
  });
}

function writeMarkdown(report, outputPath) {
  const lines = [
    '# NIFTY 50 Daily vs Intraday Close Reconciliation',
    '',
    `Generated UTC: ${report.generatedAtUtc}`,
    `Research only: ${report.researchOnly}`,
    `Execution allowed: ${report.executionAllowed}`,
    '',
    '## Comparison Rule',
    '',
    '- Daily source: locally normalized official NSE NIFTY 50 daily OHLCV export.',
    '- Intraday source: third-party NIFTY 50 one-minute historical CSV.',
    '- Intraday comparison point: 15:29 one-minute candle close, treated as the final candle of the 09:15–15:30 session.',
    `- Strict intraday eligibility: exactly ${INTRADAY_POLICY.expectedMinuteBarsPerRegularSession} unique regular-session minute bars.`,
    `- Acceptance tolerance: absolute close difference <= ${report.tolerancePoints} index points.`,
    '- This is a source-consistency audit only, not market analysis or a trading signal.',
    '',
    '## Summary',
    '',
    `- Daily rows available: ${report.summary.dailyRows}`,
    `- Intraday strict full-session dates: ${report.summary.intradayStrictFullSessionDates}`,
    `- Overlap dates compared: ${report.summary.compared}`,
    `- PASS within tolerance: ${report.summary.pass}`,
    `- REVIEW above tolerance: ${report.summary.review}`,
    `- Daily dates without eligible intraday counterpart: ${report.summary.dailyWithoutIntraday}`,
    `- Strict intraday dates without daily counterpart: ${report.summary.intradayWithoutDaily}`,
    `- Maximum absolute difference: ${report.summary.maxAbsoluteDifference}`,
    `- Mean absolute difference: ${report.summary.meanAbsoluteDifference}`,
    `- Overall result: ${report.summary.result}`,
    '',
    '## Review Samples',
    ''
  ];

  if (report.reviewSamples.length === 0) {
    lines.push('- None. All compared strict-session closes were within tolerance.');
  } else {
    for (const item of report.reviewSamples) {
      lines.push(
        `- ${item.date}: daily=${item.dailyClose}, intraday15_29=${item.intradayClose}, ` +
        `difference=${item.difference}, absoluteDifference=${item.absoluteDifference}`
      );
    }
  }

  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- Offline local CSV audit only.');
  lines.push('- No Angel One login, broker API, WebSocket, market request, order, portfolio, position, funds, paper execution, or live-capital function was used.');
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

try {
  assert(fs.existsSync(DAILY_FILE), `Missing daily normalized CSV: ${DAILY_FILE}`);
  assert(fs.existsSync(MINUTE_FILE), `Missing intraday minute CSV: ${MINUTE_FILE}`);

  const dailyRows = parseCsv(fs.readFileSync(DAILY_FILE, 'utf8'));
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));

  assert(dailyByDate.size === dailyRows.length, 'Daily normalized CSV contains duplicate dates.');

  const minuteCandles = loadRawMinuteCandles(MINUTE_FILE);
  const minuteInspection = inspectMinuteCandles(minuteCandles);

  assert(
    minuteInspection.duplicates.length === 0,
    'Intraday input has duplicate timestamps; reconciliation refused.'
  );

  assert(
    minuteInspection.outOfOrder.length === 0,
    'Intraday input has out-of-order timestamps; reconciliation refused.'
  );

  const fullDates = new Set(minuteInspection.fullSessionDates);
  const intradayCloseByDate = new Map();

  for (const candle of minuteCandles) {
    if (
      fullDates.has(candle.date) &&
      sessionMinuteIndex(candle) === 374 &&
      candle.second === 0
    ) {
      intradayCloseByDate.set(candle.date, candle);
    }
  }

  assert(
    intradayCloseByDate.size === minuteInspection.strictFullSessionDays,
    'Expected exactly one 15:29 close per strict full intraday session.'
  );

  const comparisons = [];
  const dailyWithoutIntraday = [];

  for (const daily of dailyRows) {
    const intraday = intradayCloseByDate.get(daily.date);

    if (!intraday) {
      dailyWithoutIntraday.push(daily.date);
      continue;
    }

    const difference = intraday.close - daily.close;
    const absoluteDifference = Math.abs(difference);

    comparisons.push({
      date: daily.date,
      dailyClose: daily.close,
      intradayClose: intraday.close,
      difference: Number(difference.toFixed(4)),
      absoluteDifference: Number(absoluteDifference.toFixed(4)),
      result: absoluteDifference <= TOLERANCE_POINTS ? 'PASS' : 'REVIEW'
    });
  }

  const intradayWithoutDaily = [...intradayCloseByDate.keys()]
    .filter((date) => !dailyByDate.has(date))
    .sort();

  const pass = comparisons.filter((item) => item.result === 'PASS').length;
  const reviewRows = comparisons.filter((item) => item.result === 'REVIEW');
  const maxAbsoluteDifference = comparisons.length
    ? Math.max(...comparisons.map((item) => item.absoluteDifference))
    : null;
  const meanAbsoluteDifference = comparisons.length
    ? comparisons.reduce((total, item) => total + item.absoluteDifference, 0) / comparisons.length
    : null;

  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    purpose: 'Daily vs intraday source-consistency reconciliation only; not a trade signal.',
    tolerancePoints: TOLERANCE_POINTS,
    sources: {
      daily: {
        type: 'LOCAL_NORMALIZED_OFFICIAL_NSE_DAILY_CSV',
        file: path.basename(DAILY_FILE),
        timestampConvention: 'NSE daily close normalized to 15:30:00+05:30'
      },
      intraday: {
        type: INTRADAY_POLICY.sourceTier,
        file: path.basename(MINUTE_FILE),
        timezone: INTRADAY_POLICY.timezone,
        timezoneEvidence: INTRADAY_POLICY.timezoneEvidence,
        timestampConvention: INTRADAY_POLICY.timestampConvention,
        comparisonMinute: '15:29 candle-open timestamp; candle completes at 15:30 IST'
      }
    },
    summary: {
      dailyRows: dailyRows.length,
      intradayStrictFullSessionDates: minuteInspection.strictFullSessionDays,
      compared: comparisons.length,
      pass,
      review: reviewRows.length,
      dailyWithoutIntraday: dailyWithoutIntraday.length,
      intradayWithoutDaily: intradayWithoutDaily.length,
      maxAbsoluteDifference: maxAbsoluteDifference === null ? null : Number(maxAbsoluteDifference.toFixed(4)),
      meanAbsoluteDifference: meanAbsoluteDifference === null ? null : Number(meanAbsoluteDifference.toFixed(4)),
      result: comparisons.length === 0
        ? 'NO_OVERLAP'
        : reviewRows.length === 0
          ? 'PASS'
          : 'REVIEW'
    },
    reviewSamples: reviewRows.slice(0, 50),
    dailyWithoutIntradaySample: dailyWithoutIntraday.slice(0, 50),
    intradayWithoutDailySample: intradayWithoutDaily.slice(0, 50),
    comparisons
  };

  writeJson(`${OUTPUT_BASE}.json`, report);
  writeMarkdown(report, `${OUTPUT_BASE}.md`);

  console.log('PASS: NIFTY daily-vs-intraday reconciliation completed.');
  console.log(`Daily rows: ${report.summary.dailyRows}`);
  console.log(`Intraday strict full-session dates: ${report.summary.intradayStrictFullSessionDates}`);
  console.log(`Overlap dates compared: ${report.summary.compared}`);
  console.log(`PASS within ${TOLERANCE_POINTS} points: ${report.summary.pass}`);
  console.log(`REVIEW above tolerance: ${report.summary.review}`);
  console.log(`Maximum absolute difference: ${report.summary.maxAbsoluteDifference}`);
  console.log(`Mean absolute difference: ${report.summary.meanAbsoluteDifference}`);
  console.log(`Overall reconciliation: ${report.summary.result}`);
  console.log(`JSON: ${OUTPUT_BASE}.json`);
  console.log(`Markdown: ${OUTPUT_BASE}.md`);
  console.log('Safety: offline CSV audit only; no broker, WebSocket, order, or execution function was called.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
