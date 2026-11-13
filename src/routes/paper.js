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

router.get('/patterns', async (req, res) => {
  try {
    const rows = parseCsv(await readFile('pattern_log.csv'));
    res.json({ count: rows.length, patterns: rows.slice(-Math.min(Number(req.query.limit) || 200, 3000)).reverse(), api: SAFETY });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function equitySvg(trades) {
  const cl = trades.filter((t) => t.status === 'CLOSED' && t.shadow !== 'True' && t.shadow !== 'true')
    .sort((a, b) => String(a.exit_time).localeCompare(String(b.exit_time)));
  if (cl.length < 2) return '<p class="muted">Equity curve: abhi 2 se kam closed trades.</p>';
  let eq = 100; const pts = [eq];
  for (const t of cl) { eq *= 1 + Number(t.equity_pct || 0) / 100; pts.push(eq); }
  const lo = Math.min(...pts), hi = Math.max(...pts), W = 320, H = 70, span = hi - lo || 1;
  const path = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / span) * (H - 6) - 3).toFixed(1)}`).join(' ');
  const col = pts[pts.length - 1] >= 100 ? '#00c27a' : '#ff3366';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:420px;background:#8881;border-radius:6px"><polyline fill="none" stroke="${col}" stroke-width="2" points="${path}"/></svg>
<div class="muted">Equity (GOLD_NIGHT + PAT4H_LONG): ${(pts[pts.length - 1] - 100).toFixed(3)}% | ${cl.length} closed trades</div>`;
}

