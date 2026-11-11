// Virtual (paper) trading results. READ-ONLY. Koi order nahi.
// Data source: PAPER_RAW_BASE (GitHub raw URL of data/paper) agar set ho, warna repo ke andar data/paper/.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.resolve(here, '../../data/paper');
const RAW = (process.env.PAPER_RAW_BASE || '').replace(/\/$/, '');
const SAFETY = { researchOnly: true, paperOnly: true, ordersAllowed: false, executionAllowed: false };

async function readFile(name) {
  if (RAW) {
    const r = await fetch(`${RAW}/${name}?t=${Math.floor(Date.now() / 60000)}`);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.text();
  }
  return fs.promises.readFile(path.join(LOCAL, name), 'utf8');
}

function parseCsv(txt) {
  const [head, ...lines] = txt.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

router.get('/summary', async (_req, res) => {
  try { res.json({ ...JSON.parse(await readFile('summary.json')), api: SAFETY }); }
  catch (e) { res.status(404).json({ error: 'paper data abhi nahi bana (GitHub Actions ek baar chalne do)', detail: e.message, api: SAFETY }); }
});

router.get('/signals', async (_req, res) => {
  try { res.json(JSON.parse(await readFile('signals.json'))); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

router.get('/trades', async (req, res) => {
  try {
    let rows = parseCsv(await readFile('trades.csv'));
    if (req.query.sleeve) rows = rows.filter((r) => r.sleeve === req.query.sleeve);
    if (req.query.status) rows = rows.filter((r) => r.status === String(req.query.status).toUpperCase());
    const limit = Math.min(Number(req.query.limit) || 200, 5000);
    res.json({ count: rows.length, trades: rows.slice(-limit).reverse(), api: SAFETY });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get('/trades.csv', async (_req, res) => {
  try { res.type('text/csv').send(await readFile('trades.csv')); }
  catch (e) { res.status(404).send(e.message); }
});

router.get('/', async (_req, res) => {
  let s;
  try { s = JSON.parse(await readFile('summary.json')); } catch (e) { return res.status(404).send(`<h3>Paper data abhi nahi bana</h3><p>${e.message}</p>`); }
  let sigHtml = '';
  try {
    const sg = JSON.parse(await readFile('signals.json')).instruments || {};
    const pr = [];
    sigHtml = '<h3>Live candle + volatility</h3><table><tr><th>Symbol<th>TF<th>Candle (band)<th>Close pos %<th>Range/ATR<th>Shapes<th>Volatility</tr>' +
      Object.entries(sg).map(([k, v]) => ['candle_1h', 'candle_4h', 'candle_1d'].filter((c) => v[c]).map((c) =>
        `<tr><td>${k}<td>${c.slice(7)}<td>${v[c].candle_time}<td>${v[c].close_position_pct ?? '-'}<td>${v[c].range_vs_atr ?? '-'}<td>${v[c].shapes.join(', ') || '-'}<td>${v.volatility ? v.volatility.regime + ' (' + v.volatility.avg_daily_range_20d_bp + 'bp)' : '-'}</tr>`).join('')).join('') + '</table>';
    for (const [k, v] of Object.entries(sg)) for (const list of ['patterns_last_24h_on_4h', 'patterns_last_day_on_1h', 'patterns_last_5d_on_1d']) for (const p of v[list] || []) pr.push(`<tr><td>${k}<td>${p.timeframe}<td>${p.formed_at}<td>${p.kind}<td>${p.direction}<td>${p.role}<td>${p.stop}<td>${p.target}</tr>`);
    sigHtml += '<h3>Haal mein bane patterns (long + short, sab)</h3><table><tr><th>Symbol<th>TF<th>Kab<th>Pattern<th>Side<th>Role<th>Stop<th>Target</tr>' + (pr.join('') || '<tr><td colspan=8>koi naya pattern nahi</tr>') + '</table>';
  } catch { sigHtml = '<p>signals.json abhi nahi bana</p>'; }
  const rows = Object.entries(s.sleeves).map(([k, v]) =>
    `<tr><td>${k}${v.shadow ? ' <i>(shadow)</i>' : ''}</td><td>${v.closed}/100</td><td>${v.open}</td><td>${v.avg_net_bp ?? '-'}</td><td>${v.win_pct ?? '-'}</td><td>${v.t_stat ?? '-'}</td><td>${v.cum_equity_pct ?? '-'}</td><td>${v.max_drawdown_pct ?? '-'}</td><td>${v.expected_net_bp_from_backtest ?? '-'}</td><td>${v.flag}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Trishika Paper</title>
<style>body{font:14px system-ui;margin:12px}table{border-collapse:collapse;display:block;overflow-x:auto}td,th{border:1px solid #8886;padding:4px 8px;white-space:nowrap}</style>
<h2>Trishika paper trading (virtual)</h2><p>Update: ${s.generated_at_utc} | Din: ${s.days_running} | Capital: ${s.virtual_capital}</p>
<table><tr><th>Sleeve<th>Closed<th>Open<th>Avg net bp<th>Win %<th>t<th>Equity %<th>MaxDD %<th>Backtest bp<th>Status</tr>${rows}</table>
${sigHtml}<p><a href="paper/signals">signals json</a> | <a href="paper/trades.csv">trades.csv</a> | <a href="paper/summary">summary json</a> | <a href="paper/trades?limit=50">last 50 trades</a></p>
<p><b>Sab virtual hai. Koi real order nahi.</b></p>`);
});

export default router;
