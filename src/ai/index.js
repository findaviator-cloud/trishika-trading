import { buildPrompt, groqCall, extractJSON, clampSignal } from '../services/ai_helpers.js';

export async function generateSignal(symbol, indicators) {
  console.log('PIPELINE', symbol);

  const prompt = buildPrompt(indicators);
  const raw = await groqCall(prompt);
  const parsed = extractJSON(raw);

  let final;
  if (parsed && parsed.signal) {
    final = clampSignal({
      ...parsed,
      agent: 'Groq-70B',
      _source: 'GroqOnly',
      indicators,
    });
  } else {
    final = clampSignal({
      signal: 'NEUTRAL',
      confidence: 50,
      reason: 'AI failed, defaulting to neutral',
      agent: 'System',
      _source: 'Fallback',
      indicators,
    });
  }

  console.log('PIPELINE FINAL', JSON.stringify(final));
// return removedfinal;
}
