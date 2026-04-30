// ─────────────────────────────────────────────────────────────────────────────
// HOW TO WIRE signalLogger into src/routes/index.js
// Apply these three small edits — nothing else in the file changes.
// ─────────────────────────────────────────────────────────────────────────────


// ── EDIT 1 ── Top of file, add one require alongside your other imports ───────

const { logSignal } = require('../services/signalLogger');


// ── EDIT 2 ── Inside your /api/signal handler, collect expert votes ───────────
//
// Your pipeline already calls each Ollama model and then groqCall().
// All you need to do is capture the data you already have into an array
// before calling generateSignal / groqCall.
//
// Example — adjust model/variable names to match yours:

router.get('/api/signal', async (req, res) => {
  const symbol   = (req.query.symbol   ?? 'BTCUSDT').toUpperCase();
  const interval = req.query.interval  ?? '1m';

  try {
    // (your existing candle fetch + computeIndicators stay unchanged)
    const candles    = await fetchCandles(symbol, interval);
    const indicators = computeIndicators(candles);

    // ── collect expert votes as you run each model ──────────────────────────
    const expertVotes = [];

    // tinyllama
    const tinyRes = await queueOllama('tinyllama', buildExpertPrompt(indicators));
    expertVotes.push({
      model:      'tinyllama',
      signal:     tinyRes?.signal     ?? null,
      confidence: tinyRes?.confidence ?? null,
      reason:     tinyRes?.reason     ?? null,
      timedOut:   tinyRes === null,
    });

    // gemma2:2b
    const gemmaRes = await queueOllama('gemma2:2b', buildExpertPrompt(indicators));
    expertVotes.push({
      model:      'gemma2:2b',
      signal:     gemmaRes?.signal     ?? null,
      confidence: gemmaRes?.confidence ?? null,
      reason:     gemmaRes?.reason     ?? null,
      timedOut:   gemmaRes === null,
    });

    // phi3
    const phi3Res = await queueOllama('phi3', buildExpertPrompt(indicators));
    expertVotes.push({
      model:      'phi3',
      signal:     phi3Res?.signal     ?? null,
      confidence: phi3Res?.confidence ?? null,
      reason:     phi3Res?.reason     ?? null,
      timedOut:   phi3Res === null,
    });

    // llama3.1:8b (optional heavy model — include even if timed out)
    const llamaRes = await queueOllama('llama3.1:8b', buildExpertPrompt(indicators));
    expertVotes.push({
      model:      'llama3.1:8b',
      signal:     llamaRes?.signal     ?? null,
      confidence: llamaRes?.confidence ?? null,
      reason:     llamaRes?.reason     ?? null,
      timedOut:   llamaRes === null,
    });

    // ── Groq fusion (your existing code) ────────────────────────────────────
    const prompt      = buildPrompt(indicators, expertVotes);
    const groqRaw     = await groqCall(prompt);          // null if all retries fail
    const finalSignal = groqRaw ?? deterministicFallback(indicators);
    const fallback    = groqRaw ? null : 'pinescript';

    // ── EDIT 3 ── Log BEFORE you respond ────────────────────────────────────
    logSignal({ symbol, interval, indicators, expertVotes, groqRaw, finalSignal, fallback });

    return res.json(finalSignal);

  } catch (err) {
    console.error('[/api/signal]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// That's it. Three lines of new code:
//   1. require('../services/signalLogger')
//   2. push each expert result into expertVotes[]
//   3. logSignal({ … }) before res.json()
// ─────────────────────────────────────────────────────────────────────────────
