
// src/services/signal_validator.js
function clampSignal(snapshot, aiSignal) {
  const { indicators, price } = snapshot;
  const trendScore = indicators?.trendScore ?? 0;
  const regime = indicators?.regime ?? "Ranging";
  const atr = price?.atr ?? 0;
  const last = price?.last ?? 0;

  const out = {
    signal: aiSignal.signal || "NEUTRAL",
    confidence: typeof aiSignal.confidence === "number" ? aiSignal.confidence : 0,
    reason: aiSignal.reason || "",
    entry: aiSignal.entry || last,
    sl: aiSignal.sl || last,
    tp: aiSignal.tp || last
  };

  const isTrending = regime.includes("Trending");
  if (!isTrending || Math.abs(trendScore) <= 0.6) {
    out.signal = "NEUTRAL";
  } else if (trendScore > 0.6 && out.signal !== "LONG") {
    out.signal = "LONG";
  } else if (trendScore < -0.6 && out.signal !== "SHORT") {
    out.signal = "SHORT";
  }

  if (out.confidence < 60) {
    out.signal = "NEUTRAL";
  }

  if (atr > 0 && last > 0 && out.signal !== "NEUTRAL") {
    const entry = last;
    if (out.signal === "LONG") {
      out.entry = entry;
      out.sl = entry - 1.5 * atr;
      out.tp = entry + 3 * atr;
    } else if (out.signal === "SHORT") {
      out.entry = entry;
      out.sl = entry + 1.5 * atr;
      out.tp = entry - 3 * atr;
    }
  }

  if (!isFinite(out.entry) || !isFinite(out.sl) || !isFinite(out.tp)) {
    out.signal = "NEUTRAL";
    out.confidence = 0;
  }

  return out;
}

module.exports = { clampSignal };