router.get('/', async (_req, res) => {
  let s;
  try { s = JSON.parse(await readFile('summary.json')); } catch (e) { return res.status(404).send(`<h3>Paper data abhi nahi bana</h3><p>${esc(e.message)}</p>`); }
  const ageH = (Date.now() - Date.parse(s.generated_at_utc)) / 3600000;
  const stale = ageH > 9
    ? `<div style="background:#ff336622;border:1px solid #ff3366;padding:8px;border-radius:6px;margin:8px 0">⚠ Data ${ageH.toFixed(1)} ghante purana hai. GitHub Actions (paper-trading) check karein.</div>` : '';
  const dataBad = Object.entries(s.data_status || {}).filter(([, v]) => !v.ok).map(([k, v]) => `${esc(k)}: ${esc(v.error)}`);
  const dataWarn = dataBad.length ? `<div style="background:#ffd70022;border:1px solid #ffd700;padding:8px;border-radius:6px;margin:8px 0">⚠ Data source dikkat: ${dataBad.join(' | ')}</div>` : '';
  const rows = Object.entries(s.sleeves).map(([k, v]) =>
    `<tr><td>${esc(k)}${v.shadow ? ' <i>(shadow)</i>' : ''}</td><td>${v.closed}/100</td><td>${v.open}</td><td>${v.avg_net_bp ?? '-'}</td><td>${v.win_pct ?? '-'}</td><td>${v.t_stat ?? '-'}</td><td>${v.cum_equity_pct ?? '-'}</td><td>${v.max_drawdown_pct ?? '-'}</td><td>${v.expected_net_bp_from_backtest ?? '-'}</td><td>${esc(v.flag)}</td></tr>`).join('');
  let sigHtml = '';
  try {
    const raw = JSON.parse(await readFile('signals.json'));
    const sg = raw.instruments || {};
    const c = raw.gold_night_card;
    if (c && !c.error) {
      sigHtml += `<h3>Aaj raat ka gold plan</h3><table><tr><th>Entry (IST)<th>Exit (UTC)<th>Regime<th>Typical move bp<th>Kharab raat (5%) bp<th>Size (notional)</tr>
<tr><td>${esc(c.next_entry_ist)}<td>${esc(c.exit_utc)}<td>${esc(c.regime)} (${c.avg_daily_range_20d_bp}bp)<td>${c.typical_abs_move_bp}<td>${c.bad_night_5pct_bp}<td>${c.suggested_notional_frac}</tr></table><p class="muted">${esc(c.note)}</p>`;
    }
    const pr = [];
    sigHtml += '<h3>Live candle + volatility</h3><table><tr><th>Symbol<th>TF<th>Candle (band)<th>Close pos %<th>Range/ATR<th>Shapes<th>Volatility</tr>' +
      Object.entries(sg).map(([k, v]) => ['candle_1h', 'candle_4h', 'candle_1d'].filter((cc) => v[cc]).map((cc) =>
        `<tr><td>${esc(k)}<td>${cc.slice(7)}<td>${esc(v[cc].candle_time)}<td>${v[cc].close_position_pct ?? '-'}<td>${v[cc].range_vs_atr ?? '-'}<td>${esc((v[cc].shapes || []).join(', ') || '-')}<td>${v.volatility ? esc(v.volatility.regime) + ' (' + v.volatility.avg_daily_range_20d_bp + 'bp)' : '-'}</tr>`).join('')).join('') + '</table>';
    for (const [k, v] of Object.entries(sg)) for (const list of ['patterns_last_24h_on_4h', 'patterns_last_day_on_1h', 'patterns_last_5d_on_1d']) for (const p of v[list] || []) pr.push(`<tr><td>${esc(k)}<td>${esc(p.timeframe)}<td>${esc(p.formed_at)}<td>${esc(p.kind)}<td>${esc(p.direction)}<td>${esc(p.role)}<td>${p.stop}<td>${p.target}</tr>`);
    sigHtml += '<h3>Haal mein bane patterns (long + short, sab)</h3><table><tr><th>Symbol<th>TF<th>Kab<th>Pattern<th>Side<th>Role<th>Stop<th>Target</tr>' + (pr.join('') || '<tr><td colspan=8>koi naya pattern nahi</tr>') + '</table>';
  } catch { sigHtml = '<p>signals.json abhi nahi bana</p>'; }
  let plog = '';
  try {
    const pl = parseCsv(await readFile('pattern_log.csv')).slice(-30).reverse();
    plog = '<h3>Pattern history (kab kab bana, aakhri 30)</h3><table><tr><th>Bana<th>Symbol<th>TF<th>Pattern<th>Side<th>Role</tr>' +
      pl.map((p) => `<tr><td>${esc(p.formed_at)}<td>${esc(p.instrument)}<td>${esc(p.timeframe)}<td>${esc(p.kind)}<td>${esc(p.direction)}<td>${esc(p.role)}</tr>`).join('') + '</table>';
  } catch { /* pattern_log abhi nahi bana */ }
  let eq = '';
  try { eq = equitySvg(parseCsv(await readFile('trades.csv'))); } catch { /* ignore */ }
  res.type('html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Trishika Paper</title>
<style>body{font:14px system-ui;margin:12px}table{border-collapse:collapse;display:block;overflow-x:auto;margin-bottom:6px}td,th{border:1px solid #8886;padding:4px 8px;white-space:nowrap;text-align:left}.muted{color:#888;font-size:12px}</style>
<h2>Trishika paper trading (virtual)</h2>${stale}${dataWarn}<p>Update: ${esc(s.generated_at_utc)} | Din: ${s.days_running} | Capital: ${s.virtual_capital}</p>
${eq}<table><tr><th>Sleeve<th>Closed<th>Open<th>Avg net bp<th>Win %<th>t<th>Equity %<th>MaxDD %<th>Backtest bp<th>Status</tr>${rows}</table>
${sigHtml}${plog}
<p><a href="paper/signals">signals json</a> | <a href="paper/patterns">patterns json</a> | <a href="paper/trades.csv">trades.csv</a> | <a href="paper/summary">summary json</a> | <a href="paper/trades?limit=50">last 50 trades</a></p>
<p><b>Sab virtual hai. Koi real order nahi.</b></p>`);
});

export default router;
