import axios from "axios";
import { CONFIG } from "../config/index.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqCall(prompt) {
  if (!CONFIG.groqKey || CONFIG.groqKey.length < 10) {
    console.error("[GROQ] Key missing or too short");
    return null;
  }
  try {
    const resp = await axios.post(
      GROQ_URL,
      {
        model: CONFIG.groqModel || "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.groqKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    return resp.data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error(
      "[GROQ FAIL]",
      e.response?.data?.error?.message || e.message
    );
    return null;
  }
}

export function extractJSON(text) {
  try {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (e) {
    return null;
  }
}

export function clampSignal(s) {
  const valid = ["LONG", "SHORT", "NEUTRAL", "HOLD", "BUY", "SELL"];
  return {
    signal: valid.includes(s?.signal?.toUpperCase())
      ? s.signal.toUpperCase()
      : "NEUTRAL",
    confidence: Math.min(100, Math.max(0, Number(s?.confidence) || 50)),
    reason: String(s?.reason || "No reason").slice(0, 200),
    agent: s?.agent || "System",
    _source: s?._source || "unknown",
    indicators: s?.indicators || null,
  };
}
export function buildPrompt(indicators = {}) {
  const {
    regime,
    overallTrend,
    rsi,
    emaFast,
    emaSlow,
    atrRegimeOK,
    volFilter,
    igsGrade,
    igsAction,
    rrRatio,
    session,
    price,
    symbol = "BTCUSDT",
  } = indicators;

  const safe = (v, digits = 2) =>
    typeof v === "number" ? v.toFixed(digits) : String(v ?? "n/a");

  const emaBias =
    typeof emaFast === "number" && typeof emaSlow === "number"
      ? emaFast > emaSlow
        ? "BULLISH alignment"
        : "BEARISH alignment"
      : "alignment unknown";

  let rsiComment = "(neutral zone)";
  if (typeof rsi === "number") {
    if (rsi < 30) rsiComment = "OVERSOLD";
    else if (rsi > 70) rsiComment = "OVERBOUGHT";
  }

  return (
    "You are a professional trader analyzing " +
    symbol +
    ".\\nSession: " +
    session +
    " | Market regime: " +
    regime +
    " | Trend: " +
    overallTrend +
    "\\n\\nINDICATOR DATA:\\n" +
    "- RSI(14): " +
    safe(rsi) +
    " " +
    rsiComment +
    "\\n- EMA stack: fast=" +
    safe(emaFast) +
    ", slow=" +
    safe(emaSlow) +
    " -> " +
    emaBias +
    "\\n- ATR volatility OK: " +
    atrRegimeOK +
    " | Volume filter: " +
    volFilter +
    "\\n- IGS grade: " +
    igsGrade +
    " | IGS action: " +
    igsAction +
    "\\n- Risk/Reward ratio: " +
    safe(rrRatio) +
    "\\n- Current price: " +
    safe(price, 2) +
    "\\n\\nDECISION RULES (apply in order):\\n" +
    "1. If volFilter=false OR atrRegimeOK=false -> NEUTRAL, confidence 20-40.\\n" +
    "2. If RSI < 30 AND EMA bullish AND regime=TRENDING -> BUY, confidence 70-95.\\n" +
    "3. If RSI > 70 AND EMA bearish AND regime=TRENDING -> SELL, confidence 70-95.\\n" +
    "4. If igsAction=BUY AND overallTrend=UP AND rrRatio >= 1.5 -> BUY, confidence 60-90.\\n" +
    "5. If igsAction=SELL AND overallTrend=DOWN AND rrRatio >= 1.5 -> SELL, confidence 60-90.\\n" +
    "6. If regime=RANGING AND RSI between 40-60 -> NEUTRAL, confidence 40-60.\\n" +
    "7. Otherwise use indicator confluence to decide.\\n\\n" +
    "You MUST respond in this exact JSON format, no extra text, no line breaks in reason:\\n" +
    '{"signal":"BUY or SELL or NEUTRAL","confidence":10-95,"reason":"one short sentence under 20 words"}'
  );
}

