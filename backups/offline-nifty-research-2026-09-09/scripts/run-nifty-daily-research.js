#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  analyseTimeframe,
  normalizeCandles,
  parseCsv
} from '../src/india/indian_mtf_core.js';

const watchlistPath = path.resolve('config/indian-watchlist.json');
const inputCsv = path.resolve('data/india-input/nifty50-nse-daily-normalized.csv');
const auditPath = path.resolve('data/india-analysis/nifty50-nse-daily-quality-report.json');
const outputDir = path.resolve('data/india-analysis');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeDailyOnlyReport(report, outputDirectory, stem) {
  fs.mkdirSync(outputDirectory, { recursive: true });

  const jsonPath = path.join(outputDirectory, `${stem}.json`);
  const markdownPath = path.join(outputDirectory, `${stem}.md`);
  const daily = report.timeframes['1D'];
  const channel = daily.indicators.donchian20;

  const markdown = [
    `# NIFTY 50 Cash Index — Daily Research Report`,
    '',
    `Generated (UTC): ${report.generatedAtUtc}`,
    `Research only: ${report.researchOnly}`,
    `Execution allowed: ${report.executionAllowed}`,
    '',
    '## Scope',
    '',
    '- Source frequency: 1D official NSE historical-index OHLCV data.',
    '- Available analysis: 1D only.',
    '- Not available: 1H, 2H, 4H. Daily rows are not converted into fabricated intraday candles.',
    '- No intraday delay is applied or implied; every normalized row represents a completed NSE daily session close.',
    '',
    '## Instrument',
    '',
    `- Label: ${report.instrument.label}`,
    `- Exchange / Segment: ${report.instrument.exchange} / ${report.instrument.segment}`,
    `- Symbol: ${report.instrument.symbol}`,
    `- Dataset identifier: ${report.instrument.token}`,
    `- Instrument status: ${report.instrument.status}`,
    '',
    '## Data Quality',
    '',
    `- Normalized daily candles: ${report.source.rawCandleCount}`,
    `- First completed candle (UTC): ${report.source.firstCandleUtc}`,
    `- Latest completed candle (UTC): ${report.source.latestCandleUtc}`,
    `- Latest NSE daily close timestamp: ${report.source.latestCandleNseClose}`,
    `- Quality audit: ${report.source.qualityAudit}`,
    '',
    '## Daily Research View',
    '',
    `- Bias: ${daily.bias}`,
    `- Reason: ${daily.reason}`,
    `- Last close: ${daily.lastCandle.close}`,
    `- Last candle timestamp: ${daily.lastCandle.timestampIndia}`,
    `- SMA(200): ${daily.indicators.sma200 ?? 'Insufficient history'}`,
    `- ATR(14): ${daily.indicators.atr14 ?? 'Insufficient history'}`,
    `- Donchian(20): ${
      channel
        ? `upper ${channel.upper}, lower ${channel.lower}`
        : 'Insufficient history'
    }`,
    '',
    '## Safety',
    '',
    '- Educational/research output only; it is not a trade instruction or investment recommendation.',
    '- No Angel One login, broker request, WebSocket, order, portfolio, position, funds, or execution function was used.',
    '- Human review remains mandatory.',
    ''
  ].join('\n');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdown, 'utf8');

  return { jsonPath, markdownPath };
}

