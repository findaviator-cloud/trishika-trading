#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  INTRADAY_POLICY,
  aggregateIntradayBias,
  analyseIntradayTimeframe,
  delayedEligibleCandles,
  inspectMinuteCandles,
  loadRawMinuteCandles,
  resampleStrictIntraday,
  strictFullSessionCandles,
  writeIntradayMarkdown,
  writeJson
} from '../src/india/nifty_intraday_core.js';

function parseArgs(argv) {
  const output = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];

    if (!key.startsWith('--')) throw new Error(`Unexpected argument "${key}".`);

    const value = argv[index + 1];

    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);

    output[key.slice(2)] = value;
    index += 1;
  }

  return output;
}

function indiaTime(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const rawFile = path.resolve(args.csv || 'data/india-input/NIFTY 50_minute_data.csv');
  const asOf = args['as-of'] ? new Date(args['as-of']) : new Date();
  const delayMinutes = args['delay-minutes'] === undefined
    ? INTRADAY_POLICY.delayMinutes
    : Number(args['delay-minutes']);

  if (Number.isNaN(asOf.getTime())) {
    throw new Error('--as-of must be a valid ISO-8601 timestamp with timezone.');
  }

  if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 1440) {
    throw new Error('--delay-minutes must be an integer from 0 to 1440.');
  }

  const watchlist = JSON.parse(
    fs.readFileSync(path.resolve('config/indian-watchlist.json'), 'utf8')
  );

  if (
    watchlist.executionAllowed !== false ||
    watchlist.brokerConnectivityAllowed !== false ||
    watchlist.websocketAllowed !== false
  ) {
    throw new Error('Refusing: global research-only safety policy is not intact.');
  }

  const nifty = watchlist.instruments.find((item) => item.id === 'NIFTY');

  if (!nifty || nifty.executionAllowed !== false || nifty.researchOnly !== true) {
    throw new Error('Refusing: NIFTY research-only safety policy is not intact.');
  }

  const rawCandles = loadRawMinuteCandles(rawFile);
  const inspection = inspectMinuteCandles(rawCandles);

  if (inspection.duplicates.length > 0 || inspection.outOfOrder.length > 0) {
    throw new Error('Refusing: raw minute data has duplicate or out-of-order timestamps.');
  }

  const fullSession = strictFullSessionCandles(rawCandles, inspection);
  const eligible = delayedEligibleCandles(fullSession, asOf, delayMinutes);

  if (eligible.candles.length === 0) {
    throw new Error(
      `No eligible candles before delayed cutoff ${eligible.cutoff.toISOString()}. ` +
      'Use --as-of after the data coverage or inspect source dates.'
    );
  }

  const timeframes = {};

  for (const timeframe of ['1H', '2H', '4H']) {
    const bars = resampleStrictIntraday(eligible.candles, timeframe);
    timeframes[timeframe] = analyseIntradayTimeframe(bars, timeframe);
  }

  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    disclaimer: 'Educational/research output only. Not a recommendation, trade instruction, order, or execution system.',
    instrument: {
      id: 'NIFTY',
      label: 'NIFTY 50 Cash Index',
      assetClass: 'INDEX',
      exchange: 'NSE',
      segment: 'NSE_INDEX',
      sourceIdentity: 'Third-party historical NIFTY 50 minute dataset; source identity cannot be independently proven from CSV columns alone.'
    },
    source: {
      tier: INTRADAY_POLICY.sourceTier,
      rawFile: path.basename(rawFile),
      timezone: INTRADAY_POLICY.timezone,
      timezoneEvidence: INTRADAY_POLICY.timezoneEvidence,
      timestampConvention: INTRADAY_POLICY.timestampConvention,
      rawMinuteCandles: inspection.rawCandleCount,
      strictFullSessionDays: inspection.strictFullSessionDays,
      eligibleMinuteCandles: eligible.candles.length,
      irregularSessionDaysExcluded: inspection.irregularSessionDays.length,
      volumeStatus: inspection.allVolumeZero ? 'UNUSABLE_ALL_ZERO_OHLC_ONLY' : 'AVAILABLE',
      dataEndLocal: inspection.coverage.lastLocalTimestamp,
      dataEndUtc: inspection.coverage.lastUtcTimestamp,
      freshnessContract: {
        source: 'THIRD_PARTY_HISTORICAL_NIFTY_50_1_MINUTE_CSV',
        dataEnd: inspection.coverage.lastLocalTimestamp,
        freshnessStatus: eligible.cutoff.getTime() > new Date(inspection.coverage.lastUtcTimestamp).getTime()
          ? 'STALE'
          : 'HISTORICAL_FOR_AS_OF',
        timezone: INTRADAY_POLICY.timezone,
        timezoneEvidence: 'INFERRED_FROM_SESSION_PATTERN',
        candleSemantics: 'CANDLE_OPEN_TIME',
        volume: inspection.allVolumeZero ? 'UNAVAILABLE_ALL_ZERO' : 'AVAILABLE',
        sessionPolicy: 'STRICT_FULL_SESSION_ONLY',
        lookaheadDelayMinutes: delayMinutes,
        researchOnly: true,
        executionAllowed: false,
        brokerConnectivityAllowed: false,
        websocketAllowed: false
      }
    },
    cutoff: {
      asOfUtc: asOf.toISOString(),
      delayMinutes,
      cutoffUtc: eligible.cutoff.toISOString(),
      cutoffIndia: indiaTime(eligible.cutoff),
      convention: 'Each source timestamp is treated as minute candle-open time; its close is timestamp + 1 minute.'
    },
    aggregate: aggregateIntradayBias(timeframes),
    timeframes
  };

  const stamp = asOf.toISOString().replace(/[:.]/g, '-');
  const base = path.resolve('data/india-analysis', `nifty50_intraday_research_${stamp}`);
  writeJson(`${base}.json`, report);
  writeIntradayMarkdown(report, `${base}.md`);

  console.log('PASS: NIFTY intraday research report generated.');
  console.log(`As-of UTC: ${report.cutoff.asOfUtc}`);
  console.log(`Delayed cutoff IST: ${report.cutoff.cutoffIndia}`);
  console.log(`Strict full-session days retained: ${report.source.strictFullSessionDays}`);
  console.log(`Eligible minute candles: ${report.source.eligibleMinuteCandles}`);
  console.log(`1H: ${timeframes['1H'].bias} | bars=${timeframes['1H'].candleCount} | SMA200=${timeframes['1H'].indicators.sma200}`);
  console.log(`2H: ${timeframes['2H'].bias} | bars=${timeframes['2H'].candleCount} | SMA200=${timeframes['2H'].indicators.sma200}`);
  console.log(`4H: ${timeframes['4H'].bias} | bars=${timeframes['4H'].candleCount} | SMA200=${timeframes['4H'].indicators.sma200}`);
  console.log(`Aggregate: ${report.aggregate.bias}`);
  console.log(`JSON: ${base}.json`);
  console.log(`Markdown: ${base}.md`);
  console.log('Safety: offline third-party historical CSV only; no Angel One, broker, WebSocket, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
