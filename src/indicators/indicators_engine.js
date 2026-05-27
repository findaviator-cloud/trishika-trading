/**
 * indicators_engine.js
 * Deterministic indicator computation based on:
 *   - Institutional 1-5m Engine v4.0
 *   - Indian Market Assessment v4.0
 *
 * Input:  candles[] = [{ time, open, high, low, close, volume }, ...]
 *         sorted oldest → newest. Last element = current bar.
 * Output: full indicator object ready for AI pipeline.
 */

// ─── HELPERS ────────────────────────────────────────────────────────────────

function ema(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function sma(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdev(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

function rma(values, period) {
    // Wilder's smoothing (used in ATR, ADX, RSI)
    if (values.length < period) return null;
    let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) r = (r * (period - 1) + values[i]) / period;
  return r;
}

function calcATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
  return rma(trs, period);
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcADX(candles, period = 14) {
    if (candles.length < period * 2) return null;
    const plusDMs = [], minusDMs = [], trs = [];
    for (let i = 1; i < candles.length; i++) {
        const upMove   = candles[i].high - candles[i - 1].high;
        const downMove = candles[i - 1].low - candles[i].low;
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
        const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const atrS   = rma(trs,      period);
    const plusDI = atrS ? 100 * rma(plusDMs,  period) / atrS : 0;
    const minDI  = atrS ? 100 * rma(minusDMs, period) / atrS : 0;
    const dx     = (plusDI + minDI) !== 0 ? Math.abs(plusDI - minDI) / (plusDI + minDI) * 100 : 0;
    const dxArr  = [];
    // simplified: return current ADX from final dx
  return { adx: dx, plusDI, minDI };
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
    if (closes.length < slow + signal) return null;
    const emaFast   = ema(closes, fast);
    const emaSlow   = ema(closes, slow);
    if (emaFast === null || emaSlow === null) return null;
    const macdLine  = emaFast - emaSlow;
  return { macd: macdLine, signal: null, histogram: null }; // simplified
}

// ─── SESSION CHECK (UTC-based) ───────────────────────────────────────────────

function isInSession(timestampMs) {
    const d    = new Date(timestampMs);
    const hhmm = d.getUTCHours() * 100 + d.getUTCMinutes();
    const london = hhmm >= 800  && hhmm <= 1200;
    const ny     = hhmm >= 1300 && hhmm <= 1700;
    // Indian market: NSE 0345-1000 UTC (09:15-15:30 IST)
    const nse    = hhmm >= 345  && hhmm <= 1000;
  return { london, ny, nse, active: london || ny || nse };
}

// ─── TREND PER PERIOD ────────────────────────────────────────────────────────

function periodTrend(retPct, atrPct, emaStackBull, emaStackBear) {
    const trendLo = Math.max(atrPct * 0.40, 1.0);
    const trendHi = Math.max(atrPct * 1.00, 3.0);
    if (retPct > trendHi && emaStackBull) return 'Bull';
    if (retPct < -trendHi && emaStackBear)  return 'Bear';
    if (retPct > trendLo)  return 'Bull';
    if (retPct < -trendLo) return 'Bear';
  return 'Side';
}

// ─── MAIN COMPUTE ────────────────────────────────────────────────────────────

export function computeIndicators(candles) {
    if (!candles || candles.length < 50) {
  return { error: 'Not enough candles (need 50+)' };
    }

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const lows    = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const last    = candles[candles.length - 1];

    // ── Core EMAs (use [1] offset like Pine → use second-to-last bar) ──
    const emaFast5   = ema(closes.slice(0, -1), 5);
    const emaSlow13  = ema(closes.slice(0, -1), 13);
    const ema200v    = ema(closes, 200);

    // ── ATR ──
    const atrNow  = calcATR(candles, 14);
    const atrMa   = sma(candles.slice(-64).map((_, i) => {
        if (i < 1) return 0;
        const slice = candles.slice(Math.max(0, candles.length - 64 + i - 14), candles.length - 64 + i + 1);
  return calcATR(slice, 14) || 0;
    }), 50);
    const atrPct  = last.close ? (atrNow / last.close) * 100 : 1.0;

    // ── ATR Regime (from Strategy 1) ──
    const atrRegimeOK = atrNow && atrMa ? atrNow >= atrMa * 0.8 : true;

    // ── Volume Filter ──
    const volSma    = sma(volumes, 20);
    const volStdDev = stdev(volumes, 20);
    const volFilter = volSma && volStdDev
        ? last.volume > volSma && last.volume < (volSma + 3 * volStdDev)
        : false;

    // ── RSI ──
    const rsi = calcRSI(closes, 14);

    // ── Momentum conditions (Pine Script exact) ──
    const momentumLong  = rsi !== null && rsi > 50 && rsi < 65;   // rsiOB=65
    const momentumShort = rsi !== null && rsi < 50 && rsi > 35;   // rsiOS=35

    // ── EMA Stack ──
    const emaStackBull = emaFast5 && emaSlow13 && ema200v
        ? emaFast5 > emaSlow13 && emaSlow13 > ema200v && last.close > ema200v
        : false;
    const emaStackBear = emaFast5 && emaSlow13 && ema200v
        ? emaFast5 < emaSlow13 && emaSlow13 < ema200v && last.close < ema200v
        : false;

    // ── MACD ──
    const macdData = calcMACD(closes);

    // ── ADX + BB Regime ──
    const adxData   = calcADX(candles, 14);
    const adx       = adxData?.adx || 0;
    const bbBasis   = sma(closes, 20);
    const bbDev     = stdev(closes, 20);
    const bbWidth   = bbBasis && bbDev ? (2 * bbDev / bbBasis) * 100 : 0;
    const bbWidthMa = 0; // simplified
    const bbSqueeze = bbWidth < bbWidthMa * 0.8;
    const volExpanded = atrNow && atrMa ? atrNow > atrMa * 1.3 : false;

    let regime = 'Range';
    if (volExpanded)  regime = 'Volatile';
    else if (adx >= 40) regime = 'Strong Trend';
    else if (adx >= 25) regime = 'Trend';

    // ── Session ──
    const session = isInSession(last.time);

    // ── Signal conditions (Pine Script exact) ──
    const longSignal  = emaFast5 > emaSlow13 && volFilter && momentumLong  && atrRegimeOK && session.active;
    const shortSignal = emaFast5 < emaSlow13 && volFilter && momentumShort && atrRegimeOK && session.active;

    // ── Multi-period returns ──
    const barsPerDay = 375; // assume 1m
    function ret(barsBack) {
        const idx = Math.max(0, candles.length - 1 - barsBack);
        const past = candles[idx]?.close;
  return past ? ((last.close - past) / past) * 100 : 0;
    }
    const ret1M = ret(barsPerDay * 21);
    const ret3M = ret(barsPerDay * 21 * 3);
    const ret6M = ret(barsPerDay * 21 * 6);
    const ret1Y = ret(barsPerDay * 252);

    const trend1M = periodTrend(ret1M, atrPct, emaStackBull, emaStackBear);
    const trend3M = periodTrend(ret3M, atrPct, emaStackBull, emaStackBear);
    const trend6M = periodTrend(ret6M, atrPct, emaStackBull, emaStackBear);
    const trend1Y = periodTrend(ret1Y, atrPct, emaStackBull, emaStackBear);

    const bullCount = [trend1M, trend3M, trend6M, trend1Y].filter(t => t === 'Bull').length;
    const bearCount = [trend1M, trend3M, trend6M, trend1Y].filter(t => t === 'Bear').length;

    let overallTrend = 'Mixed';
    if (bullCount >= 3)      overallTrend = 'Strong Bull';
    else if (bullCount >= 2) overallTrend = 'Bull';
    else if (bearCount >= 3) overallTrend = 'Strong Bear';
    else if (bearCount >= 2) overallTrend = 'Bear';

    // ── Support / Resistance ──
    const high20 = Math.max(...highs.slice(-20));
    const low20  = Math.min(...lows.slice(-20));
    const high50 = Math.max(...highs.slice(-50));
    const low50  = Math.min(...lows.slice(-50));

    // ── Investment Grade Score (IGS) ──
    const igsTrend  = (trend1Y === 'Bull' ? 2 : trend1Y === 'Bear' ? -1 : 0)
                    + (trend3M === 'Bull' ? 2 : trend3M === 'Bear' ? -1 : 0);
    const igsRegime = regime === 'Strong Trend' ? 2 : regime === 'Trend' ? 1 : 0;
    const igsVol    = !volExpanded ? 2 : 1;
    const igs       = igsTrend + igsRegime + igsVol;

    let igsGrade = 'D';
    if (igs >= 8)      igsGrade = 'A+';
    else if (igs >= 6) igsGrade = 'A';
    else if (igs >= 4) igsGrade = 'B+';
    else if (igs >= 2) igsGrade = 'B';
    else if (igs >= 0) igsGrade = 'C';

    let igsAction = 'AVOID';
    if (igs >= 8)      igsAction = 'STRONG BUY';
    else if (igs >= 5) igsAction = 'BUY/ADD';
    else if (igs >= 3) igsAction = 'HOLD';
    else if (igs >= 1) igsAction = 'CAUTION';

    // ── SL/TP distances (ATR-based) ──
    const slDist = atrNow ? atrNow * 1.5 : null;
    const tpDist = atrNow ? Math.max(atrNow * 2.0, atrNow * 0.5) : null;

  return {
        // Price
        symbol:        null, // filled by caller
        price:         last.close,
        high:          last.high,
        low:           last.low,
        volume:        last.volume,
        time:          last.time,

        // Core indicators
        emaFast:       emaFast5,
        emaSlow:       emaSlow13,
        ema200:        ema200v,
        rsi:           rsi ? +rsi.toFixed(2) : 50,
        atr:           atrNow ? +atrNow.toFixed(4) : null,
        atrPct:        +atrPct.toFixed(3),
        macd:          macdData?.macd ? +macdData.macd.toFixed(4) : null,
        adx:           +adx.toFixed(2),

        // Filters
        volFilter,
        atrRegimeOK,
        momentumLong,
        momentumShort,
        emaStackBull,
        emaStackBear,
        bbSqueeze,
        volExpanded,

        // Session
        session: {
            london:  session.london,
            ny:      session.ny,
            nse:     session.nse,
            active:  session.active
        },

        // Regime
        regime,

        // Signals (deterministic — from Pine Script rules)
        longSignal,
        shortSignal,

        // Multi-period
        trends: { trend1M, trend3M, trend6M, trend1Y },
        returns: {
            ret1M: +ret1M.toFixed(2),
            ret3M: +ret3M.toFixed(2),
            ret6M: +ret6M.toFixed(2),
            ret1Y: +ret1Y.toFixed(2)
        },
        overallTrend,
        bullCount,
        bearCount,

        // S/R levels
        resistance20: +high20.toFixed(2),
        support20:    +low20.toFixed(2),
        resistance50: +high50.toFixed(2),
        support50:    +low50.toFixed(2),

        // IGS
        igs,
        igsGrade,
        igsAction,

        // Risk model
        slDist:  slDist ? +slDist.toFixed(4) : null,
        tpDist:  tpDist ? +tpDist.toFixed(4) : null,
        rrRatio: slDist && tpDist ? +(tpDist / slDist).toFixed(2) : null
    };
}