function toDailyTimestamp(row, rowNumber) {
  const raw = row.timestamp;

  if (!/T15:30:00\+05:30$/.test(raw)) {
    throw new Error(
      `Row ${rowNumber}: expected a normalized NSE daily close timestamp ending in T15:30:00+05:30; got "${raw}".`
    );
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Row ${rowNumber}: invalid timestamp "${raw}".`);
  }

  return parsed;
}

try {
  assert(fs.existsSync(watchlistPath), `Missing watchlist: ${watchlistPath}`);
  assert(fs.existsSync(inputCsv), `Missing normalized CSV: ${inputCsv}`);
  assert(fs.existsSync(auditPath), `Missing quality audit: ${auditPath}`);

  const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));

  assert(watchlist.executionAllowed === false, 'Global execution policy must remain false.');
  assert(watchlist.brokerConnectivityAllowed === false, 'Global broker connectivity policy must remain false.');
  assert(watchlist.websocketAllowed === false, 'Global WebSocket policy must remain false.');

  const instrument = watchlist.instruments.find((item) => item.id === 'NIFTY');

  assert(instrument, 'NIFTY instrument was not found in watchlist.');
  assert(instrument.enabled === true, 'NIFTY must be enabled only as verified offline cash-index research data.');
  assert(instrument.status === 'VERIFIED', 'NIFTY status must be VERIFIED.');
  assert(instrument.assetClass === 'INDEX', 'NIFTY daily runner supports only the cash-index instrument.');
  assert(instrument.exchange === 'NSE', 'NIFTY daily runner expects NSE.');
  assert(instrument.segment === 'NSE_INDEX', 'NIFTY daily runner expects NSE_INDEX.');
  assert(instrument.researchOnly === true, 'NIFTY must remain researchOnly=true.');
  assert(instrument.executionAllowed === false, 'NIFTY executionAllowed must remain false.');

  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert(audit.duplicateDates.length === 0, 'Quality audit contains duplicate dates.');
  assert(audit.outputRows >= 200, 'Need at least 200 normalized daily rows.');

  const parsedRows = parseCsv(fs.readFileSync(inputCsv, 'utf8'));
  const candles = normalizeCandles(parsedRows).map((candle, index) => ({
    ...candle,
    timestamp: toDailyTimestamp(parsedRows[index], index + 2),
    timestampIso: toDailyTimestamp(parsedRows[index], index + 2).toISOString(),
    localTime: parsedRows[index].timestamp
  }));

  assert(candles.length >= 200, `Need >=200 daily candles; found ${candles.length}.`);

  const daily = analyseTimeframe(
    candles.map((candle) => ({
      ...candle,
      sourceCandleCount: 1
    })),
    '1D'
  );

  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    disclaimer: 'Educational/research output only. Not a trade instruction, recommendation, order, or execution system.',
    scope: {
      dataFrequency: '1D only',
      supportedTimeframesInThisRun: ['1D'],
      unavailableTimeframes: ['1H', '2H', '4H'],
      unavailableReason: 'The source files contain official daily OHLCV rows. Intraday candles are not fabricated from daily data.'
    },
    source: {
      type: 'LOCAL_NSE_DAILY_CSV',
      normalizedFile: path.basename(inputCsv),
      qualityAudit: path.basename(auditPath),
      rawCandleCount: candles.length,
      firstCandleUtc: candles[0].timestampIso,
      latestCandleUtc: candles.at(-1).timestampIso,
      latestCandleNseClose: candles.at(-1).localTime
    },
    cutoff: {
      marketTimezone: 'Asia/Kolkata',
      delayMinutes: 0,
      cutoffUtc: candles.at(-1).timestampIso,
      cutoffIndia: candles.at(-1).localTime,
      policy: 'Daily-only completed NSE session candles. No intraday delay is applied or implied.'
    },
    instrument: {
      id: instrument.id,
      label: instrument.label,
      assetClass: instrument.assetClass,
      exchange: instrument.exchange,
      segment: instrument.segment,
      symbol: instrument.symbol,
      token: instrument.token,
      expiry: instrument.expiry,
      currency: instrument.currency,
      status: instrument.status
    },
    aggregate: {
      bias: daily.bias === 'LONG_BIAS'
        ? 'LONG_RESEARCH_BIAS'
        : daily.bias === 'SHORT_BIAS'
          ? 'SHORT_RESEARCH_BIAS'
          : daily.bias === 'NEUTRAL'
            ? 'NEUTRAL_RESEARCH_BIAS'
            : 'INSUFFICIENT_DAILY_HISTORY',
      reason: `Daily-only research result: ${daily.reason}`
    },
    timeframes: {
      '1D': daily
    }
  };

  const stem = `nifty50_nse_daily_research_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const output = writeDailyOnlyReport(report, outputDir, stem);

  console.log('PASS: NIFTY 50 cash-index daily research report generated.');
  console.log(`Daily candles: ${candles.length}`);
  console.log(`1D bias: ${daily.bias}`);
  console.log(`SMA(200): ${daily.indicators.sma200}`);
  console.log(`ATR(14): ${daily.indicators.atr14}`);
  console.log(`Donchian(20): ${JSON.stringify(daily.indicators.donchian20)}`);
  console.log(`JSON: ${output.jsonPath}`);
  console.log(`Markdown: ${output.markdownPath}`);
  console.log('Safety: daily local CSV only; no Angel One, WebSocket, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
