#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const inputFiles = [
  'data/india-input/NIFTY 50-01-01-2024-to-31-12-2024.csv',
  'data/india-input/NIFTY 50-01-01-2025-to-31-12-2025.csv',
  'data/india-input/NIFTY 50-01-01-2026-to-08-09-2026.csv'
];

const outputCsv = 'data/india-input/nifty50-nse-daily-normalized.csv';
const outputAudit = 'data/india-analysis/nifty50-nse-daily-quality-report.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');

  row.push(cell);
  if (row.some((item) => item.trim() !== '')) rows.push(row);

  assert(rows.length >= 2, 'CSV needs a header and at least one row.');
  return rows;
}

function headerKey(value) {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function number(value, field, file, rowNumber) {
  const parsed = Number(value.replace(/,/g, '').trim());

  if (!Number.isFinite(parsed)) {
    throw new Error(`${file} row ${rowNumber}: invalid ${field} "${value}".`);
  }

  return parsed;
}

function parseNseDate(raw, file, rowNumber) {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());

  if (!match) {
    throw new Error(`${file} row ${rowNumber}: unsupported Date "${raw}". Expected DD-MMM-YYYY.`);
  }

  const months = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  };

  const day = Number(match[1]);
  const month = months[match[2].toUpperCase()];
  const year = Number(match[3]);

  if (month === undefined) {
    throw new Error(`${file} row ${rowNumber}: invalid month "${match[2]}".`);
  }

  const utcCheck = new Date(Date.UTC(year, month, day));

  if (
    utcCheck.getUTCFullYear() !== year ||
    utcCheck.getUTCMonth() !== month ||
    utcCheck.getUTCDate() !== day
  ) {
    throw new Error(`${file} row ${rowNumber}: invalid calendar date "${raw}".`);
  }

  const yyyy = String(year);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  return {
    date: `${yyyy}-${mm}-${dd}`,
    timestamp: `${yyyy}-${mm}-${dd}T15:30:00+05:30`
  };
}

function loadFile(relativePath) {
  assert(fs.existsSync(relativePath), `Missing input CSV: ${relativePath}`);

  const rows = parseCsv(fs.readFileSync(relativePath, 'utf8'));
  const header = rows[0].map(headerKey);
  const expected = ['date', 'open', 'high', 'low', 'close', 'shares traded'];

  for (const name of expected) {
    assert(header.includes(name), `${relativePath}: missing expected "${name}" header.`);
  }

  const positions = Object.fromEntries(header.map((name, index) => [name, index]));

  return rows.slice(1).map((cells, index) => {
    const rowNumber = index + 2;

    assert(
      cells.length === header.length,
      `${relativePath} row ${rowNumber}: expected ${header.length} columns, got ${cells.length}.`
    );

    const date = parseNseDate(cells[positions.date], relativePath, rowNumber);
    const open = number(cells[positions.open], 'Open', relativePath, rowNumber);
    const high = number(cells[positions.high], 'High', relativePath, rowNumber);
    const low = number(cells[positions.low], 'Low', relativePath, rowNumber);
    const close = number(cells[positions.close], 'Close', relativePath, rowNumber);
    const volume = number(cells[positions['shares traded']], 'Shares Traded', relativePath, rowNumber);

    assert(high >= low, `${relativePath} row ${rowNumber}: High < Low.`);
    assert(high >= Math.max(open, close), `${relativePath} row ${rowNumber}: High below Open/Close.`);
    assert(low <= Math.min(open, close), `${relativePath} row ${rowNumber}: Low above Open/Close.`);
    assert(volume >= 0, `${relativePath} row ${rowNumber}: Shares Traded is negative.`);

    return {
      date: date.date,
      timestamp: date.timestamp,
      open,
      high,
      low,
      close,
      volume,
      sourceFile: path.basename(relativePath),
      sourceRow: rowNumber
    };
  });
}

function businessDaysBetween(previousDate, currentDate) {
  const previous = new Date(`${previousDate}T00:00:00Z`);
  const current = new Date(`${currentDate}T00:00:00Z`);
  const missing = [];

  for (
    let cursor = new Date(previous.getTime() + 86_400_000);
    cursor < current;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) missing.push(cursor.toISOString().slice(0, 10));
  }

  return missing;
}

function csvEscape(value) {
  const text = String(value);
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rows = inputFiles.flatMap(loadFile).sort((a, b) => a.date.localeCompare(b.date));
const duplicateDates = [];
const gaps = [];

for (let index = 1; index < rows.length; index += 1) {
  if (rows[index].date === rows[index - 1].date) {
    duplicateDates.push({
      date: rows[index].date,
      first: { file: rows[index - 1].sourceFile, row: rows[index - 1].sourceRow },
      duplicate: { file: rows[index].sourceFile, row: rows[index].sourceRow }
    });
  }

  const gapDays = businessDaysBetween(rows[index - 1].date, rows[index].date);
  if (gapDays.length > 0) {
    gaps.push({
      after: rows[index - 1].date,
      before: rows[index].date,
      weekdayDatesWithoutRows: gapDays
    });
  }
}

assert(duplicateDates.length === 0, `Duplicate daily dates found: ${JSON.stringify(duplicateDates, null, 2)}`);
assert(rows.length >= 200, `Need at least 200 daily rows; found ${rows.length}.`);

const normalized = [
  'timestamp,open,high,low,close,volume',
  ...rows.map((row) => [
    row.timestamp,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume
  ].map(csvEscape).join(','))
].join('\n') + '\n';

fs.writeFileSync(outputCsv, normalized, 'utf8');

const audit = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  researchOnly: true,
  executionAllowed: false,
  brokerConnectivityAllowed: false,
  websocketAllowed: false,
  instrument: {
    label: 'NIFTY 50 Cash Index',
    exchange: 'NSE',
    source: 'Locally supplied NSE historical-index CSV exports'
  },
  sourceFiles: inputFiles.map((file) => path.basename(file)),
  timestampConvention: 'Each official NSE daily OHLCV row is normalized as that NSE session close at 15:30:00+05:30.',
  inputRows: rows.length,
  outputRows: rows.length,
  chronologicalRange: {
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    firstTimestamp: rows[0].timestamp,
    lastTimestamp: rows.at(-1).timestamp
  },
  duplicateDates,
  weekdayGaps: gaps,
  noteOnGaps: 'Weekday gaps are reported for human review because exchange holidays/special sessions can be legitimate; they are not silently filled.',
  normalizedCsv: outputCsv
};

fs.mkdirSync(path.dirname(outputAudit), { recursive: true });
fs.writeFileSync(outputAudit, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

console.log('PASS: NSE NIFTY daily normalization complete.');
console.log(`Input daily rows: ${rows.length}`);
console.log(`Date range: ${rows[0].date} to ${rows.at(-1).date}`);
console.log(`Duplicate dates: ${duplicateDates.length}`);
console.log(`Weekday gaps reported for review: ${gaps.length}`);
console.log(`Normalized CSV: ${outputCsv}`);
console.log(`Quality audit: ${outputAudit}`);
console.log('Safety: local CSV only; no broker, WebSocket, order, or execution function was called.');
